import { Transform } from '../types';

/**
 * Detect repeating multi-line blocks (cycles).
 *
 * Strategy: Use a sliding window approach. For each position, check if
 * the next N lines repeat the previous N lines. When a cycle is found,
 * count how many times it repeats and collapse.
 */

function skeleton(line: string): string {
  return line
    .replace(/\$\d+/g, '<ID>')
    .replace(/\b\d+\b/g, '<N>')
    .replace(/\d{2}:\d{2}:\d{2}/g, '<T>')
    .replace(/<epoch>/g, '<T>')
    .trim();
}

function linesMatch(a: string[], b: string[], startA: number, startB: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (skeleton(a[startA + i]) !== skeleton(b[startB + i])) {
      return false;
    }
  }
  return true;
}

export const detectCycles: Transform = {
  name: 'Detect Cycles',
  settingKey: 'detectCycles',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let i = 0;

    // Try cycle lengths from 2 to 20 lines
    const MIN_CYCLE = 2;
    const MAX_CYCLE = 20;

    while (i < lines.length) {
      let foundCycle = false;

      for (let cycleLen = MIN_CYCLE; cycleLen <= MAX_CYCLE && i + cycleLen <= lines.length; cycleLen++) {
        // Check how many times the block starting at i repeats
        let reps = 1;
        let pos = i + cycleLen;

        while (pos + cycleLen <= lines.length && linesMatch(lines, lines, i, pos, cycleLen)) {
          reps++;
          pos += cycleLen;
        }

        // Only collapse if the block repeats 3+ times (meaningful cycle)
        if (reps >= 3) {
          // Emit the first occurrence
          for (let j = 0; j < cycleLen; j++) {
            result.push(lines[i + j]);
          }
          result.push(`[... above ${cycleLen}-line block repeated ${reps - 1} more times ...]`);
          i = pos;
          foundCycle = true;
          break;
        }
      }

      if (!foundCycle) {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  },
};
