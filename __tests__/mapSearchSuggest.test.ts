import { describe, expect, it } from "vitest";

import {
  buildMapPlaceSuggestions,
  buildMapSearchSuggestions,
  formatSuggestDistance,
  LOCALITY_FLY_ZOOM,
  SUGGEST_PUB_LIMIT,
} from "@/lib/mapSearchSuggest";
import {
  UK_PLACE_MAP_ZOOM,
  type UkPlace,
} from "@/lib/ukPlaceSearch";
import { parseLocalityGazetteer, type Locality } from "@/lib/localities";
import { getNightArea, getNightAreasForCity } from "@/lib/nightAreas";
import type { Venue } from "@/lib/venues";
// The committed gazetteer — tests read it directly; the generation script
// (scripts/gen_london_localities.mjs) is never run here (hermetic).
import gazetteer from "@/public/data/london_localities.json";

// Minimal Venue factory — only the fields the suggest models read matter.
// Mirrors the house pattern in __tests__/areaButton.test.ts.
function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Westminster",
    cheapestPrice: null,
    latestContributorPrice: null,
    ...overrides,
  } as Venue;
}

const UK_PLACES: UkPlace[] = [
  {
    name: "Sheffield",
    lat: 53.3800941,
    lng: -1.4789213,
    kind: "city",
    context: "S",
    search: "sheffield",
  },
  {
    name: "Didsbury",
    lat: 53.4181794,
    lng: -2.23144,
    kind: "suburb",
    context: "M",
    search: "didsbury",
  },
  {
    name: "Camden",
    lat: 51.5389171,
    lng: -0.1418712,
    kind: "suburb",
    context: "NW",
    search: "camden",
  },
  {
    name: "Bath",
    lat: 51.38,
    lng: -2.36,
    kind: "city",
    context: "BA",
    search: "bath",
  },
];

const shoreditch = getNightArea("shoreditch");
const soho = getNightArea("piccadilly-soho");

// A map centre far from Shoreditch so distance ordering is unambiguous.
const CENTRE: [number, number] = [soho.centre.lng, soho.centre.lat];

describe("formatSuggestDistance — honest, origin-aware register", () => {
  it("reads the viewer's own distance as 'away'", () => {
    expect(formatSuggestDistance(0, "user")).toBe("right here");
    expect(formatSuggestDistance(0.42, "user")).toBe("420 m away");
    expect(formatSuggestDistance(1.25, "user")).toBe("1.3 km away");
  });

  it("reads a map-centre distance as 'from centre', never as the viewer's", () => {
    expect(formatSuggestDistance(0, "map-centre")).toBe("at the centre");
    expect(formatSuggestDistance(0.42, "map-centre")).toBe("420 m from centre");
    expect(formatSuggestDistance(1.25, "map-centre")).toBe("1.3 km from centre");
  });

  it("returns empty for a non-finite or negative distance", () => {
    expect(formatSuggestDistance(Number.NaN, "user")).toBe("");
    expect(formatSuggestDistance(-1, "map-centre")).toBe("");
  });
});

