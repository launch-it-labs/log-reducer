import { Transform, PipelineOptions, DEFAULT_OPTIONS } from './types';
import {
  stripAnsi,
  normalizeWhitespace,
  shortenIds,
  simplifyTimestamps,
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
  deduplicate,
  detectCycles,
  filterNoise,
  foldStackTraces,
];

export function minify(input: string, options: PipelineOptions = DEFAULT_OPTIONS): string {
  let result = input;

  for (const transform of ALL_TRANSFORMS) {
    const key = transform.settingKey as keyof PipelineOptions;
    if (options[key]) {
      result = transform.apply(result);
    }
  }

  return result;
}

export { ALL_TRANSFORMS };
