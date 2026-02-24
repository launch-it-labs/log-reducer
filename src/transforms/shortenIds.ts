import { Transform } from '../types';

// UUID v4: 8-4-4-4-12 hex pattern
const UUID_REGEX = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

// Hex strings (7+ chars, must contain at least one a-f letter to avoid matching pure numbers)
const HEX_REGEX = /\b(?=[0-9a-fA-F]*[a-fA-F])[0-9a-fA-F]{7,}\b/g;

// JWT-like tokens (three base64url segments separated by dots)
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;

// Generic long alphanumeric tokens (20+ chars, mixed case/digits, not plain words)
const TOKEN_REGEX = /\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{20,}\b/g;

// Generated IDs with underscores (e.g., export_1771908476037_2dian9n, clip_1771954950335_lahbf8a)
// Must contain at least one underscore AND at least one digit AND at least one letter, 20+ chars.
const UNDERSCORE_ID_REGEX = /\b(?=[A-Za-z0-9_]*_)(?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[a-zA-Z])[A-Za-z0-9_]{20,}\b/g;

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

    // Underscore-containing generated IDs (least specific, last)
    result = result.replace(UNDERSCORE_ID_REGEX, (match) => getPlaceholder(match));

    return result;
  },
};
