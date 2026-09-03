export type HarvestSeedMetadata = Map<string, { name: string; town: string | null }>;

export function buildSeedMetadata(rows: unknown, filePath: string): HarvestSeedMetadata;

export function loadSeedMetadata(
  filePath: string,
  readJsonl: (filePath: string) => Promise<unknown>,
): Promise<HarvestSeedMetadata>;
