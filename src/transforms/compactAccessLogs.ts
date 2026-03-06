import { Transform } from '../types';

/**
 * Compact HTTP access log lines into a minimal format.
 *
 * Detects standard access log patterns (Common/Combined Log Format, uvicorn,
 * gunicorn, nginx, Apache, Caddy, etc.) by matching the universal
 * `"METHOD /path HTTP/x.x" STATUS` pattern, then strips boilerplate:
 *   - Internal IP:port
 *   - HTTP protocol version
 *   - Status text (OK, Not Found, …)
 *   - Referer / user-agent / response size
 *
 * Preserves:
 *   - HTTP method + path (semantic)
 *   - Status code (semantic)
 *   - Timestamp if present in the prefix
 *   - Response time if present in the suffix
 *
 * Example:
 *   INFO:     172.16.31.218:49796 - "GET /api/projects HTTP/1.1" 200 OK
 *   → GET /api/projects → 200
 */

const HTTP_METHODS = '(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)';

/**
 * Quoted format (nginx, Apache, uvicorn, gunicorn, Caddy, …):
 *   ... "METHOD /path HTTP/x.x" STATUS ...
 */
const QUOTED_RE = new RegExp(
  `^(.*?)"(${HTTP_METHODS})\\s+(\\S+)\\s+HTTP\\/[\\d.]+"\\s*(\\d{3})\\b(.*)$`,
);

/** Don't compact lines where the prefix indicates an error message. */
const ERROR_PREFIX_RE = /\b(?:error|fail|exception|traceback|fatal|critical|panic|refused|timeout)\b/i;

/** Match a timestamp but NOT an IP:port. Timestamps have HH:MM or HH:MM:SS
 *  and are preceded by whitespace or start-of-string, not by a dot (IP octet). */
const TIMESTAMP_RE = /(?:^|[\s\[])(\d{1,2}:\d{2}(?::\d{2})?)(?=[\s,\]\-]|$)/;
const RESPONSE_TIME_RE = /(\d+\.?\d*)\s*(ms|s)\b/;

export const compactAccessLogs: Transform = {
  name: 'Compact HTTP Access Logs',
  settingKey: 'compactAccessLogs',
  apply(input: string): string {
    return input
      .split('\n')
      .map((line) => {
        const m = line.match(QUOTED_RE);
        if (!m) return line;

        const [, prefix, method, path, status, suffix] = m;

        // Don't compact if the prefix contains error keywords —
        // the line is an error message referencing an HTTP request.
        if (ERROR_PREFIX_RE.test(prefix)) return line;

        // Preserve leading timestamp if present
        const ts = prefix.match(TIMESTAMP_RE);
        const tsStr = ts ? ts[1] + ' ' : '';

        // Preserve response time from suffix if present
        const time = suffix.match(RESPONSE_TIME_RE);
        const timeStr = time ? ` (${time[1]}${time[2]})` : '';

        return `${tsStr}${method} ${path} → ${status}${timeStr}`;
      })
      .join('\n');
  },
};
