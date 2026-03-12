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
  collapseTestStatus,
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
  collapseTestStatus,
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

/** Extract the message portion of a log line (after the level keyword). */
function extractMessage(line: string, levelMatch: RegExpMatchArray): string {
  const idx = line.indexOf(levelMatch[1], levelMatch.index);
  return line.slice(idx + levelMatch[1].length).replace(/^[\s\-:]+/, '').trim();
}

/** Normalize a message for deduplication (collapse variable parts). */
function normalizeMessage(msg: string): string {
  return msg
    .replace(/\$\d+/g, '$X')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\buser_\d+/g, 'user_X')
    .replace(/\bsession_\w+/g, 'session_X');
}

interface UniqueMessage {
  display: string;       // first occurrence (raw message)
  normalized: string;    // for dedup
  count: number;
  firstTime: string | null;
  lastTime: string | null;
}

const MAX_SUMMARY_ERRORS = 20;
const MAX_SUMMARY_WARNINGS = 10;
const MAX_FREQUENT_PATTERNS = 5;

/**
 * Build a structural summary of the log: counts, timestamps, components, and
 * unique error/warning messages (first-N by time order, capped).
 *
 * When no errors or warnings are found, includes top-N frequent message patterns
 * so the AI has something actionable even for "boring" logs.
 */
