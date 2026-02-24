export interface Transform {
  readonly name: string;
  readonly settingKey: string;
  apply(input: string): string;
}

/** Known setting keys — one per transform in the pipeline. */
export type SettingKey =
  | 'stripAnsi'
  | 'normalizeWhitespace'
  | 'shortenIds'
  | 'shortenUrls'
  | 'simplifyTimestamps'
  | 'deduplicateLines'
  | 'detectCycles'
  | 'filterNoise'
  | 'stripSourceLocations'
  | 'foldStackTraces'
  | 'compressPrefix';

/** Maps each transform's settingKey to a boolean toggle. */
export type PipelineOptions = Record<SettingKey, boolean>;
