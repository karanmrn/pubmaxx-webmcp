// The UK-wide OSM venue taxonomy: what it claims, what it refuses to claim, and
// that the widened venue vocabulary leaves every pub surface exactly as it was.
//
// The rule under test is that a row exists because OSM STATES the thing. A
// restaurant is not a drinking venue and a fast-food counter is not a night
// venue, so both are taken only where a tag says otherwise; nothing is inferred
// from a name, a chain or a postcode.

import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  packFetchedAt,
  runArtifactPlan,
  venuePackPath,
} from "../scripts/fetch_uk_osm_venues.mjs";
import {
  normalizeOsmVenueElement,
  normalizeOsmPubElement,
} from "../scripts/lib/osmPubNormalizer.mjs";
import {
  MAX_ATTEMPTS,
  MAX_BACKOFF_MS,
  OVERPASS_FALLBACK_ENDPOINTS,
  OVERPASS_PRIMARY_ENDPOINTS,
  PRIMARY_ATTEMPTS,
  backoffMs,
  endpointForAttempt,
  isFreshOverpassSnapshot,
} from "../scripts/lib/overpassClient.mjs";
import {
  UK_VENUE_GROUPS,
  UK_VENUE_KINDS,
  UK_VENUE_QUERY_SCOPES,
  UK_VENUE_TAXONOMY,
  buildUkVenueQuery,
  classifyVenueTags,
  countVenues,
  normalizeVenueElements,
  taxonomyForScope,
} from "../scripts/lib/ukOsmVenueSeed.mjs";
import { VENUE_KINDS, isVenueKind, type VenueKind } from "@/lib/venues";
import {
  isPubVenueKind,
  venueKindLabel,
  venueKindNoun,
} from "@/lib/venueKindFilters";

const LONDON_CELL: [number, number, number, number] = [50.8, -0.7, 51.8, 0.3];

function node(id: number, tags: Record<string, string>) {
  return { type: "node", id, lat: 51.5, lon: -0.1, tags };
}

