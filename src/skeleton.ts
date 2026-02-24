import { EPOCH_PLACEHOLDER } from './transforms/simplifyTimestamps';

// Precompiled regex for the epoch placeholder (avoids rebuilding on every call)
const EPOCH_RE = new RegExp(EPOCH_PLACEHOLDER.replace(/[<>]/g, '\\$&'), 'g');

/**
 * Normalize a line into a "skeleton" for comparison.
 *
 * Replaces $-placeholders, numbers, timestamps, and epoch markers
 * so that lines differing only in those values are considered identical.
 *
 * Used by both deduplicate and detectCycles.
 */
export function skeleton(line: string): string {
  return line
    .replace(/\$\d+/g, '<ID>')        // Already-shortened IDs
    .replace(/\d+/g, '<N>')           // Numbers (no \b — matches 2574MB, v2, etc.)
    .replace(/\d{2}:\d{2}:\d{2}/g, '<T>')  // Times (HH:MM:SS)
    .replace(EPOCH_RE, '<T>')          // Epoch placeholders from timestamp transform
    .trim();
}
