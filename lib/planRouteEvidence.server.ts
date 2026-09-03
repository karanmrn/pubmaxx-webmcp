import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  buildPriceEvidence,
  type AccessEvidenceSource,
  type PlanAccessEvidence,
  type PlanOpeningSchedule,
  type PlanPriceEvidence,
} from "@/lib/planRouteEvidence";
import { getVenueAccessibility } from "@/lib/venueAccessibilitySeeds";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import {
  loadWetherspoonsDirectoryPubs,
  matchWetherspoonsDirectoryPub,
} from "@/lib/wetherspoonsMatch.server";

type EvidenceVenue = { id: string; name: string; area: string; lat: number; lng: number };

let priceIndex: Promise<Map<string, { pence: unknown; label: unknown; url: unknown; observedAt: unknown; datasets: unknown }>> | null = null;

function canonicalGbpToPence(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const pence = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(pence) && pence > 0 ? pence : null;
}

async function loadPriceIndex(): Promise<Map<string, { pence: unknown; label: unknown; url: unknown; observedAt: unknown; datasets: unknown }>> {
  priceIndex ??= (async () => {
    try {
      const rows = JSON.parse(await readFile(
        path.join(process.cwd(), "public/data/pint_prices_app_dataset.json"),
        "utf8",
      )) as unknown;
      if (!Array.isArray(rows)) return new Map();
      return new Map(groupVenuePrices(rows as VenuePrice[]).map((venue) => {
        const cheapest = venue.prices.find((row) => row.price_gbp === venue.cheapestPrice);
        const attributed = cheapest && cheapest.source_datasets.trim()
          && (cheapest.pub_url.trim() || cheapest.constructed_pub_url.trim());
        return [venue.id, {
          pence: canonicalGbpToPence(venue.cheapestPrice),
          // The label is the publisher's name alone. The raw dataset ids stay
          // in this evidence object for anyone debugging a figure: printed,
          // they read as plumbing beside a price on the invite stop list.
          label: attributed ? "Pint Prices" : null,
          url: attributed ? cheapest.pub_url.trim() || cheapest.constructed_pub_url.trim() : null,
          observedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
          datasets: attributed ? cheapest.source_datasets : null,
        }];
      }));
    } catch {
      return new Map();
    }
  })();
  return priceIndex;
}

export async function planPriceEvidenceForVenues(
  venues: readonly EvidenceVenue[],
  now: number,
): Promise<Map<string, PlanPriceEvidence>> {
  const index = await loadPriceIndex();
  return new Map(venues.map((venue) => {
    const evidence = index.get(venue.id);
    return [venue.id, evidence
      ? buildPriceEvidence({ ...evidence, now })
      : { pence: null, source: null, confidenceState: "unknown" as const }];
  }));
}

const ACCESS_SOURCES: Record<string, Partial<Record<"stepFree" | "accessibleToilet", AccessEvidenceSource>>> = {
  "the ice wharf - jd wetherspoon": {
    stepFree: { label: "J D Wetherspoon: The Ice Wharf", url: "https://www.jdwetherspoon.com/pubs/the-ice-wharf-camden/", observedAt: null },
  },
  "the coronet": {
    stepFree: { label: "AccessAble: The Coronet", url: "https://www.accessable.co.uk/islington-council/access-guides/the-coronet", observedAt: null },
    accessibleToilet: { label: "AccessAble: The Coronet", url: "https://www.accessable.co.uk/islington-council/access-guides/the-coronet", observedAt: null },
  },
  "the crosse keys": {
    accessibleToilet: { label: "CAMRA: The Crosse Keys", url: "https://camra.org.uk/pubs/crosse-keys-london-156614", observedAt: null },
  },
  "the brockley barge - jd wetherspoon": {
    accessibleToilet: { label: "AccessAble: The Brockley Barge", url: "https://www.accessable.co.uk/london-borough-of-lewisham/access-guides/the-brockley-barge-jd-wetherspoon", observedAt: null },
  },
};

export function planAccessEvidenceForVenue(venue: EvidenceVenue): PlanAccessEvidence {
  const facts = getVenueAccessibility(venue.name, venue.area);
  const sources = ACCESS_SOURCES[venue.name.trim().toLocaleLowerCase("en-GB")] ?? {};
  return {
    ...(facts?.stepFree === true && sources.stepFree
      ? { stepFree: { confirmed: true as const, source: sources.stepFree } }
      : {}),
    ...(facts?.accessibleToilet === true && sources.accessibleToilet
      ? { accessibleToilet: { confirmed: true as const, source: sources.accessibleToilet } }
      : {}),
    // Deliberately no seating/lowNoise projection: seated service and a prose
    // quiet-hours note do not answer those intake questions.
  };
}

export async function planOpeningSchedulesForVenues(
  venues: readonly EvidenceVenue[],
): Promise<Map<string, PlanOpeningSchedule | null>> {
  const rows = await loadWetherspoonsDirectoryPubs();
  return new Map(venues.map((venue) => {
    const match = matchWetherspoonsDirectoryPub(
      { name: venue.name, lat: venue.lat, lng: venue.lng },
      rows,
    );
    if (
      !match
      || typeof match.observedAt !== "string"
      || !Number.isFinite(Date.parse(match.observedAt))
      || !match.source
      || typeof match.source.url !== "string"
      || typeof match.source.label !== "string"
    ) return [venue.id, null];
    return [venue.id, {
      venueListedOpen: !Array.isArray(match.statuses) || match.statuses.length === 0 || match.statuses.includes("Open"),
      ranges: (match.regularOpeningTimes ?? []).flatMap((row) =>
        typeof row.day_of_the_week === "string"
        && typeof row.opening_time === "string"
        && typeof row.closing_time === "string"
          ? [{ weekday: row.day_of_the_week, startsAt: row.opening_time, endsAt: row.closing_time }]
          : []),
      source: {
        label: match.source.label,
        url: match.source.url,
        observedAt: new Date(Date.parse(match.observedAt)).toISOString(),
      },
    }];
  }));
}
