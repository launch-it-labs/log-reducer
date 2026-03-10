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
  /** Lines of context to show BEFORE each match (overrides context for before-direction). */
  before?: number;
  /** Lines of context to show AFTER each match (overrides context for after-direction). */
  after?: number;
  /** Minimum severity for context lines. Filters out low-severity lines in the context window
   *  while keeping the matched lines themselves. Lines without a level marker (stack traces,
   *  continuation lines) are always kept. E.g., level: "error", before: 30, context_level: "warning"
   *  shows errors with 30 lines of preceding context, but only WARNING+ lines in context. */
  context_level?: 'error' | 'warning' | 'info' | 'debug';
  /** Filter to specific logger/component names (substring match, case-insensitive). */
  component?: string;
  /** Filter to a time range: "HH:MM-HH:MM" or "HH:MM:SS-HH:MM:SS". */
  time_range?: string;
  /** Regex pattern — EXCLUDE lines matching this pattern (applied after inclusion filters). */
  not_grep?: string;
  /** Max number of matched sections to return. E.g., limit=5 returns first 5 matches. */
  limit?: number;
  /** Skip first N matched sections before applying limit. For pagination: skip=3, limit=2 = matches 4-5. */
  skip?: number;
  /** Return a structural summary instead of filtered content. Shows error/warn counts, timestamps, components. */
  summary?: boolean;
}
