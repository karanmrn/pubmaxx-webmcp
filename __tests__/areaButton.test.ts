import { describe, expect, it } from "vitest";

import {
  areaCoverageLabel,
  areaElsewhereOptions,
  areaSheetOpenDelay,
  areaUnderCentre,
  AREA_SHEET_SETTLE_MS,
  buildAreaSheetModel,
  cheapestDrinksInArea,
  cheapestDrinksNearPoint,
  DEFAULT_AREA_FLY_ZOOM,
  formatAreaDistance,
  LOCALITY_RADIUS_KM,
  planAreaSelect,
  type AreaDistanceFrom,
  type AreaElsewhereOption,
} from "@/lib/areaButton";
import { getNightArea } from "@/lib/nightAreas";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import type { Venue } from "@/lib/venues";

// Minimal Venue factory — only the fields the area models read matter. Mirrors
// the house pattern in __tests__/mapVenueList.test.ts.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    cheapestPrice: null,
    latestContributorPrice: null,
    ...overrides,
  } as Venue;
}

describe("areaUnderCentre — the live centre label", () => {
  it("names the area whose region contains the map centre", () => {
    const soho = getNightArea("piccadilly-soho");
    const area = areaUnderCentre("london", [soho.centre.lng, soho.centre.lat]);
    expect(area?.slug).toBe("piccadilly-soho");
  });

  it("falls back to the nearest area when the centre is between regions", () => {
    // Far out over the North Sea — inside no region; nearest area still returned.
    const area = areaUnderCentre("london", [0.6, 51.5]);
    expect(area).not.toBeNull();
    expect(area?.cityId).toBe("london");
  });

  it("prefers the nearer centre when two regions overlap the point", () => {
    // A point nudged from Islington toward King's Cross stays on the nearer one.
    const islington = getNightArea("islington");
    const area = areaUnderCentre("london", [
      islington.centre.lng,
      islington.centre.lat,
    ]);
    expect(area?.slug).toBe("islington");
  });

  it("returns null for non-finite coordinates and unmodelled cities", () => {
    expect(areaUnderCentre("london", [Number.NaN, 51.5])).toBeNull();
    // A city with no modelled Night Areas resolves to null, not a wrong guess.
    expect(areaUnderCentre("bath", [-2.36, 51.38])).toBeNull();
  });
});

describe("formatAreaDistance — honest, direct register", () => {
  it("reads close distances in metres and far ones in kilometres", () => {
    expect(formatAreaDistance(0, "reader")).toBe("right here");
    expect(formatAreaDistance(0.05, "reader")).toBe("right here");
    expect(formatAreaDistance(0.42, "reader")).toBe("420 m away");
    expect(formatAreaDistance(1.25, "reader")).toBe("1.3 km away");
  });

  it("returns empty for a non-finite or negative distance", () => {
    expect(formatAreaDistance(Number.NaN, "reader")).toBe("");
    expect(formatAreaDistance(-1, "reader")).toBe("");
    expect(formatAreaDistance(Number.NaN)).toBe("");
    expect(formatAreaDistance(-1)).toBe("");
  });

  // "away" is a distance from the READER. The map centre is not the reader, so
  // a map-measured row may not borrow the word, and it names what it measured
  // from instead of leaving the reader to assume.
  it("never says away when the distance was measured from the map centre", () => {
    for (const km of [0, 0.05, 0.42, 1.25, 9]) {
      expect(formatAreaDistance(km, "map")).not.toContain("away");
      expect(formatAreaDistance(km, "map")).toContain("map centre");
    }
    expect(formatAreaDistance(0.42, "map")).toBe("420 m from map centre");
    expect(formatAreaDistance(1.25, "map")).toBe("1.3 km from map centre");
    expect(formatAreaDistance(0.05, "map")).toBe("at the map centre");
  });

  it("claims the reader only when a caller says so", () => {
    // A caller that told us nothing has earned no claim on the reader.
    expect(formatAreaDistance(0.42)).toBe("420 m from map centre");
    expect(formatAreaDistance(0.05)).not.toBe("right here");
  });
});