describe("buildMapSearchSuggestions — the as-you-type popup model", () => {
  it("matches a modelled area by name (the Hackney screenshot gap: areas surface)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "shored",
      venues: [],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.map((a) => a.slug)).toContain("shoreditch");
    expect(result.hasResults).toBe(true);
  });

  it("matches a modelled area by alias", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "hoxton", // Shoreditch alias
      venues: [],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.map((a) => a.slug)).toContain("shoreditch");
  });

  it("surfaces a borough (like Hackney) that is not a modelled area, with a fly centre", () => {
    const venues = [
      venue({ id: "h1", primaryBorough: "Hackney", latitude: 51.545, longitude: -0.056 }),
      venue({ id: "h2", primaryBorough: "Hackney", latitude: 51.547, longitude: -0.058 }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "hackney",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const hackney = result.areas.find((a) => a.name === "Hackney");
    expect(hackney).toBeDefined();
    expect(hackney?.kind).toBe("borough");
    // Fly centre is the centroid of its venues, in [lng, lat] order.
    expect(hackney?.center[0]).toBeCloseTo(-0.057, 2);
    expect(hackney?.center[1]).toBeCloseTo(51.546, 2);
    expect(hackney?.coverage).toBeNull();
  });

  it("never shows a borough that collides with a modelled area name (no duplicate Camden)", () => {
    const venues = [
      venue({ id: "c1", primaryBorough: "Camden", latitude: 51.539, longitude: -0.143 }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "camden",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const camdens = result.areas.filter((a) => a.name === "Camden");
    expect(camdens).toHaveLength(1);
    expect(camdens[0].kind).toBe("area");
  });

  it("returns one exact Venue without inventing companion rows", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "only arms",
      venues: [
        venue({ id: "only", name: "The Only Arms" }),
        venue({ id: "other", name: "Different Tavern" }),
      ],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas).toHaveLength(0);
    expect(result.pubs.map((pub) => pub.id)).toEqual(["only"]);
  });

  it("matches many Venues by name and caps the group", () => {
    const venues = Array.from({ length: 10 }, (_, i) =>
      venue({ id: `crown-${i}`, name: `The Crown ${i}`, latitude: 51.51 + i * 0.001, longitude: -0.13 }),
    );
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "crown",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs.length).toBe(SUGGEST_PUB_LIMIT);
    expect(result.pubs.every((p) => p.name.startsWith("The Crown"))).toBe(true);
  });

  it("labels pub distance from the viewer's GPS when present, else the map centre", () => {
    const near = venue({ id: "near", name: "The Local", latitude: 51.53, longitude: -0.1 });
    const withUser = buildMapSearchSuggestions({
      cityId: "london",
      query: "local",
      venues: [near],
      userLocation: { lat: 51.525, lng: -0.1 },
      mapCenter: CENTRE,
    });
    expect(withUser.origin).toBe("user");
    expect(withUser.pubs[0].distanceLabel).toContain("away");

    const withoutUser = buildMapSearchSuggestions({
      cityId: "london",
      query: "local",
      venues: [near],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(withoutUser.origin).toBe("map-centre");
    expect(withoutUser.pubs[0].distanceLabel).toContain("from centre");
  });

  it("carries a verified pub price when one exists, null otherwise", () => {
    const venues = [
      venue({ id: "priced", name: "Priced Arms", cheapestPrice: 5.2 }),
      venue({ id: "unpriced", name: "Unpriced Arms", cheapestPrice: null }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "arms",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const priced = result.pubs.find((p) => p.id === "priced");
    const unpriced = result.pubs.find((p) => p.id === "unpriced");
    expect(priced?.priceLabel).toBe("£5.20");
    expect(unpriced?.priceLabel).toBeNull();
  });

  it("carries venue kind labels and keeps non-pub anchors independent of Pint Drops", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "anchor",
      venues: [
        venue({
          id: "bar",
          name: "Anchor Cocktail Bar",
          kind: "bar",
          cheapestPrice: 25,
          latestContributorPrice: 4.5,
          anchorLabel: "Signature cocktail",
          anchorObservedAt: "2025-07-26",
          anchorSourceUrl: "https://www.example.com/cocktails",
        }),
        venue({
          id: "food",
          name: "Anchor Kebab",
          kind: "food",
          cheapestPrice: 15,
          latestContributorPrice: 5,
          anchorLabel: "Large lamb doner",
          anchorObservedAt: "2025-06-15",
          anchorSourceUrl: "https://menu.example.org/doner",
        }),
      ],
      userLocation: null,
      mapCenter: CENTRE,
    });
    const byId = new Map(result.pubs.map((row) => [row.id, row]));
    expect(byId.get("bar")).toMatchObject({
      kind: "bar",
      typeLabel: "Bar",
      priceLabel: "£25.00",
      anchor: {
        label: "Signature cocktail",
        observedLabel: "Jul 2025",
        sourceLabel: "example.com",
        sourceUrl: "https://www.example.com/cocktails",
      },
    });
    expect(byId.get("food")).toMatchObject({
      kind: "food",
      typeLabel: "Late food",
      priceLabel: "£15.00",
      anchor: {
        label: "Large lamb doner",
        observedLabel: "Jun 2025",
        sourceLabel: "menu.example.org",
        sourceUrl: "https://menu.example.org/doner",
      },
    });
  });

  it("omits a non-pub price when its compact provenance is incomplete", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "anchor",
      venues: [
        venue({
          id: "bar",
          name: "Anchor Cocktail Bar",
          kind: "bar",
          cheapestPrice: 25,
        }),
      ],
      userLocation: null,
      mapCenter: CENTRE,
    });

    expect(result.pubs[0]).toMatchObject({
      priceLabel: null,
      anchor: null,
    });
  });

  it("ranks pubs nearest-first within a tier", () => {
    const venues = [
      venue({ id: "far", name: "Anchor Far", latitude: 51.6, longitude: -0.3 }),
      venue({ id: "near", name: "Anchor Near", latitude: soho.centre.lat, longitude: soho.centre.lng }),
    ];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "anchor",
      venues,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs[0].id).toBe("near");
  });

  it("returns nearby areas and no pubs for an empty query (minimal prompt)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "   ",
      venues: [venue({ id: "x", name: "Whatever" })],
      userLocation: null,
      mapCenter: [shoreditch.centre.lng, shoreditch.centre.lat],
    });
    expect(result.isEmptyQuery).toBe(true);
    expect(result.pubs).toHaveLength(0);
    expect(result.areas.length).toBeGreaterThan(0);
    // Nearest area to a Shoreditch centre is Shoreditch itself.
    expect(result.areas[0].slug).toBe("shoreditch");
  });

  it("returns empty groups (not a match) for a query nothing answers", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "zzzznowhere",
      venues: [venue({ id: "x", name: "The Crown" })],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.hasResults).toBe(false);
    expect(result.areas).toHaveLength(0);
    expect(result.pubs).toHaveLength(0);
  });

  it("does not move the camera math when coords are non-finite (fails soft to no label)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "crown",
      venues: [venue({ id: "bad", name: "The Crown", latitude: Number.NaN, longitude: Number.NaN })],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.pubs[0].distanceLabel).toBe("");
  });

  it("surfaces resident UK base pubs in their own group, never when none are loaded", () => {
    const without = buildMapSearchSuggestions({
      cityId: "london",
      query: "fat cat",
      venues: [],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(without.ukBasePubs).toEqual([]);

    const withResident = buildMapSearchSuggestions({
      cityId: "london",
      query: "fat cat",
      venues: [],
      ukBasePubs: [
        {
          id: "venue-uk-n-fat",
          name: "The Fat Cat",
          address: "23 Alma Street",
          lat: 53.391,
          lng: -1.477,
          curatedVenueId: "",
        },
      ],
      userLocation: null,
      mapCenter: [-1.47, 53.38],
    });
    expect(withResident.ukBasePubs.map((row) => row.id)).toEqual(["venue-uk-n-fat"]);
    expect(withResident.hasResults).toBe(true);
    expect(withResident.pubs).toHaveLength(0);
  });
});

