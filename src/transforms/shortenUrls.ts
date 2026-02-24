import { Transform } from '../types';

/**
 * Shorten URLs: strip query parameters/fragments and collapse long paths.
 *
 * Signed URLs (AWS S3/R2, GCS, Azure) are massive token sinks.
 * The query string (?X-Amz-Algorithm=...&X-Amz-Signature=...) carries
 * zero semantic value in a log. Long paths are collapsed to
 * host/.../last-two-segments to preserve the meaningful tail.
 */

const URL_REGEX = /(?:https?|wss?):\/\/[^\s)>\]"']+/g;

function shortenUrl(url: string): string {
  // Strip query parameters and fragments
  let shortened = url.split(/[?#]/)[0];

  // Collapse long URL paths (5+ segments) to host/.../last-2-segments
  const match = shortened.match(/^((?:https?|wss?):\/\/[^/]+)(\/\S*)$/);
  if (match) {
    const segments = match[2].split('/').filter(Boolean);
    if (segments.length >= 5) {
      shortened = match[1] + '/.../' + segments.slice(-2).join('/');
    }
  }

  return shortened;
}

export const shortenUrls: Transform = {
  name: 'Shorten URLs',
  settingKey: 'shortenUrls',
  apply(input: string): string {
    return input.replace(URL_REGEX, shortenUrl);
  },
};
