import { Transform, PipelineOptions, SettingKey } from './types';
import {
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  shortenUrls,
  simplifyTimestamps,
  compressPrefix,
  deduplicate,
  detectCycles,
  filterNoise,
  stripSourceLocations,
  foldStackTraces,
} from './transforms';

/**
 * The ordered list of all transforms.
 * Order matters — e.g., IDs should be shortened before URLs are collapsed,
 * and both run before deduplication so lines differing only by ID/URL match.
 */
const ALL_TRANSFORMS: Transform[] = [
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  shortenUrls,
  simplifyTimestamps,
  filterNoise,
  stripSourceLocations,
  compressPrefix,
  deduplicate,
  detectCycles,
  foldStackTraces,
];

/** All transforms enabled by default — derived from ALL_TRANSFORMS. */
const DEFAULT_OPTIONS = Object.fromEntries(
  ALL_TRANSFORMS.map(t => [t.settingKey, true])
) as PipelineOptions;

export function minify(input: string, options: PipelineOptions = DEFAULT_OPTIONS): string {
  let result = input;

  for (const transform of ALL_TRANSFORMS) {
    if (options[transform.settingKey as SettingKey]) {
      result = transform.apply(result);
    }
  }

  return result;
}

export { ALL_TRANSFORMS, DEFAULT_OPTIONS };
