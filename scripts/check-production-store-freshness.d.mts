export type FreshnessRegistry = {
  datasets?: Array<{
    id: string;
    stamp?: { kind?: string };
  }>;
};

export type ProductionStoreFreshnessOptions = {
  registry: FreshnessRegistry;
  fetchImpl?: typeof fetch;
  url?: string;
  now?: number;
  artifactStamps?: Record<string, string>;
};

export function checkProductionStoreFreshness(
  options: ProductionStoreFreshnessOptions,
): Promise<string[]>;
