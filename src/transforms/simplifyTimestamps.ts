import { Transform } from '../types';

// ISO 8601 timestamps: 2024-01-15T14:32:01.123456Z or with timezone offset
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})/g;

// Common log timestamps: 2024-01-15 14:32:01,123 or 2024-01-15 14:32:01.123
const LOG_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.,]\d{1,6}/g;

// Epoch milliseconds in obvious contexts (13-digit numbers)
const EPOCH_MS_REGEX = /\b1[5-9]\d{11}\b/g;

// Syslog-style: Jan 15 14:32:01
const SYSLOG_TIMESTAMP_REGEX = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/g;

function simplifyIso(match: string): string {
  // 2024-01-15T14:32:01.123456Z → 14:32:01
  const timeMatch = match.match(/(\d{2}:\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : match;
}

function simplifyLogTimestamp(match: string): string {
  // 2024-01-15 14:32:01,123456 → 14:32:01
  const timeMatch = match.match(/(\d{2}:\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : match;
}

function simplifySyslog(match: string): string {
  // Jan 15 14:32:01 → 14:32:01
  const timeMatch = match.match(/(\d{2}:\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : match;
}

export const simplifyTimestamps: Transform = {
  name: 'Simplify Timestamps',
  settingKey: 'simplifyTimestamps',
  apply(input: string): string {
    let result = input;
    result = result.replace(ISO_TIMESTAMP_REGEX, simplifyIso);
    result = result.replace(LOG_TIMESTAMP_REGEX, simplifyLogTimestamp);
    result = result.replace(EPOCH_MS_REGEX, '<epoch>');
    result = result.replace(SYSLOG_TIMESTAMP_REGEX, simplifySyslog);
    return result;
  },
};
