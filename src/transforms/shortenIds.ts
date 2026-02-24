import { Transform } from '../types';

// UUID v4: 8-4-4-4-12 hex pattern
const UUID_REGEX = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

// Long hex strings (16+ chars, likely hashes/tokens/commit SHAs)
const HEX_REGEX = /\b[0-9a-fA-F]{16,}\b/g;

// JWT-like tokens (three base64url segments separated by dots)
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;

// Generic long alphanumeric tokens (20+ chars, mixed case/digits, not plain words)
const TOKEN_REGEX = /\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{20,}\b/g;

export const shortenIds: Transform = {
  name: 'Shorten IDs',
  settingKey: 'shortenIds',
  apply(input: string): string {
    const idMap = new Map<string, string>();
    let counter = 1;

    function getPlaceholder(original: string): string {
      let placeholder = idMap.get(original);
      if (!placeholder) {
        placeholder = `$${counter}`;
        counter++;
        idMap.set(original, placeholder);
      }
      return placeholder;
    }

    // Apply replacements in order of specificity (most specific first)
    let result = input;

    // JWTs first (longest, most specific)
    result = result.replace(JWT_REGEX, (match) => getPlaceholder(match));

    // UUIDs next
    result = result.replace(UUID_REGEX, (match) => getPlaceholder(match));

    // Long hex strings
    result = result.replace(HEX_REGEX, (match) => getPlaceholder(match));

    // Generic long tokens
    result = result.replace(TOKEN_REGEX, (match) => getPlaceholder(match));

    return result;
  },
};
