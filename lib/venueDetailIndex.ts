import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { cityIdFromVenueId } from "@/lib/cityVenueIds";
import type { FoodCategory } from "@/lib/food";
import { lookupCanonicalVenueId } from "@/lib/venueAliases";
import { lookupCanonicalVenue, venueOsmIds } from "@/lib/venueIndex";
import {
  lookupCanonicalVenueWithOsm,
  resetVenueOsmIndexForTests,
} from "@/lib/venueIndexOsm";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyHarvestWebsiteMenu } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { enrichVenueForDetail } from "@/lib/venueMenuEnrichment";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

export type VenueDetailManifestEntry = {
  offset: number;
  length: number;
  rowCount: number;
};

export type VenueDetailManifest = {
  version: 1;
  detailsFile: string;
  count: number;
  venues: Record<string, VenueDetailManifestEntry>;
};

export type VenueDetailArtifact = {
  id: string;
  rows?: VenuePrice[];
  famous?: {
    seed: FamousVenueSeed;
    slim: SlimVenue;
  };
};

type FamousVenueSeed = {
  id: string;
  name: string;
  address: string;
  borough: string;
  lat: number;
  lng: number;
  kind: "bar" | "food" | "restaurant";
  sourceUrl: string;
  anchor: {
    label: string;
    price: number;
    observedAt: string;
    sourceUrl: string;
    course?: FoodCategory;
    kind:
      | "house_cocktail"
      | "pint"
      | "wine"
      | "large_doner"
      | "signature_item"
      | "signature_dish";
  };
  story: { text: string; sourceUrl: string };
};

const GENERATED_DIR =
  process.env.PUBMAX_VENUE_DETAIL_DIR ?? path.join(process.cwd(), "data", "generated");
const DEFAULT_DETAIL_INDEX_FILE = path.join(GENERATED_DIR, "venue_detail_index.json");
const DEFAULT_DETAIL_ROWS_FILE = path.join(GENERATED_DIR, "venue_details.jsonl");
const RAW_DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");

// Suffix bound is deliberately loose ({1,24}) so a future id generator that
// bumps the entropy segment beyond today's 12 chars won't need a regex change.
const VENUE_ID_RE =
  /^(?:venue-(?:[a-z]{3}-)?[a-z0-9]{1,24}|(?:bar|food|restaurant)-[a-z0-9-]{1,100})$/;

const cachedDetails = new Map<string, { venue: Venue; overlayVenueIds?: string[] }>();
/** Successful manifests only — I/O failures stay unset so the next call can retry.
 * Schema-invalid manifests are cached as INVALID_MANIFEST (warn once). */
const INVALID_MANIFEST = Symbol("invalid-venue-detail-manifest");
let cachedManifest: VenueDetailManifest | typeof INVALID_MANIFEST | undefined;
let detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
let detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
let fallbackIndex: Map<string, Venue> | null = null;
let manifestReadAttemptsForTests = 0;

export type VenueDetailLookupResult =
  | { status: "found"; venue: Venue }
  | { status: "missing" }
  | { status: "unavailable" };

type ArtifactLookupResult =
  | { status: "found"; venue: Venue }
  | { status: "missing" }
  | { status: "unavailable"; allowFallback: boolean };

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  );
}

export function isVenueDetailId(id: string): boolean {
  return VENUE_ID_RE.test(id);
}

export function venueFromDetailArtifact(
  artifact: VenueDetailArtifact,
  expectedId: string,
): Venue | null {
  if (artifact.id !== expectedId) {
    return null;
  }
  if (artifact.famous) {
    const { seed, slim } = artifact.famous;
    if (seed.id !== expectedId || slim.id !== expectedId) return null;
    const venue = slimVenueToPin(slim);
    return {
      ...venue,
      address: seed.address,
      hasStory: true,
      amenities: {
        ...venue.amenities,
        food: seed.kind === "food" || seed.kind === "restaurant",
        cocktails:
          seed.kind === "bar" && seed.anchor.kind === "house_cocktail",
      },
      website: seed.sourceUrl,
      description: seed.story.text,
      sourceDatasets: ["famous_venues"],
      anchorLabel: seed.anchor.label,
      ...(seed.anchor.course ? { anchorCourse: seed.anchor.course } : {}),
      anchorObservedAt: seed.anchor.observedAt,
      anchorSourceUrl: seed.anchor.sourceUrl,
      storySourceUrl: seed.story.sourceUrl,
    };
  }
  if (!Array.isArray(artifact.rows) || artifact.rows.length === 0) return null;
  const venue = groupVenuePrices(artifact.rows)[0];
  return venue?.id === expectedId ? venue : null;
}

