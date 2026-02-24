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
  // Log levels: DEBUG and TRACE
  /\b(?:DEBUG|TRACE)\b/i,

  // Health check endpoints
  /(?:GET|POST|HEAD)\s+\/(?:health|healthz|healthcheck|readyz|livez|ready|alive|ping|status)\b/i,
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
];

export const filterNoise: Transform = {
  name: 'Filter Noise',
  settingKey: 'filterNoise',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let omittedCount = 0;

    function flushOmitted() {
      if (omittedCount > 0) {
        result.push(`[... ${omittedCount} lines omitted ...]`);
        omittedCount = 0;
      }
    }

    for (const line of lines) {
      const isNoise = NOISE_PATTERNS.some((pattern) => pattern.test(line));

      if (isNoise) {
        omittedCount++;
      } else {
        flushOmitted();
        result.push(line);
      }
    }

    flushOmitted();

    return result.join('\n');
  },
};
