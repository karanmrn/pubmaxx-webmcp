export type EnrichmentCliArgs = {
  city: string;
  maxQueries: number;
  reset: boolean;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): EnrichmentCliArgs;

export function pruneManagedCityPrices<T extends {
  venueKey?: string;
  source?: { licence?: string; [key: string]: unknown };
}>(existing: T[], cityVenueKeys: Set<string>): T[];
