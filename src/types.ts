export interface Transform {
  name: string;
  settingKey: string;
  apply(input: string): string;
}

/** Maps each transform's settingKey to a boolean toggle. */
export type PipelineOptions = Record<string, boolean>;
