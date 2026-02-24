import { Transform } from '../types';
import { skeleton } from '../skeleton';

/**
 * Collapse consecutive identical or near-identical lines.
 *
 * "Near-identical" means the lines differ only in parts that look like
 * numbers, timestamps, or IDs (already shortened by previous transforms).
 * We normalize those away and compare the skeleton.
 *
 * When lines differ in specific values, the output shows a template with
 * {N} placeholders and lists the varying values inline.
 */

// Pattern matching the same tokens that skeleton() replaces
const TOKEN_PATTERN = /\$\d+|\d+/g;

// Extract all variable tokens from a line in order
function extractTokens(line: string): string[] {
  return Array.from(line.matchAll(TOKEN_PATTERN), m => m[0]);
}

// Replace only varying token positions with {N} placeholders, keep constant tokens as-is
function buildTemplate(line: string, varyingPositions: Set<number>): string {
  let tokenIndex = 0;
  let varCount = 0;
  const singleVarying = varyingPositions.size === 1;

  return line.replace(TOKEN_PATTERN, (match) => {
    const isVarying = varyingPositions.has(tokenIndex);
    tokenIndex++;
    if (isVarying) {
      varCount++;
      return singleVarying ? '{N}' : `{N${varCount}}`;
    }
    return match;
  });
}

export const deduplicate: Transform = {
  name: 'Deduplicate Lines',
  settingKey: 'deduplicateLines',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let currentSkeleton = '';
    let group: string[] = [];

    function flushGroup() {
      if (group.length === 0) return;

      if (group.length === 1) {
        result.push(group[0]);
        group = [];
        return;
      }

      // Extract tokens from each line to find which positions vary
      const allTokens = group.map(extractTokens);
      const varyingPositions = new Set<number>();

      if (allTokens[0].length > 0) {
        for (let pos = 0; pos < allTokens[0].length; pos++) {
          const firstVal = allTokens[0][pos];
          if (allTokens.some(tokens => tokens[pos] !== firstVal)) {
            varyingPositions.add(pos);
          }
        }
      }

      if (varyingPositions.size === 0) {
        // Truly identical lines
        result.push(group[0]);
        if (group.length > 1) {
          result.push(`[... ${group.length - 1} identical lines omitted ...]`);
        }
      } else {
        // Lines differ in specific values — show template with varying values
        const template = buildTemplate(group[0].replace(/\r$/, ''), varyingPositions);
        const varyingPosArray = Array.from(varyingPositions).sort((a, b) => a - b);

        if (varyingPosArray.length === 1) {
          const values = allTokens.map(t => t[varyingPosArray[0]]).join(', ');
          result.push(`[x${group.length}] ${template} | N = ${values}`);
        } else {
          const valueParts: string[] = [];
          varyingPosArray.forEach((pos, idx) => {
            const label = `N${idx + 1}`;
            const values = allTokens.map(t => t[pos]).join(', ');
            valueParts.push(`${label} = ${values}`);
          });
          result.push(`[x${group.length}] ${template} | ${valueParts.join(' | ')}`);
        }
      }

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

    return result.join('\n');
  },
};
