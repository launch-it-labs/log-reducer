import { Transform } from '../types';

export const normalizeWhitespace: Transform = {
  name: 'Normalize Whitespace',
  settingKey: 'normalizeWhitespace',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let consecutiveBlanks = 0;

    for (const line of lines) {
      // Trim trailing whitespace from each line
      const trimmed = line.trimEnd();

      if (trimmed === '') {
        consecutiveBlanks++;
        // Allow at most one blank line in a row
        if (consecutiveBlanks <= 1) {
          result.push('');
        }
      } else {
        consecutiveBlanks = 0;
        result.push(trimmed);
      }
    }

    // Remove leading and trailing blank lines from the entire output
    while (result.length > 0 && result[0] === '') {
      result.shift();
    }
    while (result.length > 0 && result[result.length - 1] === '') {
      result.pop();
    }

    return result.join('\n');
  },
};
