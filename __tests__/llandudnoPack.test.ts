import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CITIES, listEnabledCities, pointInCityBounds } from "@/lib/cities";
import { buildCityChooserSearchResults } from "@/lib/cityChooserSearch";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { landmarksForCity } from "@/lib/cityLandmarks";
import { storyBandsForCity } from "@/lib/cityStoryBands";
import {
  CITY_VENUE_ID_PREFIX,
  cityIdFromVenueId,
  venueIdMatchesCity,
} from "@/lib/cityVenueIds";
import { parseUkPlaceIndex } from "@/lib/ukPlaceSearch";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { CITIES as CITY_OSM_DEFINITIONS } from "../scripts/fetch_city_osm_pubs.mjs";

const ROOT = process.cwd();

type SlimRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cheapestPrice: number | null;
  borough: string;
  filterHints?: { searchText?: string };
};

type SeedPub = {
  osmId: string;
  name: string;
  lat: number;
  lng: number;
  locality: string | null;
};

const SLIM = (rowsFromSlimPayload(
  JSON.parse(
    readFileSync(
      join(ROOT, "public", "data", "cities", "llandudno", "venues_slim.json"),
      "utf8",
    ),
  ),
) ?? []) as SlimRow[];

const SEED: { pubs: SeedPub[]; promotedFrom?: string; fetchedAt?: string } =
  JSON.parse(
    readFileSync(join(ROOT, "data", "cities", "llandudno", "osm_pubs.json"), "utf8"),
  );

const ESTATE_COVERAGE_PATH = join(
  ROOT,
  "public",
  "data",
  "cities",
  "llandudno",
  "estate_coverage.json",
);
const ESTATE_COVERAGE = JSON.parse(readFileSync(ESTATE_COVERAGE_PATH, "utf8")) as {
  version: number;
  city: string;
  observedAt: string;
  estates: Array<{
    id: string;
    venues: Array<{
      cityVenueId: string;
      name: string;
      prices: unknown[];
      source: { url: string; licence: string };
      observedAt: string;
      priceCheck?: {
        status: string;
        observedAt: string;
        source: { url: string; licence: string };
      };
    }>;
    priceUpdates: unknown[];
    coverageCheck?: {
      status: string;
      observedAt: string;
      source: { url: string; licence: string };
    };
  }>;
};

const PLACES = parseUkPlaceIndex(
  JSON.parse(
    readFileSync(join(ROOT, "public", "data", "uk_base", "places.json"), "utf8"),
  ),
);

