import { Transform } from '../types';

/**
 * Strip browser console source-location prefixes.
 *
 * Browser DevTools prepend "filename.js:line" to console.log output.
 * When the line also contains a [Tag] identifier, the file:line prefix
 * is redundant and wastes tokens.
 *
 * Example:
 *   useExportRecovery.js:59 [ExportRecovery] Checking Modal status...
 * becomes:
 *   [ExportRecovery] Checking Modal status...
 */

// Match file.ext:line prefix when followed by [Tag]
// Only matches JS/TS extensions to avoid false positives on stack traces.
const CONSOLE_PREFIX_RE = /^(\s*)\S+\.(?:js|jsx|ts|tsx|mjs|cjs):\d+\s+(?=\[)/gm;

export const stripSourceLocations: Transform = {
  name: 'Strip Source Locations',
  settingKey: 'stripSourceLocations',
  apply(input: string): string {
    return input.replace(CONSOLE_PREFIX_RE, '$1');
  },
};
