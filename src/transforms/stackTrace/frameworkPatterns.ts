/**
 * Framework and stack-frame detection patterns.
 *
 * Identifies stack frame lines across Java, Python, Node.js, .NET, and Go,
 * and classifies frames as framework/internal vs user code.
 */

// Patterns that indicate a stack frame line (checked after stripping exc-group prefix)
export const FRAME_PATTERNS = [
  /^\s*at\s+/,                              // Java, Node.js, .NET
  /^\s*File\s+"[^"]+",\s+line\s+\d+/,      // Python
  /^\s*\S+\.go:\d+/,                        // Go
  /^\t*\S+:\d+/,                            // Go alternative
];

// Framework/internal packages to collapse.
// Each entry has a pattern to match and an optional human-readable name for summaries.
export const FRAMEWORKS: { pattern: RegExp; name: string | null }[] = [
  // Java
  { pattern: /java\.(lang|util|io|net|security)\./, name: 'java' },
  { pattern: /javax\./, name: 'javax' },
  { pattern: /sun\./, name: 'java' },
  { pattern: /com\.sun\./, name: 'java' },
  { pattern: /org\.springframework\./, name: 'spring' },
  { pattern: /org\.apache\./, name: 'apache' },
  // Node.js
  { pattern: /node_modules\//, name: 'node_modules' },
  { pattern: /\(internal\//, name: 'node' },
  { pattern: /\(node:/, name: 'node' },
  { pattern: /at Module\./, name: 'node' },
  { pattern: /at Object\.Module/, name: null },
  { pattern: /at Function\.Module/, name: null },
  // Python
  { pattern: /importlib\._bootstrap/, name: null },
  { pattern: /importlib\._bootstrap_external/, name: null },
  { pattern: /threading\.py/, name: null },
  { pattern: /concurrent\/futures/, name: null },
  { pattern: /asyncio\//, name: 'asyncio' },
  { pattern: /anyio\//, name: 'anyio' },
  { pattern: /uvicorn\//, name: 'uvicorn' },
  { pattern: /starlette\//, name: 'starlette' },
  { pattern: /fastapi\//, name: 'fastapi' },
  { pattern: /werkzeug\//, name: 'werkzeug' },
  { pattern: /django\/core\//, name: 'django' },
  { pattern: /flask\/app\.py/, name: 'flask' },
  { pattern: /contextlib\.py/, name: 'contextlib' },
  // Go
  { pattern: /net\/http/, name: 'net/http' },
  { pattern: /runtime\//, name: 'runtime' },
];

export function isFrameworkFrame(line: string): boolean {
  return FRAMEWORKS.some((f) => f.pattern.test(line));
}

export function getFrameworkName(line: string): string | null {
  for (const f of FRAMEWORKS) {
    if (f.pattern.test(line)) return f.name;
  }
  return null;
}