describe("Llandudno curated pack", () => {
  it("keeps the audited estate source and shipped copy identical", () => {
    expect(readFileSync(ESTATE_COVERAGE_PATH, "utf8")).toBe(
      readFileSync(
        join(ROOT, "data", "cities", "llandudno", "estate_coverage.json"),
        "utf8",
      ),
    );
  });

  it("ships real coastal pubs with city-salted ids, in bounds, and no price", () => {
    expect(SLIM.length).toBeGreaterThanOrEqual(20);
    const ids = new Set<string>();
    for (const row of SLIM) {
      expect(row.id.startsWith("venue-lla-")).toBe(true);
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.name.trim().length).toBeGreaterThan(0);
      expect(pointInCityBounds(row.lat, row.lng, CITIES.llandudno)).toBe(true);
      // OSM is not a price source, and no price has been harvested here.
      expect(row.cheapestPrice).toBeNull();
      expect(row.filterHints?.searchText?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("ships estate coverage with honest price and source states", () => {
    expect(ESTATE_COVERAGE).toMatchObject({ version: 1, city: "llandudno" });
    expect(Number.isFinite(Date.parse(ESTATE_COVERAGE.observedAt))).toBe(true);

    const byEstate = new Map(ESTATE_COVERAGE.estates.map((estate) => [estate.id, estate]));
    const wetherspoon = byEstate.get("wetherspoon");
    expect(wetherspoon?.venues).toHaveLength(1);
    expect(wetherspoon?.venues[0]).toMatchObject({
      cityVenueId: "venue-lla-g00u76",
      name: "The Palladium",
      prices: [],
    });
    expect(wetherspoon?.venues[0]?.source.url).toMatch(/^https:\/\//);
    expect(wetherspoon?.venues[0]?.source.licence).toBeTruthy();
    expect(wetherspoon?.venues[0]?.priceCheck).toMatchObject({
      status: "not-published-on-web",
    });
    expect(wetherspoon?.priceUpdates).toEqual([]);

    for (const id of ["greene-king", "mitchells-butlers"]) {
      const estate = byEstate.get(id);
      expect(estate?.venues).toEqual([]);
      expect(estate?.priceUpdates).toEqual([]);
      expect(estate?.coverageCheck).toMatchObject({
        status: "no-venues-in-scope",
      });
      expect(estate?.coverageCheck?.source.url).toMatch(/^https:\/\//);
      expect(estate?.coverageCheck?.source.licence).toBeTruthy();
    }

    for (const estate of ESTATE_COVERAGE.estates) {
      for (const venue of estate.venues) {
        expect(Number.isFinite(Date.parse(venue.observedAt))).toBe(true);
        if (venue.priceCheck) {
          expect(Number.isFinite(Date.parse(venue.priceCheck.observedAt))).toBe(true);
          expect(venue.priceCheck.source.url).toMatch(/^https:\/\//);
          expect(venue.priceCheck.source.licence).toBeTruthy();
        }
      }
      if (estate.coverageCheck) {
        expect(Number.isFinite(Date.parse(estate.coverageCheck.observedAt))).toBe(true);
      }
    }
  });

  it("labels each pin with the town OSM states for it, never the pack's name", () => {
    const areas = new Set(SLIM.map((row) => row.borough));
    // The pack is one stretch of coast, so a single label would put Llandudno
    // on a Conwy pub.
    expect(areas.has("Conwy")).toBe(true);
    expect(areas.has("Colwyn Bay")).toBe(true);
    expect(areas.has("Llandudno")).toBe(true);

    const byName = new Map(SLIM.map((row) => [row.name, row.borough]));
    expect(byName.get("Liverpool Arms")).toBe("Conwy");
    expect(byName.get("The Toad")).toBe("Colwyn Bay");
    expect(byName.get("The Cottage Loaf")).toBe("Llandudno");

    for (const pub of SEED.pubs) {
      const row = SLIM.find((candidate) => candidate.name === pub.name);
      if (!row) continue;
      expect(row.borough).toBe(pub.locality ?? CITIES.llandudno.displayName);
    }
  });

  it("takes its rows out of the UK base layer rather than a second observation", () => {
    expect(SEED.promotedFrom).toBe("data/osm/uk/uk_osm_pubs.json");
    const basePack: { pubs: Array<{ osmId: string }> } = JSON.parse(
      readFileSync(join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json"), "utf8"),
    );
    // The promotion may only carry the snapshot's own observation date.
    expect(SEED.fetchedAt).toBe(
      (basePack as unknown as { fetchedAt: string }).fetchedAt,
    );
    const baseOsmIds = new Set(basePack.pubs.map((pub) => pub.osmId));
    for (const pub of SEED.pubs) expect(baseOsmIds.has(pub.osmId)).toBe(true);
  });

  it("hands every promoted pub's base row to its curated pin, so nothing double-pins", () => {
    const manifest: { urlPrefix: string; shards: Array<{ id: string }> } =
      JSON.parse(
        readFileSync(
          join(ROOT, "public", "data", "uk_base", "manifest.json"),
          "utf8",
        ),
      );
    const owners = new Set<string>();
    for (const shard of manifest.shards) {
      const body: { pubs: Array<[string, string, string, number, number, string]> } =
        JSON.parse(
          readFileSync(
            join(
              ROOT,
              "public",
              manifest.urlPrefix.replace(/^\//, "").replace(/\/$/, ""),
              `${shard.id}.json`,
            ),
            "utf8",
          ),
        );
      for (const row of body.pubs) {
        if (row[5].startsWith("venue-lla-")) owners.add(row[5]);
      }
    }
    expect(owners.size).toBe(SLIM.length);
    for (const row of SLIM) expect(owners.has(row.id)).toBe(true);
  });

  it("resolves its venue ids to Llandudno and to no other city", () => {
    expect(cityIdFromVenueId(SLIM[0]!.id)).toBe("llandudno");
    expect(venueIdMatchesCity(SLIM[0]!.id, "llandudno")).toBe(true);
    expect(venueIdMatchesCity(SLIM[0]!.id, "london")).toBe(false);
    expect(venueIdMatchesCity(SLIM[0]!.id, "bath")).toBe(false);
  });

  it("claims no editorial it does not ship, and no London fallthrough", () => {
    expect(landmarksForCity("llandudno")).toEqual([]);
    expect(storyBandsForCity("llandudno")).toEqual([]);
    expect(curatedCrawlsForCity("llandudno")).toEqual([]);
    expect(CITIES.llandudno.poisPath).toBeNull();
    expect(CITIES.llandudno.transitLinesPath).toBeNull();
  });
});

describe("Llandudno place search", () => {
  it("lands the shipped index's Llandudno on the curated map", () => {
    const [first] = buildCityChooserSearchResults(
      "Llandudno",
      listEnabledCities(),
      PLACES,
    );
    expect(first).toMatchObject({
      kind: "curated",
      name: "Llandudno",
      href: "/map/llandudno",
      cityId: "llandudno",
    });
  });

  it("routes the other towns in the pack to the same curated map", () => {
    for (const query of ["Conwy", "Colwyn Bay"]) {
      const [first] = buildCityChooserSearchResults(
        query,
        listEnabledCities(),
        PLACES,
      );
      expect(first).toMatchObject({ kind: "curated", cityId: "llandudno" });
      expect(first).not.toMatchObject({ kind: "uncovered" });
    }
  });
});

describe("city id tables", () => {
  it("agree on every pack's venue-id prefix", () => {
    // The prefix is written down twice: the builder salts venue ids with it and
    // the app reads a venue id back to its city with it. A pack whose two
    // spellings disagreed would ship pins no surface could place.
    for (const [cityId, definition] of Object.entries(CITY_OSM_DEFINITIONS)) {
      expect(
        CITY_VENUE_ID_PREFIX[cityId as keyof typeof CITY_VENUE_ID_PREFIX],
        `${cityId} prefix`,
      ).toBe(definition.shortPrefix);
    }
  });
});
