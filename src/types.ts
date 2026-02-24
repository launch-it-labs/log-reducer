export interface Transform {
  name: string;
  settingKey: string;
  apply(input: string): string;
}

export interface PipelineOptions {
  stripAnsi: boolean;
  normalizeWhitespace: boolean;
  shortenIds: boolean;
  simplifyTimestamps: boolean;
  deduplicateLines: boolean;
  detectCycles: boolean;
  filterNoise: boolean;
  foldStackTraces: boolean;
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  stripAnsi: true,
  normalizeWhitespace: true,
  shortenIds: true,
  simplifyTimestamps: true,
  deduplicateLines: true,
  detectCycles: true,
  filterNoise: true,
  foldStackTraces: true,
};
