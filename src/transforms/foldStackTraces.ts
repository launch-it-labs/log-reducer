import { Transform } from '../types';

/**
 * Fold stack traces: collapse consecutive framework frames and shorten file paths.
 *
 * Detects stack frames by looking for common patterns:
 * - Java: "at com.example.Class.method(File.java:123)"
 * - Python: '  File "/path/to/file.py", line 123, in function'
 * - Node.js: "    at Object.<anonymous> (/path/to/file.js:123:45)"
 * - .NET: "   at Namespace.Class.Method() in /path/file.cs:line 123"
 * - Go: "\t/path/to/file.go:123 +0x1a2"
 *
 * Handles Python exception group formatting (| prefix).
 * Shortens absolute file paths to package-relative paths.
 * Removes caret indicator lines (^^^).
 *
 * Folding strategy: keep all user-code frames, collapse consecutive runs of
 * framework frames into a summary showing count and framework names.
 */

// Strip Python exception group prefix ("|" with surrounding whitespace)
function stripExcGroupPrefix(line: string): string {
  return line.replace(/^(\s*\|\s*)+/, '');
}

// Get the indentation/prefix from a frame line (preserves | for exc groups)
function getIndent(line: string): string {
  const match = line.match(/^(\s*(?:\|\s*)*)/);
  return match ? match[1] : '    ';
}

// Patterns that indicate a stack frame line (checked after stripping prefix)
const FRAME_PATTERNS = [
  /^\s*at\s+/,                              // Java, Node.js, .NET
  /^\s*File\s+"[^"]+",\s+line\s+\d+/,      // Python
  /^\s*\S+\.go:\d+/,                        // Go
  /^\t*\S+:\d+/,                            // Go alternative
];

