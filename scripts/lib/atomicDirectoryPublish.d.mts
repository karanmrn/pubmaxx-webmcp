export function publishStagedDirectory(options: {
  stagedDir: string;
  targetDir: string;
  requiredFiles?: string[];
  manifestBudgetBytes?: number;
  totalBudgetBytes?: number;
  /** URL prefix the staged manifest must claim. Defaults to the pub layer's. */
  urlPrefix?: string;
}): Promise<{
  generation: string;
  manifestBytes: number;
  shardBytes: number;
  totalBytes: number;
}>;