describe("buildMapPlaceSuggestions — in-map UK place search", () => {
  it("returns an uncovered place on the chooser arrival href at base zoom", () => {
    const results = buildMapPlaceSuggestions({
      query: "Sheffield",
      places: UK_PLACES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(results[0]).toMatchObject({
      name: "Sheffield",
      placeKind: "uncovered",
      href: "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
      flyZoom: UK_PLACE_MAP_ZOOM,
      contextLabel: "S",
    });
    expect(results[0].center).toEqual([-1.4789213, 53.3800941]);
  });

  it("routes a place inside a curated city to that city guide", () => {
    const results = buildMapPlaceSuggestions({
      query: "Didsbury",
      places: UK_PLACES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(results[0]).toMatchObject({
      name: "Didsbury",
      placeKind: "curated",
      cityId: "manchester",
      href: "/map/manchester",
    });
  });

  it("drops names already shown as local areas so Camden is not listed twice", () => {
    const results = buildMapPlaceSuggestions({
      query: "Camden",
      places: UK_PLACES,
      excludedNames: ["Camden"],
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(results).toEqual([]);
  });

  it("skips the current city guide row when already on that map", () => {
    const results = buildMapPlaceSuggestions({
      query: "Bath",
      places: UK_PLACES,
      currentCityId: "bath",
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(results.map((r) => r.name)).not.toContain("Bath");
  });

  it("does not answer a one-character query", () => {
    expect(
      buildMapPlaceSuggestions({
        query: "s",
        places: UK_PLACES,
        userLocation: null,
        mapCenter: CENTRE,
      }),
    ).toEqual([]);
  });
});

describe("buildMapSearchSuggestions — UK places fill limited coverage", () => {
  it("surfaces Sheffield from the national gazetteer beside local results", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "Sheffield",
      venues: [],
      places: UK_PLACES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.places.map((p) => p.name)).toContain("Sheffield");
    expect(result.hasResults).toBe(true);
  });

  it("still answers with places when local results are suppressed", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "Sheffield",
      venues: [venue({ id: "v1", name: "The Sheffield Arms" })],
      places: UK_PLACES,
      includeLocalResults: false,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas).toEqual([]);
    expect(result.pubs).toEqual([]);
    expect(result.places[0]?.name).toBe("Sheffield");
    expect(result.hasResults).toBe(true);
  });

  it("keeps local area matches ahead of a colliding UK place name", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "camden",
      venues: [],
      places: UK_PLACES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.some((a) => a.name.toLowerCase().includes("camden"))).toBe(true);
    expect(result.places.map((p) => p.name)).not.toContain("Camden");
  });
});

// A tiny synthetic gazetteer — a locality, a modelled-area collision, and a
// same-named borough — so the ranking/dedup rules are exercised deterministically.
const LOCALITIES: Locality[] = [
  { name: "Willesden", lat: 51.549, lng: -0.229, borough: "Brent" },
  { name: "Cricklewood", lat: 51.556, lng: -0.213, borough: "Brent" },
  { name: "Shoreditch", lat: 51.524, lng: -0.079, borough: "Hackney" }, // modelled-area collision
];

describe("buildMapSearchSuggestions — localities (the basemap-label gap)", () => {
  it("surfaces a locality the basemap paints but the model never knew", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "willes",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const willesden = result.areas.find((a) => a.name === "Willesden");
    expect(willesden).toBeDefined();
    expect(willesden?.kind).toBe("locality");
    expect(willesden?.center).toEqual([-0.229, 51.549]);
    expect(willesden?.contextLabel).toBe("Brent");
    expect(willesden?.areaNewsArea).toBe("brent");
  });

  it("gives a locality NO coverage chip and a deeper fly zoom (place, not a promise)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "cricklewood",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const row = result.areas.find((a) => a.name === "Cricklewood");
    expect(row?.coverage).toBeNull();
    expect(row?.flyZoom).toBe(LOCALITY_FLY_ZOOM);
  });

  it("drops a locality that collides with a modelled area (no double Shoreditch)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "shoreditch",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    const shoreditches = result.areas.filter((a) => a.name === "Shoreditch");
    expect(shoreditches).toHaveLength(1);
    expect(shoreditches[0].kind).toBe("area");
    expect(shoreditches[0].areaNewsArea).toBe("shoreditch");
  });

  it("orders modelled area, then locality, then borough at an equal tier + distance", () => {
    // All three share a coordinate + a whole-label match, so only kind breaks the tie.
    const soho2 = getNightArea("piccadilly-soho");
    const pt: [number, number] = [soho2.centre.lng, soho2.centre.lat];
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "riverside",
      venues: [venue({ id: "b1", primaryBorough: "Riverside", latitude: pt[1], longitude: pt[0] })],
      localities: [
        { name: "Soho", lat: pt[1], lng: pt[0], borough: "Westminster" }, // dropped: modelled alias
        { name: "Riverside", lat: pt[1], lng: pt[0], borough: "Wandsworth" },
      ],
      userLocation: null,
      mapCenter: pt,
      areaLimit: 20,
    });
    // "Riverside" exists as both a locality and a borough at the same point/tier;
    // the locality must rank ahead of the borough, and the borough is deduped out.
    const riverside = result.areas.filter((a) => a.name === "Riverside");
    expect(riverside).toHaveLength(1);
    expect(riverside[0].kind).toBe("locality");
  });

  it("ignores localities on an empty query (the prompt stays to modelled areas)", () => {
    const result = buildMapSearchSuggestions({
      cityId: "london",
      query: "",
      venues: [],
      localities: LOCALITIES,
      userLocation: null,
      mapCenter: CENTRE,
    });
    expect(result.areas.every((a) => a.kind === "area")).toBe(true);
  });
});