function buildSummary(lines: string[]): string {
  const levelCounts: Record<string, { count: number; firstTime: string | null; lastTime: string | null }> = {};
  const components = new Set<string>();
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  // Unique error/warning message tracking (first-N by time order)
  const errorMsgs: UniqueMessage[] = [];
  const warnMsgs: UniqueMessage[] = [];
  const errorNormSet = new Map<string, number>(); // normalized → index into errorMsgs
  const warnNormSet = new Map<string, number>();

  // For frequent-patterns fallback (when no errors/warnings)
  const msgCounts = new Map<string, { display: string; count: number }>();

  const COMPONENT_RE = /\[([A-Za-z][\w.-]*)\]|(?:logger|module|component)[=:][\s]*([A-Za-z][\w.-]*)|(?:^|\s)([a-z]+\.[a-z]+[\w.]*)\s*-/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Extract timestamp
    const timeMatch = line.match(TIME_EXTRACT_RE);
    const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}` : null;
    if (timeStr) {
      if (!firstTimestamp) firstTimestamp = timeStr;
      lastTimestamp = timeStr;
    }

    // Count levels and track unique messages
    const levelMatch = line.match(LEVEL_RE);
    if (levelMatch) {
      const lvl = levelMatch[1].toUpperCase();
      if (!levelCounts[lvl]) levelCounts[lvl] = { count: 0, firstTime: null, lastTime: null };
      levelCounts[lvl].count++;
      if (timeStr) {
        if (!levelCounts[lvl].firstTime) levelCounts[lvl].firstTime = timeStr;
        levelCounts[lvl].lastTime = timeStr;
      }

      const msg = extractMessage(line, levelMatch);
      if (msg.length < 3) continue;
      const norm = normalizeMessage(msg);
      const lvlNum = LEVEL_ORDER[lvl.toLowerCase()] ?? 0;

      if (lvlNum >= LEVEL_ORDER['error']) {
        const existing = errorNormSet.get(norm);
        if (existing !== undefined) {
          errorMsgs[existing].count++;
          if (timeStr) errorMsgs[existing].lastTime = timeStr;
        } else {
          const idx = errorMsgs.length;
          errorMsgs.push({ display: msg, normalized: norm, count: 1, firstTime: timeStr, lastTime: timeStr });
          errorNormSet.set(norm, idx);
        }
      } else if (lvlNum >= LEVEL_ORDER['warning']) {
        const existing = warnNormSet.get(norm);
        if (existing !== undefined) {
          warnMsgs[existing].count++;
          if (timeStr) warnMsgs[existing].lastTime = timeStr;
        } else {
          const idx = warnMsgs.length;
          warnMsgs.push({ display: msg, normalized: norm, count: 1, firstTime: timeStr, lastTime: timeStr });
          warnNormSet.set(norm, idx);
        }
      }

      // Track message patterns for frequent-patterns fallback
      if (!msgCounts.has(norm)) {
        msgCounts.set(norm, { display: msg, count: 0 });
      }
      msgCounts.get(norm)!.count++;
    }

    // Extract components
    const compMatch = line.match(COMPONENT_RE);
    if (compMatch) {
      const comp = (compMatch[1] || compMatch[2] || compMatch[3] || '').toLowerCase();
      if (comp) components.add(comp);
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

  // Unique error messages (first-N by time order)
  if (errorMsgs.length > 0) {
    parts.push('');
    parts.push('Errors:');
    const shown = errorMsgs.slice(0, MAX_SUMMARY_ERRORS);
    for (const m of shown) {
      const tr = !m.firstTime ? 'at ?' :
        m.firstTime === m.lastTime ? `at ${m.firstTime}` : `${m.firstTime}—${m.lastTime}`;
      const countStr = m.count > 1 ? `[x${m.count}] ` : '';
      parts.push(`  ${countStr}(${tr}) ${m.display.slice(0, 120)}`);
    }
    if (errorMsgs.length > MAX_SUMMARY_ERRORS) {
      parts.push(`  ... and ${errorMsgs.length - MAX_SUMMARY_ERRORS} more unique errors`);
    }
  }

  // Unique warning messages (first-N by time order)
  if (warnMsgs.length > 0) {
    parts.push('');
    parts.push('Warnings:');
    const shown = warnMsgs.slice(0, MAX_SUMMARY_WARNINGS);
    for (const m of shown) {
      const tr = !m.firstTime ? 'at ?' :
        m.firstTime === m.lastTime ? `at ${m.firstTime}` : `${m.firstTime}—${m.lastTime}`;
      const countStr = m.count > 1 ? `[x${m.count}] ` : '';
      parts.push(`  ${countStr}(${tr}) ${m.display.slice(0, 120)}`);
    }
    if (warnMsgs.length > MAX_SUMMARY_WARNINGS) {
      parts.push(`  ... and ${warnMsgs.length - MAX_SUMMARY_WARNINGS} more unique warnings`);
    }
  }

  // Frequent patterns fallback — when no errors/warnings, show top patterns
  if (errorMsgs.length === 0 && warnMsgs.length === 0 && msgCounts.size > 0) {
    const sorted = [...msgCounts.values()].sort((a, b) => b.count - a.count);
    const topN = sorted.slice(0, MAX_FREQUENT_PATTERNS);
    parts.push('');
    parts.push('Frequent patterns:');
    for (const p of topN) {
      parts.push(`  [x${p.count}] ${p.display.slice(0, 100)}`);
    }
  }

  // Components
  if (components.size > 0) {
    parts.push('');
    parts.push('Components: ' + [...components].sort().join(', '));
  }

  // Smart hints — only suggest filters relevant to the content
  const hints: string[] = [];
  if (errorMsgs.length > 0 || warnMsgs.length > 0) {
    hints.push('  level: "error"                  — all errors with context');
  }
  hints.push('  grep: "pattern"                 — regex search');
  if (firstTimestamp) {
    hints.push('  time_range: "HH:MM:SS-HH:MM:SS" — zoom into a period');
  }
  if (components.size > 1) {
    hints.push('  component: "name"               — filter by module');
  }
  hints.push('  break_threshold: true           — bypass gate, return full output');

  parts.push('');
  parts.push('Narrow with:');
  parts.push(...hints);

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

  // When time_range is set, it acts as an AND scope — only lines within the
  // time window are candidates. Other filters (level, grep, etc.) select within
  // that window via OR logic. When time_range is the *only* filter, all lines
  // in the window are included.
  const hasInclusionFilter = !!(focus.level || focus.grep || focus.contains || focus.component);

  const matchedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // time_range is an AND scope: exclude lines outside the window
    if (timeRange && !lineMatchesTimeRange(line, timeRange)) continue;

    let isMatch = false;

    if (hasInclusionFilter) {
      // OR logic among inclusion filters
      if (focus.level && lineMatchesLevel(line, focus.level)) isMatch = true;
      if (focus.grep) {
        try {
          if (new RegExp(focus.grep, 'i').test(line)) isMatch = true;
        } catch { /* invalid regex — skip */ }
      }
      if (focus.contains && line.includes(focus.contains)) isMatch = true;
      if (focus.component && lineMatchesComponent(line, focus.component)) isMatch = true;
    } else if (timeRange) {
      // time_range is the only filter — include all lines in the window
      isMatch = true;
    }

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
  // context_level filters out low-severity lines in the context window while keeping
  // the matched lines themselves. Lines without a level marker (stack traces, etc.) are always kept.
  const visible = new Set<number>();
  const matchSet = new Set(paginatedMatches);
  for (const idx of paginatedMatches) {
    for (let j = Math.max(0, idx - ctxBefore); j <= Math.min(lines.length - 1, idx + ctxAfter); j++) {
      if (matchSet.has(j)) {
        visible.add(j); // matched lines always included
      } else if (focus.context_level) {
        const lm = lines[j].match(LEVEL_RE);
        // Include if: no level marker (stack traces, continuation) OR level meets threshold
        if (!lm || (LEVEL_ORDER[lm[1].toLowerCase()] ?? 1) >= (LEVEL_ORDER[focus.context_level] ?? 1)) {
          visible.add(j);
        }
      } else {
        visible.add(j);
      }
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

  // Filtered-lines footer: when a level filter is active, count excluded lines by level
  // so the caller can judge whether they're over-filtering.
  let filteredFooter = '';
  if (focus.level) {
    const filteredCounts: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      if (visible.has(i)) continue;
      const lm = lines[i].match(LEVEL_RE);
      if (lm) {
        const lvl = lm[1].toLowerCase() === 'warn' ? 'warning' : lm[1].toLowerCase();
        filteredCounts[lvl] = (filteredCounts[lvl] ?? 0) + 1;
      }
    }
    const displayOrder = ['debug', 'info', 'warning', 'error', 'critical', 'fatal'];
    const parts = displayOrder.filter(l => filteredCounts[l]).map(l => `${filteredCounts[l]} ${l}`);
    if (parts.length > 0) filteredFooter = `\n[filtered: ${parts.join(', ')}]`;
  }

  // Post-focus dedup: collapse consecutive runs of near-identical lines.
  // Focus filtering can expose dense blocks of cascading errors (e.g., 80 lines
  // of "GET /api/X → 401 Unauthorized") that differ only in path/ID fragments.
  // A coarse skeleton collapses these into a single line with a count.
  const dedupedResult = postFocusDedup(result);

  return header + dedupedResult.join('\n') + filteredFooter;
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
