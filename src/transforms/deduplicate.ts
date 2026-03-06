import { Transform } from '../types';
import { skeleton } from '../skeleton';

/**
 * Collapse identical or near-identical lines.
 *
 * "Near-identical" means the lines differ only in parts that look like
 * numbers, timestamps, IDs, or URLs (already shortened by previous transforms).
 * We normalize those away and compare the skeleton.
 *
 * Pass 1: Collapse consecutive runs of identical-skeleton lines.
 * Pass 2: Collapse non-consecutive lines sharing the same skeleton (3+ occurrences).
 *
 * When lines differ in specific values, the output shows a template with
 * {URL} or {N} placeholders and lists the varying values inline.
 */

// Pattern matching the same tokens that skeleton() replaces.
// URLs are matched first (greedy) so they aren't split by the number sub-pattern.
const TOKEN_PATTERN = /https?:\/\/\S+|\$\d+|\d+/g;

// Extract all variable tokens from a line in order.
// For URLs, strip trailing punctuation (.,;) that's sentence-level, not part of the URL.
function extractTokens(line: string): string[] {
  return Array.from(line.matchAll(TOKEN_PATTERN), m => {
    const tok = m[0];
    if (/^https?:\/\//.test(tok)) return tok.replace(/[.,;:]+$/, '');
    return tok;
  });
}

// Check if a token at a given position in the line is an ephemeral port number
// (immediately follows an IP address like 172.16.31.218:PORT)
const IP_PORT_RE = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:(\d+)/g;
function isPortToken(line: string, tokenValue: string): boolean {
  IP_PORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IP_PORT_RE.exec(line)) !== null) {
    if (m[1] === tokenValue) return true;
  }
  return false;
}

// Replace only varying token positions with placeholders, keep constant tokens as-is
function buildTemplate(
  line: string,
  varyingPositions: Set<number>,
  suppressedPositions?: Set<number>,
): string {
  let tokenIndex = 0;
  let varCount = 0;
  const singleVarying = varyingPositions.size === 1;

  return line.replace(TOKEN_PATTERN, (match) => {
    const isVarying = varyingPositions.has(tokenIndex);
    const isSuppressed = suppressedPositions?.has(tokenIndex) ?? false;
    tokenIndex++;
    if (isVarying) {
      varCount++;
      if (isSuppressed) return '{port}';
      const isUrl = /^https?:\/\//.test(match);
      if (singleVarying) return isUrl ? '{URL}' : '{N}';
      return isUrl ? `{URL${varCount}}` : `{N${varCount}}`;
    }
    return match;
  });
}

// Format a collapsed group into a summary line
function formatGroup(group: string[]): string {
  if (group.length === 1) return group[0];

  const allTokens = group.map(extractTokens);
  const varyingPositions = new Set<number>();

  if (allTokens[0].length > 0) {
    for (let pos = 0; pos < allTokens[0].length; pos++) {
      const firstVal = allTokens[0][pos];
      if (allTokens.some(tokens => (tokens[pos] ?? '') !== firstVal)) {
        varyingPositions.add(pos);
      }
    }
  }

  if (varyingPositions.size === 0) {
    // Truly identical lines
    return group[0] + `\n[... ${group.length - 1} identical lines omitted ...]`;
  }

  // Detect port-number tokens (ephemeral ports after IP addresses) — suppress from value listing
  const suppressedPositions = new Set<number>();
  for (const pos of varyingPositions) {
    const tokenVal = allTokens[0][pos];
    if (tokenVal && /^\d{3,5}$/.test(tokenVal) && isPortToken(group[0], tokenVal)) {
      suppressedPositions.add(pos);
    }
  }

  // Lines differ in specific values — show template with varying values
  const template = buildTemplate(group[0].replace(/\r$/, ''), varyingPositions, suppressedPositions);
  const varyingPosArray = Array.from(varyingPositions).sort((a, b) => a - b);
  const reportable = varyingPosArray.filter(p => !suppressedPositions.has(p));

  if (reportable.length === 0) {
    // All varying positions are suppressed (e.g., only port numbers differ)
    return `[x${group.length}] ${template}`;
  }

  if (reportable.length === 1) {
    const pos = reportable[0];
    const label = /^https?:\/\//.test(allTokens[0][pos] ?? '') ? 'URL' : 'N';
    const values = allTokens.map(t => t[pos]).join(', ');
    return `[x${group.length}] ${template} | ${label} = ${values}`;
  }

  const valueParts: string[] = [];
  reportable.forEach((pos, idx) => {
    const isUrl = /^https?:\/\//.test(allTokens[0][pos] ?? '');
    const label = isUrl ? `URL${idx + 1}` : `N${idx + 1}`;
    const values = allTokens.map(t => t[pos]).join(', ');
    valueParts.push(`${label} = ${values}`);
  });
  return `[x${group.length}] ${template} | ${valueParts.join(' | ')}`;
}