describe("cheapestDrinksInArea - ranking + fail-soft pricing", () => {
  const soho = getNightArea("piccadilly-soho");
  const fromMapCentre: AreaDistanceFrom = {
    point: [soho.centre.lng, soho.centre.lat],
    origin: "map",
  };
  const inArea = (id: string, extra: Partial<Venue> = {}) =>
    venue({
      id,
      latitude: soho.centre.lat + 0.001,
      longitude: soho.centre.lng + 0.001,
      ...extra,
    });

  it("ranks verified-priced pubs cheapest first", () => {
    const venues = [
      inArea("dear", { cheapestPrice: 7.2 }),
      inArea("cheap", { cheapestPrice: 4.5 }),
      inArea("mid", { cheapestPrice: 5.9 }),
    ];
    const rows = cheapestDrinksInArea(soho, venues, fromMapCentre);
    expect(rows.map((r) => r.id)).toEqual(["cheap", "mid", "dear"]);
    expect(rows[0].priceLabel).toBe("£4.50");
  });

  it("prefers a contributor's verified price over the baseline", () => {
    const venues = [
      inArea("baseline", { cheapestPrice: 5.0 }),
      inArea("dropped", { cheapestPrice: 6.0, latestContributorPrice: 4.2 }),
    ];
    const rows = cheapestDrinksInArea(soho, venues, fromMapCentre);
    expect(rows[0].id).toBe("dropped");
    expect(rows[0].priceLabel).toBe("£4.20");
  });

  it("keeps unpriced pubs after priced ones and fails their price soft", () => {
    const venues = [
      inArea("unpriced", { cheapestPrice: null }),
      inArea("priced", { cheapestPrice: 5.5 }),
    ];
    const rows = cheapestDrinksInArea(soho, venues, fromMapCentre);
    expect(rows.map((r) => r.id)).toEqual(["priced", "unpriced"]);
    expect(rows[1].priceLabel).toBe("no priced pints yet");
    expect(rows[1].price).toBeNull();
  });

  it("ranks the selected drink and never borrows a pint price", () => {
    const venues = [
      inArea("pint-only", { cheapestPrice: 4 }),
      inArea("whisky-dear", { cheapestPrice: 5 }),
      inArea("whisky-cheap", { cheapestPrice: 7 }),
    ];
    const whiskyPrices = new Map<string, MapLensPrice>([
      ["whisky-dear", {
        venueId: "whisky-dear",
        category: "whisky",
        categoryLabel: "Whisky",
        priceGbp: 8,
        submittedAt: 2_000,
        source: "community",
      }],
      ["whisky-cheap", {
        venueId: "whisky-cheap",
        category: "whisky",
        categoryLabel: "Whisky",
        priceGbp: 6,
        submittedAt: 2_000,
        source: "community",
      }],
    ]);

    const rows = cheapestDrinksInArea(
      soho,
      venues,
      fromMapCentre,
      10,
      whiskyPrices,
      "Whisky",
    );

    expect(rows.map((row) => row.id)).toEqual([
      "whisky-cheap",
      "whisky-dear",
      "pint-only",
    ]);
    expect(rows[0].priceLabel).toBe("Whisky · £6.00");
    expect(rows[2]).toMatchObject({
      price: null,
      priceLabel: "no whisky price logged",
    });
  });

  it("excludes venues outside the area radius and caps the list", () => {
    const near = Array.from({ length: 12 }, (_, i) =>
      inArea(`near-${i}`, { cheapestPrice: 4 + i * 0.1 }),
    );
    const faraway = venue({
      id: "faraway",
      latitude: 51.9,
      longitude: -0.02,
      cheapestPrice: 1.0,
    });
    const rows = cheapestDrinksInArea(
      soho,
      [...near, faraway],
      fromMapCentre,
    );
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.id === "faraway")).toBe(false);
  });
});