// Framework/internal packages to collapse
const FRAMEWORK_PATTERNS = [
  // Java
  /java\.(lang|util|io|net|security)\./,
  /javax\./,
  /sun\./,
  /org\.springframework\./,
  /org\.apache\./,
  /com\.sun\./,
  // Node.js
  /node_modules\//,
  /\(internal\//,
  /\(node:/,
  /at Module\./,
  /at Object\.Module/,
  /at Function\.Module/,
  // Python
  /importlib\._bootstrap/,
  /importlib\._bootstrap_external/,
  /threading\.py/,
  /concurrent\/futures/,
  /asyncio\//,
  /anyio\//,
  /uvicorn\//,
  /starlette\//,
  /fastapi\//,
  /werkzeug\//,
  /django\/core\//,
  /flask\/app\.py/,
  /contextlib\.py/,
  // Go
  /net\/http/,
  /runtime\//,
];

// Map framework patterns to human-readable names for the summary
const FRAMEWORK_NAMES: [RegExp, string][] = [
  [/uvicorn\//, 'uvicorn'],
  [/starlette\//, 'starlette'],
  [/fastapi\//, 'fastapi'],
  [/werkzeug\//, 'werkzeug'],
  [/django\//, 'django'],
  [/flask\//, 'flask'],
  [/asyncio\//, 'asyncio'],
  [/anyio\//, 'anyio'],
  [/contextlib\.py/, 'contextlib'],
  [/javax\./, 'javax'],
  [/org\.springframework\./, 'spring'],
  [/org\.apache\./, 'apache'],
  [/java\.(lang|util|io|net)\./, 'java'],
  [/sun\./, 'java'],
  [/com\.sun\./, 'java'],
  [/node_modules\//, 'node_modules'],
  [/\(internal\//, 'node'],
  [/\(node:/, 'node'],
  [/at Module\./, 'node'],
  [/net\/http/, 'net/http'],
  [/runtime\//, 'runtime'],
];

function isFrameLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line);
  return FRAME_PATTERNS.some((p) => p.test(stripped));
}

function isFrameworkFrame(line: string): boolean {
  return FRAMEWORK_PATTERNS.some((p) => p.test(line));
}

function isCaretLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return /^\^+$/.test(stripped);
}

function getFrameworkName(line: string): string | null {
  for (const [pattern, name] of FRAMEWORK_NAMES) {
    if (pattern.test(line)) return name;
  }
  return null;
}

// Shorten absolute file paths to package-relative paths
function shortenPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');

  // site-packages/package/... → package/...
  const siteIdx = normalized.lastIndexOf('site-packages/');
  if (siteIdx !== -1) return normalized.substring(siteIdx + 'site-packages/'.length);

  // Python stdlib: .../PythonXXX/Lib/foo.py → foo.py
  const libMatch = normalized.match(/Python\d+\/Lib\/(.+)$/);
  if (libMatch) return libMatch[1];

  // Project source: strip common root patterns
  for (const root of ['src/backend/', 'src/frontend/', 'backend/', 'frontend/', 'src/']) {
    const idx = normalized.lastIndexOf(root);
    if (idx !== -1) return normalized.substring(idx + root.length);
  }

  return filePath;
}

function shortenFilePaths(line: string): string {
  return line.replace(/File "([^"]+)"/g, (_, p) => `File "${shortenPath(p)}"`);
}

// Check if a line is a code line belonging to the preceding frame.
// Code lines are indented or have a | prefix. Lines starting at column 0
// (after stripping \r) are never part of a frame.
function isCodeLine(line: string, stripped: string): boolean {
  // Must have leading whitespace or | prefix to be a code line
  const trimmedLine = line.replace(/\r$/, '');
  if (trimmedLine.length > 0 && !/^\s/.test(trimmedLine) && !/^\|/.test(trimmedLine)) return false;
  if (stripped === '') return false;
  if (/^[A-Za-z_][\w.]*(?:Error|Exception|Warning):/.test(stripped)) return false;
  if (/^ExceptionGroup:/.test(stripped)) return false;
  if (/^[-+]+\s/.test(stripped) || /^[-+]+$/.test(stripped)) return false;
  if (/^Traceback\s/.test(stripped)) return false;
  if (/^The above exception/.test(stripped)) return false;
  if (/^During handling/.test(stripped)) return false;
  return true;
}

interface FrameUnit {
  lines: string[];
  isFramework: boolean;
}

// Patterns that introduce a chained traceback
const CHAIN_PATTERNS = [
  /^The above exception was the direct cause of the following exception:$/,
  /^During handling of the above exception, another exception occurred:$/,
];

function isChainIntro(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return CHAIN_PATTERNS.some(p => p.test(stripped));
}

function foldFrameUnits(units: FrameUnit[]): string[] {
  const folded: string[] = [];
  let j = 0;
  while (j < units.length) {
    if (!units[j].isFramework) {
      folded.push(...units[j].lines);
      j++;
    } else {
      const fwStart = j;
      const frameworkNames = new Set<string>();
      while (j < units.length && units[j].isFramework) {
        const name = getFrameworkName(units[j].lines[0]);
        if (name) frameworkNames.add(name);
        j++;
      }
      const count = j - fwStart;
      const indent = getIndent(units[fwStart].lines[0]);
      const names = Array.from(frameworkNames).join(', ');
      if (names) {
        folded.push(`${indent}[... ${count} framework frames (${names}) omitted ...]`);
      } else {
        folded.push(`${indent}[... ${count} frames omitted ...]`);
      }
    }
  }
  return folded;
}

// Separator line: lines like "+----", "+-+---", etc.
function isSeparatorLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return /^[+\-]+$/.test(stripped);
}

// Normalize a folded traceback block for comparison: strip | prefixes, separators, whitespace
function traceSignature(lines: string[]): string {
  return lines
    .filter(l => !isSeparatorLine(l))
    .map(l => stripExcGroupPrefix(l).trim())
    .join('\n');
}

export const foldStackTraces: Transform = {
  name: 'Fold Stack Traces',
  settingKey: 'foldStackTraces',
  apply(input: string): string {
    const rawLines = input.split('\n');

    // Preprocess: shorten file paths and remove caret lines
    const lines: string[] = [];
    for (const line of rawLines) {
      if (isCaretLine(line)) continue;
      lines.push(shortenFilePaths(line));
    }

    const result: string[] = [];
    const seenTraces: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (isFrameLine(lines[i])) {
        // Collect frame units (frame line + optional following code lines)
        const units: FrameUnit[] = [];

        while (i < lines.length && isFrameLine(lines[i])) {
          const frameLine = lines[i];
          const unitLines = [frameLine];
          i++;

          // Consume following non-frame lines as code lines of this frame
          while (i < lines.length && !isFrameLine(lines[i])) {
            const stripped = stripExcGroupPrefix(lines[i]).trim();
            if (!isCodeLine(lines[i], stripped)) break;
            unitLines.push(lines[i]);
            i++;
          }

          units.push({
            lines: unitLines,
            isFramework: isFrameworkFrame(frameLine),
          });
        }

        // Fold framework frames
        const folded = foldFrameUnits(units);

        // Collect trailing exception message lines (non-frame, non-empty, not a chain intro)
        const traceBlock = [...folded];
        while (i < lines.length) {
          const stripped = stripExcGroupPrefix(lines[i]).trim();
          if (stripped === '') break;
          if (isFrameLine(lines[i])) break;
          if (isChainIntro(lines[i])) break;
          if (/^Traceback\s/.test(stripped)) break;
          if (/^\+\s*Exception Group/.test(stripped)) break;
          // Stop at regular log lines (timestamp or log-level prefix)
          if (/^(INFO|ERROR|WARN|DEBUG|TRACE|FATAL)\b/.test(stripped)) break;
          if (/^\d{4}-\d{2}-\d{2}[\sT]/.test(stripped)) break;
          traceBlock.push(lines[i]);
          i++;
        }

        // Check if this trace is a duplicate of a previous one
        const sig = traceSignature(traceBlock);
        const dupIndex = seenTraces.indexOf(sig);
        if (dupIndex !== -1) {
          result.push(`  [... duplicate traceback omitted ...]`);
        } else {
          seenTraces.push(sig);
          result.push(...traceBlock);
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  },
};
