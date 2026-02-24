import { Transform } from '../types';

/**
 * Hierarchical prefix compression.
 *
 * 1. Silently strips decorative separator lines (====, ----, ****).
 *
 * 2. Extracts the date from structured log lines and emits it once
 *    (or when it changes), then strips it from subsequent lines.
 *
 * 3. Groups consecutive structured lines by module (3+). If all lines
 *    share the same level, the header includes it; otherwise level is
 *    shown per-line.
 *
 * 4. Within a module group, sub-groups consecutive lines sharing the
 *    same timestamp (3+) under a time header.
 *
 * Example:
 *   2026-02-23 20:11:07 - app.encoder - INFO - ============
 *   2026-02-23 20:11:07 - app.encoder - INFO - Frames: 450
 *   2026-02-23 20:11:07 - app.encoder - INFO - FPS: 30
 *   2026-02-23 20:11:07 - app.encoder - INFO - Duration: 15s
 * becomes:
 *   [2026-02-23]
 *   app.encoder - INFO:
 *     20:11:07:
 *       Frames: 450
 *       FPS: 30
 *       Duration: 15s
 */

// Decorative separator lines: repeated =, -, or * (4+ chars), with optional log prefix
const SEPARATOR_WITH_PREFIX = /^.*\b(?:INFO|WARNING|ERROR|DEBUG|WARN|CRITICAL)\s*-\s*[=\-*]{4,}\s*$/;
const SEPARATOR_BARE = /^[=\-*]{4,}\s*$/;

function isSeparatorLine(line: string): boolean {
  return SEPARATOR_WITH_PREFIX.test(line) || SEPARATOR_BARE.test(line);
}

// Parse structured log lines: [DATE] TIME - MODULE - LEVEL - MESSAGE
const STRUCTURED_RE = /^(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{1,2}:\d{2}:\d{2})\s+-\s+(\S+)\s+-\s+(INFO|WARNING|ERROR|DEBUG|WARN|CRITICAL)\s+-\s+(.*)/;

interface Parsed {
  date: string | null;
  time: string;
  module: string;
  level: string;
  message: string;
}

function parseLine(line: string): Parsed | null {
  const m = line.match(STRUCTURED_RE);
  if (!m) return null;
  return { date: m[1] || null, time: m[2], module: m[3], level: m[4], message: m[5] };
}

const MIN_MODULE_GROUP = 3;
const MIN_TIME_GROUP = 3;

export const compressPrefix: Transform = {
  name: 'Compress Prefix',
  settingKey: 'compressPrefix',
  apply(input: string): string {
    // Strip separator lines
    const rawLines = input.split('\n').filter(l => !isSeparatorLine(l));

    // Parse all lines
    const entries = rawLines.map(l => ({ raw: l, parsed: parseLine(l) }));

    const result: string[] = [];
    let currentDate: string | null = null;
    let i = 0;

    while (i < entries.length) {
      const entry = entries[i];

      if (!entry.parsed) {
        // Unstructured line — emit as-is
        result.push(entry.raw);
        i++;
        continue;
      }

      // Emit date header when date first appears or changes
      if (entry.parsed.date && entry.parsed.date !== currentDate) {
        currentDate = entry.parsed.date;
        result.push(`[${currentDate}]`);
      }

      // Find consecutive structured lines with same module
      const mod = entry.parsed.module;
      let j = i + 1;
      while (j < entries.length && entries[j].parsed && entries[j].parsed!.module === mod) {
        // Date change breaks the group
        const p = entries[j].parsed!;
        if (p.date && p.date !== currentDate) {
          break;
        }
        j++;
      }
      const groupSize = j - i;

      if (groupSize < MIN_MODULE_GROUP) {
        // Not enough to group — emit flat lines (without date)
        for (let k = i; k < j; k++) {
          const p = entries[k].parsed!;
          result.push(`${p.time} - ${p.module} - ${p.level} - ${p.message}`);
        }
      } else {
        // Module group — check if all levels are the same
        const levels = new Set<string>();
        for (let k = i; k < j; k++) levels.add(entries[k].parsed!.level);
        const singleLevel = levels.size === 1;

        // Emit module header
        if (singleLevel) {
          result.push(`${mod} - ${entry.parsed.level}:`);
        } else {
          result.push(`${mod}:`);
        }

        // Sub-group by time within the module group
        emitTimeGroups(entries, i, j, singleLevel, result);
      }

      i = j;
    }

    return result.join('\n');
  },
};

function emitTimeGroups(
  entries: { raw: string; parsed: Parsed | null }[],
  start: number,
  end: number,
  singleLevel: boolean,
  result: string[],
): void {
  let k = start;
  while (k < end) {
    const p = entries[k].parsed!;

    // Find consecutive lines with same time
    let m = k + 1;
    while (m < end && entries[m].parsed!.time === p.time) {
      m++;
    }
    const timeGroupSize = m - k;

    if (timeGroupSize < MIN_TIME_GROUP) {
      // Emit time + message flat
      for (let n = k; n < m; n++) {
        const q = entries[n].parsed!;
        if (!singleLevel) {
          result.push(`  ${q.time} - ${q.level} - ${q.message}`);
        } else {
          result.push(`  ${q.time} - ${q.message}`);
        }
      }
    } else {
      // Time sub-group: time header + indented messages
      result.push(`  ${p.time}:`);
      for (let n = k; n < m; n++) {
        const q = entries[n].parsed!;
        if (!singleLevel) {
          result.push(`    ${q.level} - ${q.message}`);
        } else {
          result.push(`    ${q.message}`);
        }
      }
    }
    k = m;
  }
}
