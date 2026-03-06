import { Transform, PipelineOptions, SettingKey, FocusOptions } from './types';
import {
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  shortenUrls,
  simplifyTimestamps,
  compressPrefix,
  deduplicate,
  detectCycles,
  mergeScattered,
  filterNoise,
  stripSourceLocations,
  foldStackTraces,
  collapsePipOutput,
  collapseRetries,
  collapseDockerLayers,
  stripEnvelope,
  compactAccessLogs,
  foldRepeatedPrefix,
} from './transforms';

/**
 * The ordered list of all transforms.
 * Order matters — e.g., IDs should be shortened before URLs are collapsed,
 * and both run before deduplication so lines differing only by ID/URL match.
 */
const ALL_TRANSFORMS: Transform[] = [
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  shortenUrls,
  simplifyTimestamps,
  stripEnvelope,
  filterNoise,
  stripSourceLocations,
  collapsePipOutput,
  collapseDockerLayers,
  compactAccessLogs,
  compressPrefix,
  deduplicate,
  detectCycles,
  mergeScattered,
  foldRepeatedPrefix,
  foldStackTraces,
  collapseRetries,
];

/** All transforms enabled by default — derived from ALL_TRANSFORMS. */
const DEFAULT_OPTIONS = Object.fromEntries(
  ALL_TRANSFORMS.map(t => [t.settingKey, true])
) as PipelineOptions;

// ---------------------------------------------------------------------------
// Focus filtering — post-pipeline narrowing for debugging
// ---------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  warn: 2,
  error: 3,
  critical: 4,
  fatal: 4,
};

const LEVEL_RE = /\b(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\b/i;

/** Check if a line's detected log level meets the minimum threshold. */
function lineMatchesLevel(line: string, minLevel: string): boolean {
  const m = line.match(LEVEL_RE);
  if (!m) return false; // No level detected — not a level match (may appear via context)
  return (LEVEL_ORDER[m[1].toLowerCase()] ?? 1) >= (LEVEL_ORDER[minLevel] ?? 1);
}

/** Check if a line matches a component/logger name (case-insensitive substring). */
function lineMatchesComponent(line: string, component: string): boolean {
  return line.toLowerCase().includes(component.toLowerCase());
}

/** Parse "HH:MM-HH:MM" or "HH:MM:SS-HH:MM:SS" into [startSeconds, endSeconds]. */
function parseTimeRange(range: string): [number, number] | null {
  const m = range.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)$/);
  if (!m) return null;
  const toSec = (t: string): number => {
    const parts = t.split(':').map(Number);
    return parts[0] * 3600 + parts[1] * 60 + (parts[2] ?? 0);
  };
  return [toSec(m[1]), toSec(m[2])];
}

/** Extract a time-of-day from a line and convert to seconds. */
const TIME_EXTRACT_RE = /(?:^|[^0-9])(\d{1,2}):(\d{2}):(\d{2})\b/;
function lineTimeSeconds(line: string): number | null {
  const m = line.match(TIME_EXTRACT_RE);
  if (!m) return null;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
}

/** Check if a line's timestamp falls within a time range. */
function lineMatchesTimeRange(line: string, range: [number, number]): boolean {
  const t = lineTimeSeconds(line);
  if (t === null) return false;
  return t >= range[0] && t <= range[1];
}

/**
 * Build a structural summary of the log: counts, timestamps, components, key events.
 * Costs very few tokens and lets the driving AI plan targeted follow-up queries.
 */