const MIN_SCATTERED_GROUP = 3;
const MIN_SUFFIX_GROUP = 3;
// Minimum suffix length (in characters) to consider for suffix dedup
const MIN_SUFFIX_LEN = 20;

// Split a line into (prefix, suffix) at the last error-type boundary.
// Recognizes patterns like ": TypeError: ...", ": Error: ...", ": NetworkError ..."
function splitAtErrorSuffix(line: string): { prefix: string; suffix: string } | null {
  // Match "TypeError: ...", "Error: ...", "Exception: ..." etc.
  // The alternation handles both compound names (TypeError) and standalone (Error).
  const m = line.match(/^(.*?)\b((?:[A-Z][A-Za-z]*)?(?:Error|Exception|Warning|Rejection):\s.+)$/);
  if (m && m[2].length >= MIN_SUFFIX_LEN) {
    return { prefix: m[1], suffix: m[2] };
  }
  return null;
}

// Collapse lines sharing a common error suffix into a single summary.
function collapseSuffixGroups(lines: string[]): string[] {
  // Parse each line for error suffixes
  const parsed: { line: string; prefix: string; suffix: string; idx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const split = splitAtErrorSuffix(lines[i]);
    if (split) parsed.push({ line: lines[i], ...split, idx: i });
  }

  // Group by suffix
  const suffixGroups = new Map<string, typeof parsed>();
  for (const p of parsed) {
    const key = p.suffix;
    if (!suffixGroups.has(key)) suffixGroups.set(key, []);
    suffixGroups.get(key)!.push(p);
  }

  // Find groups with enough members
  const consumed = new Set<number>();
  const insertions = new Map<number, string>(); // idx -> replacement line
  for (const [suffix, members] of suffixGroups) {
    if (members.length < MIN_SUFFIX_GROUP) continue;

    // Build compact summary: "ErrorType: message — prefix1, prefix2, ..."
    const prefixes = members.map(m => m.prefix.replace(/[:\s]+$/, '').trim()).filter(p => p !== '');
    let summary: string;
    if (prefixes.length > 0 && prefixes.length === members.length) {
      summary = `[x${members.length}] ${suffix} — ${prefixes.join(', ')}`;
    } else {
      summary = `[x${members.length}] ${suffix}`;
    }

    // Place at last occurrence, consume rest — placing at the end avoids
    // splitting runs of other repeated lines that were interleaved with these.
    const lastIdx = members[members.length - 1].idx;
    insertions.set(lastIdx, summary);
    for (let i = 0; i < members.length - 1; i++) {
      consumed.add(members[i].idx);
    }
  }

  if (consumed.size === 0) return lines;

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue;
    if (insertions.has(i)) {
      result.push(insertions.get(i)!);
    } else {
      result.push(lines[i]);
    }
  }
  return result;
}

export const deduplicate: Transform = {
  name: 'Deduplicate Lines',
  settingKey: 'deduplicateLines',
  apply(input: string): string {
    const lines = input.split('\n');

    // --- Pass 1: consecutive dedup ---
    const pass1: string[] = [];
    let currentSkeleton = '';
    let group: string[] = [];

    function flushGroup() {
      if (group.length === 0) return;
      pass1.push(formatGroup(group));
      group = [];
    }

    for (const line of lines) {
      const skel = skeleton(line);
      if (skel === currentSkeleton && skel !== '') {
        group.push(line);
      } else {
        flushGroup();
        currentSkeleton = skel;
        group = [line];
      }
    }
    flushGroup();

    // --- Pass 2: suffix dedup (collapse lines sharing common error suffix) ---
    const pass2 = collapseSuffixGroups(pass1);

    // --- Pass 3: consecutive dedup again (suffix dedup may have removed
    //     interleaved lines, making previously-separated duplicates adjacent) ---
    const pass3: string[] = [];
    let curSkel = '';
    let grp: string[] = [];

    function flushGrp() {
      if (grp.length === 0) return;
      pass3.push(formatGroup(grp));
      grp = [];
    }

    for (const line of pass2) {
      const skel = skeleton(line);
      if (skel === curSkel && skel !== '') {
        grp.push(line);
      } else {
        flushGrp();
        curSkel = skel;
        grp = [line];
      }
    }
    flushGrp();

    return pass3.join('\n');
  },
};
