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
const TIME_EXTRACT_RE = /\b(\d{1,2}):(\d{2}):(\d{2})\b/;
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
 * Apply focus filters to compressed output.
 * Keeps matched lines + surrounding context, replaces gaps with annotations.
 */
function applyFocus(input: string, focus: FocusOptions): string {
  const lines = input.split('\n');
  const ctx = focus.context ?? 3;
  const timeRange = focus.time_range ? parseTimeRange(focus.time_range) : null;

  // Mark lines that match any active filter (OR logic — useful for debugging)
  const matched = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (focus.level && lineMatchesLevel(line, focus.level)) {
      matched.add(i);
    }
    if (focus.grep) {
      try {
        if (new RegExp(focus.grep, 'i').test(line)) matched.add(i);
      } catch { /* invalid regex — skip */ }
    }
    if (focus.contains && line.includes(focus.contains)) {
      matched.add(i);
    }
    if (focus.component && lineMatchesComponent(line, focus.component)) {
      matched.add(i);
    }
    if (timeRange && lineMatchesTimeRange(line, timeRange)) {
      matched.add(i);
    }
  }

  if (matched.size === 0) return '[no lines matched the focus filters]';

  // Expand matches with context lines
  const visible = new Set<number>();
  for (const idx of matched) {
    for (let j = Math.max(0, idx - ctx); j <= Math.min(lines.length - 1, idx + ctx); j++) {
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

  return result.join('\n');
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
  if (focus && (focus.level || focus.grep || focus.contains || focus.component || focus.time_range)) {
    result = applyFocus(result, focus);
  }

  return result;
}

export { ALL_TRANSFORMS, DEFAULT_OPTIONS };
