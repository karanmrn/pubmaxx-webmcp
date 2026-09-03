export type SlimCurationInput = {
  pub_name?: unknown;
  address?: unknown;
  description?: unknown;
  comment?: unknown;
  price_gbp?: number | null;
  source_datasets?: unknown;
};

export function buildCurationHints(prices: readonly SlimCurationInput[]): {
  nearWater: boolean;
  hasStory: boolean;
};

export function assertCurrentFamousVenueRows<
  T extends {
    id: string;
    observedAt: string;
    expiresAt: string;
  },
>(rows: T[], now: Date | number): T[];

export function typeRelativePriceBands<
  T extends {
    id: string;
    kind: "bar" | "food" | "restaurant";
    anchor: { price: number };
  },
>(rows: readonly T[]): Map<string, 0 | 1 | 2>;
