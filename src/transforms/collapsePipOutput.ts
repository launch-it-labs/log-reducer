import { Transform } from '../types';

/**
 * Collapse verbose pip install output into a compact package list.
 *
 * Handles:
 * - Pairs of "Collecting pkg==ver" / "Downloading pkg-ver.whl" lines
 * - Pip-internal elapsed-time prefixes (e.g., "2.275 Collecting ...")
 * - Transitive dependency lines (those with "from pkg->..." annotations)
 * - "INFO: pip is looking at multiple versions" noise
 * - Omission markers left by earlier transforms (e.g., "[... N lines omitted ...]")
 *
 * The output preserves the actual error (if any) and collapses the
 * download/collect chatter into a single summary line per section.
 */

// Matches a pip elapsed-time prefix: "2.275 Collecting ..." or "  10.42   Downloading ..."
const PIP_ELAPSED_PREFIX = /^\s*\d+\.\d+\s+/;

// "Collecting foo==1.2.3 (from -r requirements.txt (line 5))"
const COLLECTING_DIRECT = /^\s*Collecting\s+([\w_.-]+(?:==[\w.]+)?)\s+\(from\s+-r\s+/;
// "Collecting foo>=1.2.3 (from bar==1.0->...)"  — transitive dep
const COLLECTING_TRANSITIVE = /^\s*Collecting\s+([\w_.-]+(?:[><=!~]+[\w.*]+)?)\s+\(from\s+(?!-r\s+)/;
// "Collecting foo==1.2.3" with no "from" — also direct
const COLLECTING_BARE = /^\s*Collecting\s+([\w_.-]+(?:==[\w.]+)?)\s*$/;

// "Downloading foo-1.2.3-py3-none-any.whl..."
const DOWNLOADING = /^\s*Downloading\s+/;

// "INFO: pip is looking at multiple versions..."
const PIP_INFO = /^\s*INFO:\s+pip is looking at multiple versions/;

// Omission markers from earlier transforms: "[... 3 lines omitted ...]"
const OMISSION_MARKER = /^\[\.{3}\s+\d+\s+\w+\s+omitted\s+\.{3}\]$/;

// Detect if we're inside a pip install invocation
const PIP_INSTALL_START = /pip install\b/;

// Lines that signal the end of the pip install section
// (next Docker step, hard error, or a build-level separator)
// Matches BuildKit "=> ..." steps and classic "#N ..." steps (Depot/buildx)
const PIP_SECTION_END = /^\s*=>|^#\d+\s/;

// Lines that are the actual pip error output — stop collecting but don't skip
const PIP_ERROR = /^\s*(\d+\.\d+\s+)?ERROR:/;

// Lines inside a pip output block that are purely noise
function isPipNoiseLine(stripped: string): boolean {
  return DOWNLOADING.test(stripped) || PIP_INFO.test(stripped);
}

// Lines that are blank or just an elapsed-time prefix with nothing meaningful
function isBlankOrPrefix(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  // Just a number (elapsed prefix with nothing after)
  if (/^\d+\.\d+\s*$/.test(trimmed)) return true;
  return false;
}

export const collapsePipOutput: Transform = {
  name: 'Collapse Pip Output',
  settingKey: 'collapsePipOutput',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];

    let i = 0;
    while (i < lines.length) {
      // Look for the start of a pip install block
      if (PIP_INSTALL_START.test(lines[i])) {
        result.push(lines[i]);
        i++;

        const directPkgs: string[] = [];
        const transitivePkgs: string[] = [];

        // Consume pip output lines until we hit a section boundary or error
        while (i < lines.length) {
          const line = lines[i];

          // Hard stop: next Docker build step
          if (PIP_SECTION_END.test(line)) break;

          // Hard stop: pip ERROR line — flush summary, then let outer loop handle it
          if (PIP_ERROR.test(line)) break;

          // Strip the elapsed-time prefix for analysis
          const stripped = line.replace(PIP_ELAPSED_PREFIX, '');

          const directMatch = stripped.match(COLLECTING_DIRECT) || stripped.match(COLLECTING_BARE);
          const transitiveMatch = stripped.match(COLLECTING_TRANSITIVE);

          if (directMatch) {
            directPkgs.push(directMatch[1]);
            i++;
          } else if (transitiveMatch) {
            transitivePkgs.push(transitiveMatch[1]);
            i++;
          } else if (isPipNoiseLine(stripped)) {
            i++;
          } else if (OMISSION_MARKER.test(line.trim())) {
            // Skip markers left by filterNoise (progress bars, etc.)
            i++;
          } else if (isBlankOrPrefix(line)) {
            i++;
          } else {
            // Unknown line inside pip block — skip it (likely noise we didn't categorize)
            i++;
          }
        }

        // Emit compact summary
        if (directPkgs.length > 0) {
          result.push(`pip: ${directPkgs.join(' ')}`);
        }
        if (transitivePkgs.length > 0) {
          result.push(`pip: +${transitivePkgs.length} transitive deps (${transitivePkgs.join(' ')})`);
        }

        // Continue emitting remaining lines (errors, etc.) in the outer loop
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  },
};