describe("UK venue taxonomy", () => {
  it("keeps the pub query contract: UK area clip, 90 second timeout, nodes and ways", () => {
    const query = buildUkVenueQuery(LONDON_CELL);
    expect(query).toContain("[timeout:90]");
    expect(query).toContain("area(id:3600062149)->.uk;");
    expect(query).toContain('node["amenity"="pub"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query).toContain('way["amenity"="pub"](area.uk)(50.8,-0.7,51.8,0.3);');
    expect(query.trimEnd().endsWith("out center tags;")).toBe(true);
  });

  it("asks for the whole taxonomy in one request by default", () => {
    const all = buildUkVenueQuery(LONDON_CELL);
    for (const row of UK_VENUE_TAXONOMY) {
      for (const selector of row.selectors) expect(all).toContain(`node${selector}(area.uk)`);
    }
    expect(taxonomyForScope("all")).toHaveLength(UK_VENUE_TAXONOMY.length);
    expect(UK_VENUE_QUERY_SCOPES[0]).toBe("all");
  });

  it("narrows to one lane when a scope is named", () => {
    const work = buildUkVenueQuery(LONDON_CELL, "work");
    expect(work).toContain('node["amenity"="library"](area.uk)');
    expect(work).not.toContain('"amenity"="pub"');
    expect(() => taxonomyForScope("nightclubs")).toThrow(/Unknown venue scope/);
  });

  it("takes a restaurant only where OSM states a bar, a microbrewery or real ale", () => {
    expect(classifyVenueTags({ amenity: "restaurant", name: "Plain" })).toBeNull();
    expect(classifyVenueTags({ amenity: "restaurant", bar: "yes" })?.key).toBe("restaurant_bar");
    expect(classifyVenueTags({ amenity: "restaurant", real_ale: "yes" })?.key).toBe("restaurant_bar");
    expect(classifyVenueTags({ amenity: "restaurant", bar: "no" })).toBeNull();
  });

  it("takes fast food only where OSM states alcohol or round-the-clock hours", () => {
    expect(classifyVenueTags({ amenity: "fast_food" })).toBeNull();
    expect(classifyVenueTags({ amenity: "fast_food", opening_hours: "Mo-Su 11:00-23:00" })).toBeNull();
    expect(classifyVenueTags({ amenity: "fast_food", opening_hours: "24/7" })?.kind).toBe("food");
    expect(classifyVenueTags({ amenity: "fast_food", alcohol: "yes" })?.kind).toBe("food");
  });

  it("takes a hotel only as a lounge, and only where it states a bar", () => {
    expect(classifyVenueTags({ tourism: "hotel" })).toBeNull();
    expect(classifyVenueTags({ tourism: "hotel", bar: "yes" })?.kind).toBe("hotel_lounge");
  });

  it("takes a community centre only where OSM states internet access", () => {
    expect(classifyVenueTags({ amenity: "community_centre" })).toBeNull();
    expect(classifyVenueTags({ amenity: "community_centre", internet_access: "no" })).toBeNull();
    expect(classifyVenueTags({ amenity: "community_centre", internet_access: "wlan" })?.kind).toBe("other");
  });

  it("keeps a pub a pub even when it also carries a shop tag", () => {
    expect(classifyVenueTags({ amenity: "pub", shop: "alcohol" })?.key).toBe("pub");
  });

  it("only produces kinds the venue vocabulary knows", () => {
    for (const kind of UK_VENUE_KINDS) expect(isVenueKind(kind)).toBe(true);
    for (const row of UK_VENUE_TAXONOMY) expect(UK_VENUE_GROUPS).toContain(row.group);
  });
});

describe("UK venue normalization", () => {
  it("retains the work-spot tags a pub pack never carried", () => {
    const venue = normalizeOsmVenueElement(
      node(1, {
        amenity: "cafe",
        name: "Desk & Bean",
        internet_access: "wlan",
        "internet_access:fee": "no",
        wheelchair: "yes",
        opening_hours: "Mo-Fr 07:00-18:00",
        outdoor_seating: "yes",
        cuisine: "coffee_shop",
        brand: "Independent",
        capacity: "40",
        phone: "+44 20 7000 0000",
        website: "https://example.test",
        "smoking:outside": "yes",
      }),
      { kind: "cafe", taxonomyKey: "cafe" },
    );
    expect(venue).toMatchObject({
      kind: "cafe",
      taxonomyKey: "cafe",
      internetAccess: "wlan",
      internetAccessFee: "no",
      wheelchair: "yes",
      capacity: "40",
      brand: "Independent",
      openingHours: "Mo-Fr 07:00-18:00",
      outdoorSeating: true,
      cuisine: "coffee_shop",
      smoking: { "smoking:outside": "yes" },
    });
  });

  it("states nothing OSM did not: an absent tag stays absent", () => {
    const venue = normalizeOsmVenueElement(node(2, { amenity: "library", name: "Reading Room" }), {
      kind: "library",
      taxonomyKey: "library",
    });
    expect(venue).not.toHaveProperty("internetAccess");
    expect(venue).not.toHaveProperty("wheelchair");
    expect(venue?.openingHours).toBeNull();
  });

  it("produces the pub contract unchanged for a pub", () => {
    const element = node(3, { amenity: "pub", name: "The Contract Arms", "addr:city": "London" });
    const pub = normalizeOsmPubElement(element);
    const venue = normalizeOsmVenueElement(element, { kind: "pub", taxonomyKey: "pub" });
    expect(venue).toMatchObject(pub ?? {});
    expect(Object.keys(pub ?? {}).length).toBeGreaterThan(10);
  });

  it("dedupes by OSM id across shared cell edges and counts what it dropped", () => {
    const result = normalizeVenueElements([
      node(10, { amenity: "pub", name: "The Edge" }),
      node(10, { amenity: "pub", name: "The Edge" }),
      node(11, { amenity: "cafe" }), // unnamed
      node(12, { amenity: "restaurant" }), // no stated bar
      node(13, { amenity: "library", name: "Reading Room" }),
    ]);
    // Sorted by position, then name: same point here, so "Reading Room" leads.
    expect(result.venues.map((venue) => venue.osmId)).toEqual(["node/13", "node/10"]);
    expect(result.unnamed).toBe(1);
    expect(result.unclassified).toBe(1);
  });

  it("counts by kind and by taxonomy key", () => {
    const { venues } = normalizeVenueElements([
      node(20, { amenity: "pub", name: "One" }),
      node(21, { amenity: "bar", name: "Two" }),
      node(22, { amenity: "biergarten", name: "Three" }),
    ]);
    expect(countVenues(venues)).toEqual({
      byKind: { pub: 1, bar: 2 },
      byTaxonomyKey: { pub: 1, bar: 1, biergarten: 1 },
    });
  });
});

describe("the widened venue vocabulary", () => {
  it("leaves pub behaviour exactly as it was", () => {
    expect(isPubVenueKind(undefined)).toBe(true);
    expect(isPubVenueKind("pub")).toBe(true);
    for (const kind of ["cafe", "coworking", "library", "hotel_lounge", "other"] as const) {
      expect(isPubVenueKind(kind)).toBe(false);
    }
  });

  it("names every kind rather than falling through to pub", () => {
    for (const kind of VENUE_KINDS) {
      if (kind === "pub") continue;
      expect(venueKindLabel(kind)).not.toBe("Pub");
      expect(venueKindNoun(kind)).not.toBe("pub");
    }
    expect(venueKindLabel(undefined)).toBe("Pub");
    expect(venueKindNoun(undefined)).toBe("pub");
  });

  it("refuses a kind the vocabulary does not hold", () => {
    expect(isVenueKind("nightclub")).toBe(false);
    expect(isVenueKind(undefined)).toBe(false);
    expect(isVenueKind("cafe")).toBe(true);
  });

  it("holds one kind list rather than a copy per reader", () => {
    const kinds: readonly VenueKind[] = VENUE_KINDS;
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.slice(0, 5)).toEqual(["pub", "bar", "club", "food", "restaurant"]);
  });
});

