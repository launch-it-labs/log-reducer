import { Transform } from '../types';
import { skeleton } from '../skeleton';

/**
 * Merge non-consecutive duplicate lines that were split by interleaving.
 *
 * After deduplicate + detectCycles, the same line (or [xN] collapsed line)
 * can appear in multiple places because interleaved lines from a different
 * log source broke up consecutive runs.  This transform finds those scattered
 * duplicates and merges them into a single occurrence with a combined count.
 *
 * - [xN] lines with the same template: sum counts, keep first, remove rest.
 * - Plain lines appearing 3+ times non-consecutively: keep first + annotation.
 */

const XN_RE = /^\[x(\d+)\]\s+/;
const VALUE_SUFFIX_RE = /\s+\|\s+\S+\s*=\s*.+$/;
const META_RE = /^\[\.\.\./;

/** Skeleton key for comparison — strips [xN] prefix and | N = ... suffix. */
function lineKey(line: string): string {
  let body = line;
  const xn = body.match(XN_RE);
  if (xn) body = body.substring(xn[0].length);
  body = body.replace(VALUE_SUFFIX_RE, '');
  return skeleton(body);
}

/** Extract count from [xN] line, or 1 for plain lines. */
function lineCount(line: string): number {
  const m = line.match(XN_RE);
  return m ? parseInt(m[1], 10) : 1;
}

/** Strip the [xN] prefix and rebuild with a new count. */
function rebuildXN(line: string, newCount: number): string {
  const body = line.replace(XN_RE, '');
  return `[x${newCount}] ${body}`;
}

const MIN_PLAIN_SCATTERED = 3;
const MIN_XN_SCATTERED = 2;

export const mergeScattered: Transform = {
  name: 'Merge Scattered Duplicates',
  settingKey: 'mergeScattered',
  apply(input: string): string {
    const lines = input.split('\n');

    // Index [xN] lines by skeleton key (they already represent collapsed groups)
    const xnGroups = new Map<string, number[]>();
    // Index plain lines by exact text (strict — only merge truly identical lines)
    const plainGroups = new Map<string, number[]>();

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '') continue;
      if (META_RE.test(trimmed)) continue;
      // Skip indented lines — they're part of compressPrefix or stack trace output
      if (/^\s/.test(lines[i])) continue;
      // Skip compressPrefix group headers (e.g., "module.name - INFO:")
      if (/:\s*$/.test(trimmed)) continue;

      if (XN_RE.test(trimmed)) {
        const key = lineKey(lines[i]);
        if (key === '') continue;
        if (!xnGroups.has(key)) xnGroups.set(key, []);
        xnGroups.get(key)!.push(i);
      } else {
        const key = trimmed;
        if (!plainGroups.has(key)) plainGroups.set(key, []);
        plainGroups.get(key)!.push(i);
      }
    }

    const remove = new Set<number>();
    const replacements = new Map<number, string>();

    // Merge [xN] lines with same skeleton: sum counts
    for (const [, indices] of xnGroups) {
      if (indices.length < MIN_XN_SCATTERED) continue;

      const totalCount = indices.reduce((sum, i) => sum + lineCount(lines[i]), 0);
      const firstIdx = indices[0];
      replacements.set(firstIdx, rebuildXN(lines[firstIdx], totalCount));
      for (let j = 1; j < indices.length; j++) {
        remove.add(indices[j]);
      }
    }

    // Merge plain identical lines appearing 3+ times
    for (const [, indices] of plainGroups) {
      if (indices.length < MIN_PLAIN_SCATTERED) continue;

      const firstIdx = indices[0];
      replacements.set(firstIdx, lines[firstIdx] + `\n[... above line repeated ${indices.length - 1} more times ...]`);
      for (let j = 1; j < indices.length; j++) {
        remove.add(indices[j]);
      }
    }

    if (remove.size === 0 && replacements.size === 0) return input;

    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (remove.has(i)) continue;
      if (replacements.has(i)) {
        result.push(replacements.get(i)!);
      } else {
        result.push(lines[i]);
      }
    }

    return result.join('\n');
  },
};
