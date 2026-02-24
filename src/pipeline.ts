import { Transform, PipelineOptions } from './types';
import {
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  simplifyTimestamps,
  compressPrefix,
  deduplicate,
  detectCycles,
  filterNoise,
  foldStackTraces,
} from './transforms';

/**
 * The ordered list of all transforms.
 * Order matters — e.g., IDs should be shortened before deduplication
 * so that lines differing only by ID are recognized as duplicates.
 */
const ALL_TRANSFORMS: Transform[] = [
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  simplifyTimestamps,
  filterNoise,
  compressPrefix,
  deduplicate,
  detectCycles,
  foldStackTraces,
];

/** All transforms enabled by default — derived from ALL_TRANSFORMS. */
const DEFAULT_OPTIONS: PipelineOptions = Object.fromEntries(
  ALL_TRANSFORMS.map(t => [t.settingKey, true])
);

export function minify(input: string, options: PipelineOptions = DEFAULT_OPTIONS): string {
  let result = input;

  for (const transform of ALL_TRANSFORMS) {
    if (options[transform.settingKey]) {
      result = transform.apply(result);
    }
  }

  return result;
}

export { ALL_TRANSFORMS, DEFAULT_OPTIONS };
