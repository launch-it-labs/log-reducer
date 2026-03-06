import { Transform } from '../types';

/**
 * Fold repeated prefixes among consecutive lines at the same indent level.
 *
 * When consecutive lines share a common prefix, the first line keeps the
 * full text and subsequent lines are indented with the shared prefix
 * stripped — reducing redundancy without losing semantic meaning.
 *
 * Example:
 *   [Modal] Connected to: server-v2/process
 *   [Modal] Using sequential processing
 *   [Modal] Streaming progress
 * becomes:
 *   [Modal] Connected to: server-v2/process
 *     Using sequential processing
 *     Streaming progress
 */

const MIN_PREFIX_LEN = 5;

function getIndent(line: string): string {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : '';
}

/** Lines that should break a fold run rather than participate. */
function shouldBreakRun(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (trimmed.endsWith(':')) return true;
  if (/^\[\.{3}\s+/.test(trimmed)) return true; // [... N omitted ...]
  return false;
}

/** Longest common prefix of two strings. */
function lcp(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/** Trim prefix to last space boundary (avoid cutting mid-word). */
function cleanPrefix(rawPrefix: string): string {
  if (rawPrefix.length === 0) return '';
  if (/\s$/.test(rawPrefix)) return rawPrefix;
  const lastSpace = rawPrefix.lastIndexOf(' ');
  if (lastSpace < 0) return '';
  return rawPrefix.slice(0, lastSpace + 1);
}

/** Prefix must be long enough and contain meaningful content. */
function isValidPrefix(prefix: string): boolean {
  return prefix.length >= MIN_PREFIX_LEN && /[a-zA-Z0-9]/.test(prefix);
}

export const foldRepeatedPrefix: Transform = {
  name: 'Fold Repeated Prefix',
  settingKey: 'foldRepeatedPrefix',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (shouldBreakRun(lines[i])) {
        result.push(lines[i]);
        i++;
        continue;
      }

      const indent = getIndent(lines[i]);

      // Collect consecutive foldable lines at the same indent
      let j = i + 1;
      while (
        j < lines.length &&
        !shouldBreakRun(lines[j]) &&
        getIndent(lines[j]) === indent
      ) {
        j++;
      }

      if (j - i < 2) {
        result.push(lines[i]);
        i++;
        continue;
      }

      // Extract content (without indent) for this run
      const contents: string[] = [];
      for (let k = i; k < j; k++) {
        contents.push(lines[k].slice(indent.length));
      }

      result.push(...foldContents(contents, indent));
      i = j;
    }

    return result.join('\n');
  },
};

/** Greedily fold consecutive sub-runs that share a common prefix. */
function foldContents(contents: string[], indent: string): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < contents.length) {
    if (i + 1 >= contents.length) {
      result.push(indent + contents[i]);
      i++;
      continue;
    }

    // Find LCP of consecutive pair
    let prefix = cleanPrefix(lcp(contents[i], contents[i + 1]));

    if (!isValidPrefix(prefix)) {
      result.push(indent + contents[i]);
      i++;
      continue;
    }

    // Extend the run as long as LCP stays valid
    let j = i + 2;
    while (j < contents.length) {
      const newPrefix = cleanPrefix(lcp(prefix, contents[j]));
      if (!isValidPrefix(newPrefix)) break;
      prefix = newPrefix;
      j++;
    }

    // Verify all folded lines have non-empty remaining content
    let valid = true;
    for (let k = i + 1; k < j; k++) {
      if (contents[k].slice(prefix.length).trim() === '') {
        valid = false;
        break;
      }
    }

    if (!valid) {
      result.push(indent + contents[i]);
      i++;
      continue;
    }

    // Fold: first line full, subsequent lines strip prefix and add indent
    result.push(indent + contents[i]);
    for (let k = i + 1; k < j; k++) {
      result.push(indent + '  ' + contents[k].slice(prefix.length));
    }
    i = j;
  }

  return result;
}