function buildSummary(lines: string[]): string {
  const levelCounts: Record<string, { count: number; firstTime: string | null; lastTime: string | null }> = {};
  const components = new Set<string>();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  const errorTimestamps: string[] = [];

  const COMPONENT_RE = /\[([A-Za-z][\w.-]*)\]|(?:logger|module|component)[=:][\s]*([A-Za-z][\w.-]*)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract timestamp
    const timeMatch = line.match(TIME_EXTRACT_RE);
    const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}` : null;
    if (timeStr) {
      if (!firstTimestamp) firstTimestamp = timeStr;
      lastTimestamp = timeStr;
    }

    // Count levels
    const levelMatch = line.match(LEVEL_RE);
    if (levelMatch) {
      const lvl = levelMatch[1].toUpperCase();
      if (!levelCounts[lvl]) levelCounts[lvl] = { count: 0, firstTime: null, lastTime: null };
      levelCounts[lvl].count++;
      if (timeStr) {
        if (!levelCounts[lvl].firstTime) levelCounts[lvl].firstTime = timeStr;
        levelCounts[lvl].lastTime = timeStr;
      }
      // Track error timestamps for the AI to reference
      if ((LEVEL_ORDER[lvl.toLowerCase()] ?? 0) >= LEVEL_ORDER['error']) {
        if (errorTimestamps.length < 20) {
          errorTimestamps.push(timeStr || `line ~${i + 1}`);
        }
      }
    }

    // Extract components
    const compMatch = line.match(COMPONENT_RE);
    if (compMatch) {
      components.add((compMatch[1] || compMatch[2]).toLowerCase());
    }
  }

  const parts: string[] = [];
  parts.push(`SUMMARY (${lines.length} lines)`);
  if (firstTimestamp || lastTimestamp) {
    parts.push(`Time span: ${firstTimestamp || '?'} — ${lastTimestamp || '?'}`);
  }

  // Level breakdown
  const levelOrder = ['FATAL', 'CRITICAL', 'ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG'];
  const levelLines: string[] = [];
  for (const lvl of levelOrder) {
    const entry = levelCounts[lvl];
    if (!entry) continue;
    let line = `  ${lvl}: ${entry.count}`;
    if (entry.firstTime) {
      line += entry.firstTime === entry.lastTime
        ? ` (at ${entry.firstTime})`
        : ` (${entry.firstTime} — ${entry.lastTime})`;
    }
    levelLines.push(line);
  }
  if (levelLines.length > 0) {
    parts.push('Levels:\n' + levelLines.join('\n'));
  }

  // Error timestamps for follow-up queries
  if (errorTimestamps.length > 0) {
    parts.push('Error locations: ' + errorTimestamps.join(', '));
  }

  // Components
  if (components.size > 0) {
    parts.push('Components: ' + [...components].sort().join(', '));
  }

  parts.push(
    '\nUse these timestamps/components in follow-up queries:',
    '  time_range: "HH:MM:SS-HH:MM:SS" to zoom into a period',
    '  level: "error" with limit: N to get first N errors',
    '  component: "name" to filter by module',
    '  before/after: N for asymmetric context around matches',
  );

  return parts.join('\n');
}

/**
 * Apply focus filters to reduced output.
 * Keeps matched lines + surrounding context, replaces gaps with annotations.
 * Supports limit/skip for pagination, asymmetric context, and exclusion filters.
 */
function applyFocus(input: string, focus: FocusOptions): string {
  const lines = input.split('\n');

  // Summary mode — return structural overview, skip normal filtering
  if (focus.summary) {
    return buildSummary(lines);
  }

  const ctxBefore = focus.before ?? focus.context ?? 3;
  const ctxAfter = focus.after ?? focus.context ?? 3;
  const timeRange = focus.time_range ? parseTimeRange(focus.time_range) : null;

  // not_grep exclusion regex (compiled once)
  let notGrepRe: RegExp | null = null;
  if (focus.not_grep) {
    try { notGrepRe = new RegExp(focus.not_grep, 'i'); } catch { /* invalid — skip */ }
  }

  // Mark lines that match any active inclusion filter (OR logic)
  const matchedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let isMatch = false;
    if (focus.level && lineMatchesLevel(line, focus.level)) isMatch = true;
    if (focus.grep) {
      try {
        if (new RegExp(focus.grep, 'i').test(line)) isMatch = true;
      } catch { /* invalid regex — skip */ }
    }
    if (focus.contains && line.includes(focus.contains)) isMatch = true;
    if (focus.component && lineMatchesComponent(line, focus.component)) isMatch = true;
    if (timeRange && lineMatchesTimeRange(line, timeRange)) isMatch = true;

    // Apply exclusion filter — remove even if an inclusion filter matched
    if (isMatch && notGrepRe && notGrepRe.test(line)) isMatch = false;

    if (isMatch) matchedIndices.push(i);
  }

  if (matchedIndices.length === 0) return '[no lines matched the focus filters]';

  // Apply skip/limit pagination on matched indices
  const skip = focus.skip ?? 0;
  const limit = focus.limit ?? matchedIndices.length;
  const paginatedMatches = matchedIndices.slice(skip, skip + limit);

  if (paginatedMatches.length === 0) {
    return `[${matchedIndices.length} matches found, but skip=${skip} exceeds match count]`;
  }

  // Pagination header — helps the AI know there are more matches
  let header = '';
  if (skip > 0 || skip + limit < matchedIndices.length) {
    header = `[showing matches ${skip + 1}-${skip + paginatedMatches.length} of ${matchedIndices.length} total]\n`;
  }

  // Expand paginated matches with asymmetric context
  const visible = new Set<number>();
  for (const idx of paginatedMatches) {
    for (let j = Math.max(0, idx - ctxBefore); j <= Math.min(lines.length - 1, idx + ctxAfter); j++) {
      visible.add(j);
    }
  }

  // Build output with gap annotations
  const result: string[] = [];
  let lastVisible = -1;

  for (let i = 0; i < lines.length; i++) {
    if (!visible.has(i)) continue;
    if (lastVisible >= 0 && i - lastVisible > 1) {
      const gap = i - lastVisible - 1;
      result.push(`[... ${gap} line${gap === 1 ? '' : 's'} omitted ...]`);
    }
    result.push(lines[i]);
    lastVisible = i;
  }

  // Trailing gap
  if (lastVisible >= 0 && lastVisible < lines.length - 1) {
    const gap = lines.length - 1 - lastVisible;
    if (gap > 0 && lines[lines.length - 1].trim() !== '') {
      result.push(`[... ${gap} line${gap === 1 ? '' : 's'} omitted ...]`);
    }
  }

  // Post-focus dedup: collapse consecutive runs of near-identical lines.
  // Focus filtering can expose dense blocks of cascading errors (e.g., 80 lines
  // of "GET /api/X → 401 Unauthorized") that differ only in path/ID fragments.
  // A coarse skeleton collapses these into a single line with a count.
  const dedupedResult = postFocusDedup(result);

  return header + dedupedResult.join('\n');
}

/**
 * Lightweight post-focus dedup.
 *
 * After focus filtering + the main pipeline, the output can contain dense blocks
 * of cascading errors that survived dedup because prefix factoring/grouping gave
 * each line a slightly different structure. For example, 75 lines of "401 Unauthorized"
 * errors with different endpoints/IDs and alternating timestamps/indentation.
 *
 * Strategy: extract the "error signature" (the rightmost error-like suffix) from each
 * line, and collapse consecutive runs sharing the same signature.
 */

/** Extract the error-like suffix of a line for grouping.
 *  Strips all structural prefixes (timestamps, levels, components, paths,
 *  dedup markers) and template suffixes (| N = ...) to find the core
 *  error message. Lines with the same core message collapse together. */
function errorSignature(line: string): string {
  // Skip annotations and blank lines
  if (line.startsWith('[...') || line.trim() === '') return '';

  // Strategy: extract the rightmost meaningful error fragment.
  // 1. Strip dedup template suffixes: " | N = 1, 2, 3"
  let s = line.replace(/\s*\|[^|]+$/, '');

  // 2. If there's an arrow (HTTP response), take the part after it
  const arrowIdx = s.indexOf('→');
  if (arrowIdx >= 0) {
    s = s.slice(arrowIdx);
  } else {
    // 3. Otherwise strip all prefixes: whitespace, [xN], timestamps, level, [component]
    s = s
      .replace(/^\s+/, '')
      .replace(/^\[x\d+\]\s*/, '')
      .replace(/^[\d:T.Z{}-]+\s*/g, '')
      .replace(/^(ERROR|WARN|WARNING|INFO|DEBUG|FATAL|CRITICAL)\s*/i, '')
      .replace(/^\[[\w.-]+\]\s*/, '');
  }

  // 4. Normalize variable parts
  s = s
    .replace(/\$\d+/g, '_')
    .replace(/\b[0-9a-f]{6,}\b/gi, '_')
    .replace(/\/[\w./$-]+/g, '/_')
    .replace(/\d+/g, '_')
    .trim();

  return s;
}

function postFocusDedup(lines: string[]): string[] {
  const result: string[] = [];
  let runSig = '';
  let runCount = 0;
  let runFirst = '';

  function flushRun() {
    if (runCount <= 0) return;
    result.push(runFirst);
    if (runCount > 2) {
      result.push(`[... ${runCount - 1} similar lines omitted ...]`);
    } else if (runCount === 2) {
      // Keep a second sample for very short runs
      result.push(runFirst);
    }
  }

  for (const line of lines) {
    const sig = errorSignature(line);
    if (sig !== '' && sig === runSig) {
      runCount++;
    } else {
      flushRun();
      runSig = sig;
      runCount = 1;
      runFirst = line;
    }
  }
  flushRun();
  return result;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function minify(
  input: string,
  options: PipelineOptions = DEFAULT_OPTIONS,
  focus?: FocusOptions,
): string {
  let result = input;

  for (const transform of ALL_TRANSFORMS) {
    if (options[transform.settingKey as SettingKey]) {
      result = transform.apply(result);
    }
  }

  // Apply focus filters if any are active
  if (focus && (focus.level || focus.grep || focus.contains || focus.component || focus.time_range || focus.summary)) {
    result = applyFocus(result, focus);
  }

  return result;
}

export { ALL_TRANSFORMS, DEFAULT_OPTIONS, buildSummary, applyFocus };