describe("what a run of the venue fetcher may rewrite", () => {
  it("rewrites every pack, the manifest and the counts after a whole-taxonomy pull", () => {
    const plan = runArtifactPlan("all", { missingChunks: 0 });
    expect(plan.complete).toBe(true);
    expect(plan.packGroups).toEqual([...UK_VENUE_GROUPS]);
    expect(path.basename(plan.manifestPath!)).toBe("venue_chunks.json");
    expect(path.basename(plan.countsPath!)).toBe("venue_counts.json");
  });

  it("keeps a --scope lane retry to its OWN pack, and off the whole-taxonomy figures", () => {
    // The documented recovery command is `npm run fetch:uk-venues -- --scope=work`.
    // It fetches one lane, so it may rewrite one lane: the drink and food packs
    // it never asked Overpass about must stay on disk untouched rather than be
    // written empty, and the counts file it cannot honestly restate is left alone.
    for (const group of UK_VENUE_GROUPS) {
      const plan = runArtifactPlan(group, { missingChunks: 0 });
      expect(plan.packGroups).toEqual([group]);
      expect(plan.countsPath).toBeNull();
      expect(path.basename(plan.manifestPath!)).toBe(`venue_chunks_${group}.json`);
      expect(plan.manifestPath).not.toBe(runArtifactPlan("all", {}).manifestPath);
      for (const other of UK_VENUE_GROUPS.filter((row: string) => row !== group)) {
        expect(plan.packGroups).not.toContain(other);
      }
    }
  });

  it("rewrites nothing at all when the run did not read every chunk", () => {
    const plan = runArtifactPlan("all", { missingChunks: 1 });
    expect(plan.complete).toBe(false);
    expect(plan.packGroups).toEqual([]);
    expect(plan.manifestPath).toBeNull();
    expect(plan.countsPath).toBeNull();
  });

  it("stamps a network pull with the run's own start", () => {
    // The run really did look at the world then, so the wall clock is the
    // honest answer here - and it stays the answer whatever the mirrors' own
    // snapshot timestamps happen to say.
    expect(
      packFetchedAt({
        fromRaw: false,
        runStartedAt: "2026-08-16T04:01:27.583Z",
        chunkStamps: ["2026-06-01T08:52:28Z", "2026-08-16T03:59:00Z"],
      }),
    ).toBe("2026-08-16T04:01:27.583Z");
  });

  it("stamps a --from-raw rebuild with the OLDEST raw it re-read, never today", () => {
    // `--from-raw` asks nobody, so dating it today would sell weeks-old cafe
    // and library rows as fresh through the honest-looking path.
    expect(
      packFetchedAt({
        fromRaw: true,
        runStartedAt: "2026-08-16T04:01:27.583Z",
        chunkStamps: [
          "2026-08-15T23:00:00Z",
          "2026-06-01T08:52:28Z",
          "2026-07-20T10:00:00Z",
        ],
      }),
    ).toBe("2026-06-01T08:52:28Z");
  });

  it("publishes a --from-raw rebuild UNDATED when one raw cannot be dated", () => {
    for (const unusable of [null, undefined, "", "last tuesday", 1_755_316_887_583]) {
      expect(
        packFetchedAt({
          fromRaw: true,
          runStartedAt: "2026-08-16T04:01:27.583Z",
          chunkStamps: ["2026-06-01T08:52:28Z", unusable],
        }),
      ).toBeNull();
    }
    expect(
      packFetchedAt({ fromRaw: true, runStartedAt: "2026-08-16T04:01:27.583Z", chunkStamps: [] }),
    ).toBeNull();
  });

  it("names each pack after its own group", () => {
    for (const group of UK_VENUE_GROUPS) {
      expect(path.basename(venuePackPath(group))).toBe(`uk_osm_venues_${group}.json`);
    }
  });
});

