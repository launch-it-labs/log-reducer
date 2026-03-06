import { Transform } from '../types';

/**
 * Collapse runs of Docker layer push/export lines into a single summary.
 *
 * Docker build output often contains 10-30+ lines like:
 *   => => pushing layer sha256:abc123   0.9s
 * Each line differs only by hash and timing — no diagnostic value per-layer.
 *
 * This transform collapses consecutive runs into:
 *   => => pushing 10 layers  0.1s-102.3s
 */

// Matches " => => pushing layer sha256:XXXX   1.0s" (hash may already be shortened to $N)
const PUSH_LAYER_RE = /^(\s*=>\s+=>\s+)pushing layer\s+\S+\s+(\d+\.?\d*)s\s*$/;

// Matches " => => exporting layer sha256:XXXX   0.0s"
const EXPORT_LAYER_RE = /^(\s*=>\s+=>\s+)exporting layer\s+\S+\s+(\d+\.?\d*)s\s*$/;

function collapseRun(
  prefix: string,
  verb: string,
  times: number[],
): string {
  const count = times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = min === max ? `${min}s` : `${min}s-${max}s`;
  return `${prefix}${verb} ${count} layers  ${range}`;
}

export const collapseDockerLayers: Transform = {
  name: 'Collapse Docker Layers',
  settingKey: 'collapseDockerLayers',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      // Try pushing layer pattern
      let match = lines[i].match(PUSH_LAYER_RE);
      let re = PUSH_LAYER_RE;
      let verb = 'pushing';

      // Try exporting layer pattern
      if (!match) {
        match = lines[i].match(EXPORT_LAYER_RE);
        re = EXPORT_LAYER_RE;
        verb = 'exporting';
      }

      if (!match) {
        result.push(lines[i]);
        i++;
        continue;
      }

      // Collect consecutive lines matching the same pattern
      const prefix = match[1];
      const runLines: string[] = [lines[i]];
      const times: number[] = [parseFloat(match[2])];
      i++;

      while (i < lines.length) {
        const m = lines[i].match(re);
        if (!m) break;
        runLines.push(lines[i]);
        times.push(parseFloat(m[2]));
        i++;
      }

      if (runLines.length === 1) {
        // Single line — not worth collapsing
        result.push(runLines[0]);
      } else {
        result.push(collapseRun(prefix, verb, times));
      }
    }

    return result.join('\n');
  },
};
