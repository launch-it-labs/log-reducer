import { Transform } from '../types';

/**
 * Filter out low-signal log lines.
 *
 * Removes:
 * - DEBUG/TRACE level lines
 * - Health check endpoints
 * - Heartbeat/keepalive messages
 * - Metric/telemetry emission lines
 * - Empty log entries
 */

const NOISE_PATTERNS: RegExp[] = [
  // Log levels: DEBUG and TRACE (but not file extensions like .debug)
  /(?:^|[\s\[:])(?:DEBUG|TRACE)\b/i,

  // Health check endpoints (with optional path prefix like /api/)
  /(?:GET|POST|HEAD)\s+\S*\/(?:health|healthz|healthcheck|readyz|livez|ready|alive|ping|status)\b/i,
  /health[\s_-]?check/i,

  // Heartbeat / keepalive
  /\bheartbeat\b/i,
  /\bkeepalive\b/i,
  /\bkeep-alive\b/i,

  // Metric emission
  /\bemitting metrics\b/i,
  /\bmetrics? (?:sent|emitted|published|flushed)\b/i,

  // Connection pool noise
  /\bconnection pool\b.*\b(?:stats|status|size)\b/i,

  // GC / memory noise
  /\bGC\b.*\b(?:pause|collected|freed)\b/i,

  // Bare connection open/closed noise
  /^INFO:\s+connection (?:open|closed)\s*$/,

  // Browser devtools noise
  /Download the React DevTools/,

  // Chrome caller annotations: "(anonymous) @ file.js:123" or "funcName @ file.js:123"
  // Also matches the stripped form "funcName @" after source locations are removed.
  /^\s*(?:\(\w+\)|[a-zA-Z_$][\w$]*)\s+@\s*(?:\S+\.\w+:\d+)?\s*$/,

  // Progress bars (pip, npm, cargo, etc.) — completed or in-progress
  /[━░▓█▒■⣿⠿]{4,}/,
  /\[#+\s*\]\s*\d+%/,

  // Docker build boilerplate — internal load/transfer steps that always succeed
  /=>\s+\[internal\]\s+load\s+(?:build definition|\.dockerignore)/,
  /=>\s+=>\s+transferring (?:dockerfile|context):/,
  /=>\s+\[internal\]\s+load metadata for/,

  // pip upgrade notice
  /\[notice\]\s+A new release of pip is available/,
  /\[notice\]\s+To update, run: pip install --upgrade pip/,

];

// Patterns for lines that should be silently dropped (no annotation).
// These are zero-information lines that don't warrant even an "[... N lines omitted ...]" note.
const SILENT_DROP_PATTERNS: RegExp[] = [
  // Bare timestamp-only lines (e.g. Fly.io "fly logs" interleaves "HH:MM:SS" between every log line)
  /^\s*\d{1,2}:\d{2}:\d{2}\s*$/,

  // Chrome caller annotations: "overrideMethod @ installHook.js:1", "(anonymous) @ file.js:123"
  // These appear in browser console output and carry no semantic value.
  /^\s*(?:\(\w+\)|[a-zA-Z_$][\w$]*)\s+@\s*(?:\S+\.\w+:\d+)?\s*$/,

  // Separator lines: rows of = or ~ as the meaningful content of a log line.
  // Matches both bare separator lines and lines where the separator is the message
  // after a log prefix (e.g., "2026-01-01 INFO - ========================").
  // Excludes - and + since those appear in diffs and Python exception group formatting.
  /^[^a-zA-Z0-9]*[=~]{4,}\s*$/,
  /[-=] [=~]{10,}\s*$/,
];

export const filterNoise: Transform = {
  name: 'Filter Noise',
  settingKey: 'filterNoise',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let omittedLines: string[] = [];

    function countTokens(text: string): number {
      return text.split(/\s+/).filter(t => t.length > 0).length;
    }

    function flushOmitted() {
      if (omittedLines.length === 0) return;
      if (omittedLines.length === 1) {
        // A single noise line is silently dropped — the "[... 1 lines omitted ...]"
        // annotation (5 tokens) almost always costs more than the line itself.
        omittedLines = [];
        return;
      }
      const annotation = `[... ${omittedLines.length} lines omitted ...]`;
      const annotationTokens = countTokens(annotation);
      const originalTokens = omittedLines.reduce((sum, l) => sum + countTokens(l), 0);
      if (annotationTokens < originalTokens) {
        result.push(annotation);
      } else {
        // Cheaper to keep the original lines than to annotate
        result.push(...omittedLines);
      }
      omittedLines = [];
    }

    for (const line of lines) {
      const isSilentDrop = SILENT_DROP_PATTERNS.some((p) => p.test(line));
      if (isSilentDrop) continue;

      const isNoise = NOISE_PATTERNS.some((pattern) => pattern.test(line));

      if (isNoise) {
        omittedLines.push(line);
      } else {
        flushOmitted();
        result.push(line);
      }
    }

    flushOmitted();

    return result.join('\n');
  },
};