describe("the shared Overpass client", () => {
  it("spends its first attempts on the primaries and only its tail on the degraded pair", () => {
    const seen = Array.from({ length: MAX_ATTEMPTS }, (_, attempt) => endpointForAttempt(attempt));
    expect(seen.slice(0, PRIMARY_ATTEMPTS).every((url) => OVERPASS_PRIMARY_ENDPOINTS.includes(url))).toBe(
      true,
    );
    expect(seen.slice(PRIMARY_ATTEMPTS).every((url) => OVERPASS_FALLBACK_ENDPOINTS.includes(url))).toBe(
      true,
    );
    // Both primaries are tried before either is tried twice: one mirror rate
    // limiting must not spend every attempt of a chunk on that same mirror.
    expect(new Set(seen.slice(0, OVERPASS_PRIMARY_ENDPOINTS.length)).size).toBe(
      OVERPASS_PRIMARY_ENDPOINTS.length,
    );
  });

  it("honours a Retry-After header and otherwise backs off exponentially, capped", () => {
    expect(backoffMs(0, "30")).toBe(30_000);
    expect(backoffMs(0, null)).toBe(4_000);
    expect(backoffMs(3, null)).toBe(32_000);
    expect(backoffMs(20, null)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(0, "99999")).toBe(MAX_BACKOFF_MS);
  });

  it("refuses a snapshot that is stale, undated or from the future", () => {
    const now = Date.parse("2026-08-16T05:00:00.000Z");
    const at = (stamp: string) => ({ elements: [], osm3s: { timestamp_osm_base: stamp } });
    expect(isFreshOverpassSnapshot(at("2026-08-16T04:30:00Z"), now)).toBe(true);
    expect(isFreshOverpassSnapshot(at("2026-06-01T08:52:28Z"), now)).toBe(false);
    expect(isFreshOverpassSnapshot(at("2026-08-16T06:00:00Z"), now)).toBe(false);
    expect(isFreshOverpassSnapshot({ elements: [] }, now)).toBe(false);
    expect(isFreshOverpassSnapshot({ elements: [], remark: "runtime error" }, now)).toBe(false);
  });
});