/** Sentinel: schema-invalid manifest is permanent for this process (do not re-read). */
async function readManifest(): Promise<
  | { status: "ready"; manifest: VenueDetailManifest }
  | { status: "unavailable" }
> {
  if (cachedManifest === INVALID_MANIFEST) return { status: "unavailable" };
  if (cachedManifest) return { status: "ready", manifest: cachedManifest };
  if (isTestRuntime()) manifestReadAttemptsForTests += 1;
  try {
    const parsed = JSON.parse(
      await fs.readFile(/* turbopackIgnore: true */ detailIndexFile, "utf8"),
    ) as VenueDetailManifest;
    const valid =
      parsed.version === 1 &&
      parsed.detailsFile === "venue_details.jsonl" &&
      typeof parsed.count === "number" &&
      typeof parsed.venues === "object" &&
      parsed.venues !== null;
    if (!valid) {
      // Permanently malformed build artifact — cache the miss and warn once.
      cachedManifest = INVALID_MANIFEST;
      console.warn(
        "[venueDetailIndex] venue_detail_index.json failed schema validation; venue detail lookups disabled until restart",
      );
      return { status: "unavailable" };
    }
    cachedManifest = parsed;
    return { status: "ready", manifest: parsed };
  } catch {
    // Leave cache unset so a later request can retry after a transient miss.
    return { status: "unavailable" };
  }
}

async function readVenueFromArtifact(id: string): Promise<ArtifactLookupResult> {
  const manifestResult = await readManifest();
  if (manifestResult.status === "unavailable") {
    return { status: "unavailable", allowFallback: true };
  }
  const entry = manifestResult.manifest.venues[id];
  if (!entry) return { status: "missing" };
  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.length) ||
    entry.offset < 0 ||
    entry.length <= 0
  ) {
    return { status: "unavailable", allowFallback: false };
  }

  let file: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    file = await fs.open(/* turbopackIgnore: true */ detailRowsFile, "r");
    const buffer = Buffer.alloc(entry.length);
    const { bytesRead } = await file.read(buffer, 0, entry.length, entry.offset);
    if (bytesRead !== entry.length) return { status: "unavailable", allowFallback: false };
    const artifact = JSON.parse(buffer.toString("utf8").trim()) as VenueDetailArtifact;
    const venue = venueFromDetailArtifact(artifact, id);
    return venue
      ? { status: "found", venue }
      : { status: "unavailable", allowFallback: false };
  } catch {
    return { status: "unavailable", allowFallback: false };
  } finally {
    await file?.close().catch(() => {});
  }
}

async function getFallbackIndex(): Promise<Map<string, Venue>> {
  if (fallbackIndex) return fallbackIndex;
  const index = new Map<string, Venue>();
  try {
    const rows = JSON.parse(await fs.readFile(RAW_DATASET_FILE, "utf8")) as VenuePrice[];
    for (const venue of groupVenuePrices(Array.isArray(rows) ? rows : [])) {
      index.set(venue.id, venue);
    }
  } catch {
    // Keep development and tests friendly if generated artifacts are absent.
  }
  for (const file of ["bars.json", "late_food.json", "restaurants.json"]) {
    try {
      const seeds = JSON.parse(
        await fs.readFile(
          path.join(process.cwd(), "data", "famous_venues", file),
          "utf8",
        ),
      ) as FamousVenueSeed[];
      for (const seed of seeds) {
        const slim: SlimVenue = {
          id: seed.id,
          name: seed.name,
          lat: seed.lat,
          lng: seed.lng,
          cheapestPrice: seed.anchor.price,
          borough: seed.borough,
          kind: seed.kind,
        };
        const venue = venueFromDetailArtifact(
          { id: seed.id, famous: { seed, slim } },
          seed.id,
        );
        if (venue) index.set(seed.id, venue);
      }
    } catch {
      // One missing seed pack must not disable legacy development fallback.
    }
  }
  fallbackIndex = index;
  return fallbackIndex;
}

