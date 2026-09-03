import { PINT_DATASET_OBSERVED_AT, formatObservedDate } from "@/lib/dataFreshness";
import {
  namedLegacyPintPriceSource,
  type LegacyPintPrice,
} from "@/lib/drinks";

export type NearPriceTrustVenue = {
  id: string;
  cheapestPrice: number | null;
  prices: LegacyPintPrice[];
};

export type NearPriceTrustItem = {
  venueId: string;
  price: number;
  publisher: string | null;
};

export type NearPriceTrustResponse = {
  status: "ready" | "degraded";
  /** Shared Venue Dataset collection day. Never a per-row observation day. */
  collectedAt: string;
  results: NearPriceTrustItem[];
};

export type NearPriceTrustDisplayState =
  | "loading"
  | "named"
  | "unrecorded"
  | "degraded";

export const NEAR_PRICE_TRUST_COLLECTED_DATE =
  PINT_DATASET_OBSERVED_AT.toISOString().slice(0, 10);

export const NEAR_PRICE_TRUST_COLLECTED_AT =
  `Prices last collected ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}.`;

/** Same exact-price and first-row authority used by the Venue sheet. */
export function resolveNearPriceTrust(
  venue: NearPriceTrustVenue,
  expectedPrice: number | null = venue.cheapestPrice,
): NearPriceTrustItem | null {
  if (
    typeof expectedPrice !== "number" ||
    !Number.isFinite(expectedPrice) ||
    expectedPrice <= 0 ||
    venue.cheapestPrice !== expectedPrice
  ) {
    return null;
  }
  const row = venue.prices.find((price) => price.price_gbp === expectedPrice);
  if (!row) return null;
  return {
    venueId: venue.id,
    price: expectedPrice,
    publisher: namedLegacyPintPriceSource(row)?.label ?? null,
  };
}

export function nearPriceTrustLabel(
  state: NearPriceTrustDisplayState,
  publisher: string | null = null,
): string {
  if (state === "loading") return "On record · Checking publisher";
  if (state === "degraded") return "On record · Publisher could not be checked";
  if (state === "unrecorded") return "On record · Publisher not recorded";
  return publisher
    ? `On record · ${publisher}`
    : "On record · Publisher could not be checked";
}
