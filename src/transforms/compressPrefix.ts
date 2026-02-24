import { Transform } from '../types';

/**
 * Compress repeated log line prefixes.
 *
 * 1. Silently strips decorative separator lines (====, ----, ****) that carry
 *    no semantic information, whether standalone or after a log prefix.
 *
 * 2. When 3+ consecutive lines share the same "timestamp - module - LEVEL -" prefix,
 *    emit the prefix once as a header line and indent the remaining suffixes.
 *
 * Example:
 *   20:11:07 - app.video_encoder - INFO - ============================
 *   20:11:07 - app.video_encoder - INFO - Total frames: 450
 *   20:11:07 - app.video_encoder - INFO - FPS: 30
 *   20:11:07 - app.video_encoder - INFO - Duration: 15s
 *   20:11:07 - app.video_encoder - INFO - ============================
 * becomes:
 *   20:11:07 - app.video_encoder - INFO:
 *     Total frames: 450
 *     FPS: 30
 *     Duration: 15s
 */

// Match common log prefix patterns:
// "TIMESTAMP - module.name - LEVEL - " with optional date before time
// e.g. "20:11:07 - app.foo - INFO - " or "2026-02-23 20:11:07 - app.foo - INFO - "
const PREFIX_PATTERN = /^((?:\d{4}-\d{2}-\d{2}\s+)?\d{1,2}:\d{2}:\d{2}\s+-\s+\S+\s+-\s+(?:INFO|WARNING|ERROR|DEBUG|WARN|CRITICAL)\s+-\s+)/;

// Decorative separator lines: only repeated =, -, or * (4+ chars), with optional log prefix
const SEPARATOR_WITH_PREFIX = /^.*\b(?:INFO|WARNING|ERROR|DEBUG|WARN|CRITICAL)\s*-\s*[=\-*]{4,}\s*$/;
const SEPARATOR_BARE = /^[=\-*]{4,}\s*$/;

function isSeparatorLine(line: string): boolean {
  return SEPARATOR_WITH_PREFIX.test(line) || SEPARATOR_BARE.test(line);
}

function getPrefix(line: string): string | null {
  const match = line.match(PREFIX_PATTERN);
  return match ? match[1] : null;
}

const MIN_GROUP_SIZE = 3;

export const compressPrefix: Transform = {
  name: 'Compress Prefix',
  settingKey: 'compressPrefix',
  apply(input: string): string {
    // First pass: silently strip decorative separator lines
    const lines = input.split('\n').filter(line => !isSeparatorLine(line));
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const prefix = getPrefix(lines[i]);

      if (!prefix) {
        result.push(lines[i]);
        i++;
        continue;
      }

      // Count consecutive lines with the same prefix
      let j = i + 1;
      while (j < lines.length && getPrefix(lines[j]) === prefix) {
        j++;
      }
      const groupSize = j - i;

      if (groupSize < MIN_GROUP_SIZE) {
        // Not enough lines to justify compression, emit as-is
        for (let k = i; k < j; k++) {
          result.push(lines[k]);
        }
      } else {
        // Emit prefix once as header, then indent suffixes
        const prefixTrimmed = prefix.replace(/\s+-\s+$/, '').replace(/\s+-\s+(\S+)$/, ' - $1:');
        result.push(prefixTrimmed);
        for (let k = i; k < j; k++) {
          const suffix = lines[k].substring(prefix.length);
          result.push('  ' + suffix);
        }
      }

      i = j;
    }

    return result.join('\n');
  },
};