export async function lookupVenueDetail(requestedId: string): Promise<VenueDetailLookupResult> {
  if (!isVenueDetailId(requestedId)) return { status: "missing" };
  const aliasResult = await lookupCanonicalVenueId(requestedId);
  if (aliasResult.status === "unavailable") return aliasResult;
  const id = aliasResult.venueId;
  const cached = cachedDetails.get(id);
  if (cached) {
    try {
      let overlayVenueIds = cached.overlayVenueIds;
      if (!overlayVenueIds) {
        const osmLookup = await lookupCanonicalVenueWithOsm(id);
        if (osmLookup.status === "found") {
          overlayVenueIds = venueOsmIds(osmLookup.venue);
          cached.overlayVenueIds = overlayVenueIds;
        }
      }
      if (!overlayVenueIds?.length) return { status: "found", venue: cached.venue };
      const reads = await Promise.all(
        overlayVenueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
      );
      if (reads.some((read) => read.status === "degraded")) {
        return { status: "found", venue: cached.venue };
      }
      const venue = reads.reduce(
        (current, read) =>
          read.status === "ready" ? applyHarvestWebsiteMenu(current, read.overlay) : current,
        cached.venue,
      );
      return { status: "found", venue };
    } catch {
      return { status: "found", venue: cached.venue };
    }
  }

  const venueLookup = await lookupCanonicalVenue(id);
  if (venueLookup.status === "unavailable") return { status: "unavailable" };
  if (venueLookup.status === "unknown") return { status: "missing" };

  const artifactResult = await readVenueFromArtifact(id);
  let venue: Venue | null = artifactResult.status === "found" ? artifactResult.venue : null;
  if (
    !venue &&
    artifactResult.status === "unavailable" &&
    artifactResult.allowFallback &&
    process.env.NODE_ENV !== "production"
  ) {
    venue = (await getFallbackIndex()).get(id) ?? null;
  }
  if (!venue && cityIdFromVenueId(id)) {
    venue = slimVenueToPin(venueLookup.slimVenue);
  }
  if (!venue) return { status: "unavailable" };

  try {
    const enriched = await enrichVenueForDetail(venue);
    let overlayVenueIds: string[] | undefined;
    try {
      const osmLookup = await lookupCanonicalVenueWithOsm(id);
      if (osmLookup.status === "found") {
        overlayVenueIds = venueOsmIds(osmLookup.venue);
      }
    } catch {
      overlayVenueIds = undefined;
    }
    cachedDetails.set(id, { venue: enriched, ...(overlayVenueIds ? { overlayVenueIds } : {}) });
    if (!overlayVenueIds?.length) return { status: "found", venue: enriched };
    const reads = await Promise.all(
      overlayVenueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
    );
    if (reads.some((read) => read.status === "degraded")) return { status: "found", venue: enriched };
    const mergedVenue = reads.reduce(
      (current, read) =>
        read.status === "ready" ? applyHarvestWebsiteMenu(current, read.overlay) : current,
      enriched,
    );
    return { status: "found", venue: mergedVenue };
  } catch {
    return { status: "found", venue };
  }
}

export async function getVenueDetail(requestedId: string): Promise<Venue | null> {
  const result = await lookupVenueDetail(requestedId);
  return result.status === "found" ? result.venue : null;
}

export function resetVenueDetailCachesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  cachedManifest = undefined;
  detailIndexFile = DEFAULT_DETAIL_INDEX_FILE;
  detailRowsFile = DEFAULT_DETAIL_ROWS_FILE;
  fallbackIndex = null;
  manifestReadAttemptsForTests = 0;
  resetVenueOsmIndexForTests();
}

/** Clear venue entries only — leaves manifest cache as-is (for sticky-failure tests). */
export function clearVenueDetailEntriesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  fallbackIndex = null;
}

export function setVenueDetailIndexFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  cachedManifest = undefined;
  detailIndexFile = file;
}

export function setVenueDetailRowsFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  detailRowsFile = file;
}

export function getManifestReadAttemptsForTests(): number {
  return isTestRuntime() ? manifestReadAttemptsForTests : 0;
}
