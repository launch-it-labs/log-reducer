import { Transform } from '../types';

/**
 * Strip browser console source-location references.
 *
 * Handles two patterns:
 *
 * 1. Prefix: "filename.js:59 [Tag] message" → "[Tag] message"
 *    Browser DevTools prepend "filename.js:line" to console.log output.
 *
 * 2. Suffix: "message index-fFIcDeTa.js:391:39029" → "message"
 *    Some browsers append the source location at the end of error output.
 */

// Match file.ext:line prefix when followed by [Tag]
const CONSOLE_PREFIX_RE = /^(\s*)\S+\.(?:js|jsx|ts|tsx|mjs|cjs):\d+\s+(?=\[)/gm;

// Match trailing source location: " file.ext:line:col" at end of line.
// Requires the file to have a JS/TS extension to avoid false positives.
const CONSOLE_SUFFIX_RE = /\s+\S+\.(?:js|jsx|ts|tsx|mjs|cjs):\d+(?::\d+)?$/gm;

export const stripSourceLocations: Transform = {
  name: 'Strip Source Locations',
  settingKey: 'stripSourceLocations',
  apply(input: string): string {
    return input
      .replace(CONSOLE_PREFIX_RE, '$1')
      .replace(CONSOLE_SUFFIX_RE, '');
  },
};