describe("cheapestDrinksNearPoint - ad-hoc locality/borough ring", () => {
  // Willesden-ish centroid, well away from any modelled Night Area centre.
  const centre: [number, number] = [-0.23, 51.55];
  const near = (id: string, extra: Partial<Venue> = {}) =>
    venue({ id, latitude: centre[1] + 0.002, longitude: centre[0] + 0.002, ...extra });

  it("ranks priced pubs cheapest first, measured from the centroid", () => {
    const rows = cheapestDrinksNearPoint(
      centre,
      [
        near("dear", { cheapestPrice: 6.5 }),
        near("cheap", { cheapestPrice: 4.1 }),
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(["cheap", "dear"]);
    expect(rows[0].priceLabel).toBe("£4.10");
    // Distance is measured from the centroid the camera flew to. That is a map
    // point, never the reader, so the row names it rather than saying "away".
    expect(rows[0].distanceLabel).toMatch(/^\d+ m from map centre$/);
    expect(rows[0].distanceLabel).not.toContain("away");
  });

  it("excludes venues outside the ~1.2km ring and caps at ten", () => {
    const inside = Array.from({ length: 12 }, (_, i) =>
      near(`in-${i}`, { cheapestPrice: 4 + i * 0.1 }),
    );
    // ~3km north of the centroid — outside the walkable ring.
    const outside = venue({ id: "outside", latitude: centre[1] + 0.03, longitude: centre[0], cheapestPrice: 1 });
    const rows = cheapestDrinksNearPoint(centre, [...inside, outside], LOCALITY_RADIUS_KM);
    expect(rows).toHaveLength(10);
    expect(rows.some((r) => r.id === "outside")).toBe(false);
  });

  it("returns [] (the honest no-priced-pints-nearby fallback) for an empty ring", () => {
    const faraway = venue({ id: "faraway", latitude: 51.9, longitude: 0.2, cheapestPrice: 5 });
    expect(cheapestDrinksNearPoint(centre, [faraway])).toEqual([]);
  });

  it("fails soft on a non-finite centroid rather than throwing", () => {
    expect(cheapestDrinksNearPoint([Number.NaN, 51.5], [near("x", { cheapestPrice: 4 })])).toEqual([]);
  });
});

describe("planAreaSelect — the search-select journey (panel closed + camera + sheet)", () => {
  const option = (over: Partial<AreaElsewhereOption> & Pick<AreaElsewhereOption, "slug" | "name" | "center">): AreaElsewhereOption => ({
    coverage: null,
    ...over,
  });

  it("collapses search and opens the Area sheet on any select", () => {
    const journey = planAreaSelect(option({ slug: "shoreditch", name: "Shoreditch", center: [-0.079, 51.524], kind: "area" }));
    // The dropdown CLOSES and the pubs display OPENS — both, every time.
    expect(journey.collapseSearch).toBe(true);
    expect(journey.openSheet).toBe("area");
  });

  it("flies a modelled area to the default zoom and shows it as-is by slug", () => {
    const journey = planAreaSelect(option({ slug: "shoreditch", name: "Shoreditch", center: [-0.079, 51.524], kind: "area" }));
    expect(journey.camera).toEqual({ center: [-0.079, 51.524], zoom: DEFAULT_AREA_FLY_ZOOM });
    expect(journey.target).toEqual({ kind: "area", slug: "shoreditch", name: "Shoreditch" });
    expect(journey.rememberedArea).toEqual({
      kind: "night-area",
      label: "Shoreditch",
      slug: "shoreditch",
      center: [-0.079, 51.524],
    });
  });

  it("derives a radius ring for a locality and honours its deeper fly zoom", () => {
    const journey = planAreaSelect(
      option({ slug: "locality:willesden", name: "Willesden", center: [-0.23, 51.55], kind: "locality", zoom: 14.5 }),
    );
    expect(journey.camera).toEqual({ center: [-0.23, 51.55], zoom: 14.5 });
    expect(journey.target).toEqual({ kind: "place", name: "Willesden", center: [-0.23, 51.55], radiusKm: LOCALITY_RADIUS_KM });
    expect(journey.rememberedArea).toEqual({
      kind: "locality",
      label: "Willesden",
      slug: "locality:willesden",
      center: [-0.23, 51.55],
    });
  });

  it("treats a borough as a place ring too", () => {
    const journey = planAreaSelect(option({ slug: "borough:hackney", name: "Hackney", center: [-0.06, 51.545], kind: "borough" }));
    expect(journey.target.kind).toBe("place");
    expect(journey.camera.zoom).toBe(DEFAULT_AREA_FLY_ZOOM);
    expect(journey.rememberedArea).toEqual({
      kind: "borough",
      label: "Hackney",
      slug: "borough:hackney",
      center: [-0.06, 51.545],
    });
  });

  it("treats an option with no kind (the Area-button grid) as a modelled area", () => {
    const journey = planAreaSelect(option({ slug: "clapham", name: "Clapham", center: [-0.138, 51.462] }));
    expect(journey.target).toEqual({ kind: "area", slug: "clapham", name: "Clapham" });
  });
});

describe("areaSheetOpenDelay — sheet opens as the camera settles", () => {
  it("waits the fly's settle time under normal motion", () => {
    expect(areaSheetOpenDelay(false)).toBe(AREA_SHEET_SETTLE_MS);
  });

  it("opens on the next tick when reduced-motion jumps the camera", () => {
    expect(areaSheetOpenDelay(true)).toBe(0);
  });
});

describe("areaCoverageLabel + areaElsewhereOptions — honest evidence", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("shows no warning for a route-ready area", () => {
    expect(areaCoverageLabel(getNightArea("clapham"), now)).toBeNull();
  });

  it("labels warned areas the way the plan intake does", () => {
    expect(areaCoverageLabel(getNightArea("shoreditch"), now)).toEqual({
      label: "Not all checked",
      tone: "capture",
    });
    expect(areaCoverageLabel(getNightArea("dalston"), now)).toEqual({
      label: "Rough guess",
      tone: "discovery",
    });
    expect(areaCoverageLabel(getNightArea("richmond"), now)).toEqual({
      label: "Gone stale",
      tone: "paused",
    });
  });

  it("lists every modelled London area with a fly-to centre", () => {
    const options = areaElsewhereOptions("london", now);
    expect(options.length).toBeGreaterThanOrEqual(20);
    const clapham = options.find((o) => o.slug === "clapham");
    expect(clapham?.center).toEqual([
      getNightArea("clapham").centre.lng,
      getNightArea("clapham").centre.lat,
    ]);
    expect(clapham?.coverage).toBeNull();
  });
});

describe("buildAreaSheetModel — the whole sheet in one derivation", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");

  it("is fail-soft when the centre resolved to no area", () => {
    const model = buildAreaSheetModel("london", null, [], [-0.13, 51.51], now);
    expect(model.areaName).toBe("");
    expect(model.pubs).toEqual([]);
    expect(model.elsewhere.length).toBeGreaterThanOrEqual(20);
  });

  it("names the area and derives its pubs when one is resolved", () => {
    const soho = getNightArea("piccadilly-soho");
    const venues = [
      venue({
        id: "a",
        latitude: soho.centre.lat,
        longitude: soho.centre.lng,
        cheapestPrice: 5.1,
      }),
    ];
    const model = buildAreaSheetModel(
      "london",
      soho,
      venues,
      [soho.centre.lng, soho.centre.lat],
      now,
    );
    expect(model.areaName).toBe("Piccadilly & Soho");
    expect(model.pubs).toHaveLength(1);
    expect(model.pubs[0].priceLabel).toBe("£5.10");
  });
});

describe("area rows under an incomplete drink read", () => {
  it("says the same thing the venue list says about the same index", () => {
    const soho = getNightArea("piccadilly-soho");
    const venues = [
      venue({
        id: "unpriced",
        latitude: soho.centre.lat,
        longitude: soho.centre.lng,
      }),
    ];
    const centre: AreaDistanceFrom = {
      point: [soho.centre.lng, soho.centre.lat],
      origin: "map",
    };
    const degraded = cheapestDrinksInArea(
      soho,
      venues,
      centre,
      undefined,
      new Map<string, MapLensPrice>(),
      "Whisky",
      "degraded",
    );
    expect(degraded[0].priceLabel).toBe("whisky price could not be read");
    expect(degraded[0].priceLabel).not.toContain("logged");

    const partial = cheapestDrinksInArea(
      soho,
      venues,
      centre,
      undefined,
      new Map<string, MapLensPrice>(),
      "Whisky",
      "partial",
    );
    expect(partial[0].priceLabel).toBe("no whisky price in what we read");
  });
});
