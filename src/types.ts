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
  | 'compressPrefix'
  | 'collapsePipOutput'
  | 'collapseRetries'
  | 'collapseDockerLayers'
  | 'stripEnvelope'
  | 'mergeScattered'
  | 'compactAccessLogs'
  | 'foldRepeatedPrefix';

/** Maps each transform's settingKey to a boolean toggle. */
export type PipelineOptions = Record<SettingKey, boolean>;

/** Focus filters — narrow compressed output to what matters for debugging. */
export interface FocusOptions {
  /** Minimum log level to keep: 'error' | 'warning' | 'info' | 'debug'. */
  level?: 'error' | 'warning' | 'info' | 'debug';
  /** Regex pattern — keep only lines matching this pattern (+ context). */
  grep?: string;
  /** Literal string — keep only lines containing this text (+ context). */
  contains?: string;
  /** Lines of context to show around matched lines (default 3). */
  context?: number;
  /** Filter to specific logger/component names (substring match, case-insensitive). */
  component?: string;
  /** Filter to a time range: "HH:MM-HH:MM" or "HH:MM:SS-HH:MM:SS". */
  time_range?: string;
}