describe("london_localities.json — committed gazetteer integrity", () => {
  const localities = parseLocalityGazetteer(gazetteer);
  const [lonMin, latMin, lonMax, latMax] = gazetteer.bbox as [number, number, number, number];

  it("ships an ODbL / OpenStreetMap attribution header", () => {
    expect(gazetteer.license).toMatch(/odbl/i);
    expect(gazetteer.attribution).toMatch(/openstreetmap/i);
  });

  it("clears the count floor and matches its header count", () => {
    expect(localities.length).toBeGreaterThanOrEqual(300);
    expect(gazetteer.count).toBe(gazetteer.localities.length);
  });

  it("has finite coordinates inside the Greater London bbox for every row", () => {
    for (const l of localities) {
      expect(Number.isFinite(l.lat) && Number.isFinite(l.lng)).toBe(true);
      expect(l.lng).toBeGreaterThanOrEqual(lonMin);
      expect(l.lng).toBeLessThanOrEqual(lonMax);
      expect(l.lat).toBeGreaterThanOrEqual(latMin);
      expect(l.lat).toBeLessThanOrEqual(latMax);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.borough.length).toBeGreaterThan(0);
    }
  });

  it("carries globally-unique normalised names (dedupe invariant)", () => {
    const norm = localities.map((l) => l.name.trim().toLowerCase().replace(/\s+/g, " "));
    expect(new Set(norm).size).toBe(norm.length);
  });

  it("never collides with a modelled Night Area name or alias", () => {
    const modelled = new Set<string>();
    for (const area of getNightAreasForCity("london")) {
      modelled.add(area.name.toLowerCase());
      for (const alias of area.aliases) modelled.add(alias.toLowerCase());
    }
    const collisions = localities.filter((l) => modelled.has(l.name.toLowerCase()));
    expect(collisions).toHaveLength(0);
  });
});
