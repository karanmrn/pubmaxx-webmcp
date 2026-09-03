import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCultureOpener,
  cleanCultureOpener,
  CULTURE_CRAWL_CHIP_IDS,
  CULTURE_CRAWL_CHIP_QUERIES,
  CULTURE_CRAWL_CHIPS,
  CULTURE_CRAWL_MISSION,
  CULTURE_WAYPOINT_KINDS,
  CULTURE_WAYPOINT_MAX_KM,
  CULTURE_WAYPOINT_NONE_NOTE,
  CULTURE_WAYPOINT_OPEN_AIR_NOTE,
  CULTURE_WAYPOINT_UNKNOWN_NOTE,
  cultureCrawlChipQuery,
  cultureWaypointKindsForQuery,
  isCultureCrawlChipId,
  selectCultureWaypoint,
  type CultureWaypointKind,
} from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { inferNightContext } from "@/lib/nightPlanning";
import { getNightArea } from "@/lib/nightAreas";
import { normalizePois, type Poi } from "@/lib/pois";
import { parsePlanDescribeFromSearch, planOccasionHref, SOFT_PLAN_OCCASION_IDS } from "@/lib/planOccasion";

const LONDON_POIS: Poi[] = normalizePois(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/london_pois.json"), "utf8")),
);

/** Fixed London evening so a daytime word in a chip must beat the clock. */
const EVENING = new Date("2026-08-07T19:30:00.000Z");

describe("Culture Crawl chips", () => {
  it("keeps a closed id set that never collides with the soft occasions", () => {
    expect(CULTURE_CRAWL_CHIP_IDS).toEqual([
      "gallery-pint",
      "market-kebab",
      "river-historic",
      "sights-quiet",
    ]);
    expect(CULTURE_CRAWL_CHIPS.map((chip) => chip.id)).toEqual([...CULTURE_CRAWL_CHIP_IDS]);
    for (const id of CULTURE_CRAWL_CHIP_IDS) {
      expect(SOFT_PLAN_OCCASION_IDS).not.toContain(id as never);
      expect(isCultureCrawlChipId(id)).toBe(true);
    }
    expect(isCultureCrawlChipId("gallery")).toBe(false);
    expect(isCultureCrawlChipId(null)).toBe(false);
  });

  it("ships the four step-out labels the mission names", () => {
    expect(CULTURE_CRAWL_CHIPS.map((chip) => chip.label)).toEqual([
      "Gallery then a pint",
      "Market wander + kebab",
      "River walk + historic pub",
      "Sights then a quiet one",
    ]);
  });

  it("stays VOICE-clean in every shipped string", () => {
    const strings = [
      CULTURE_CRAWL_MISSION,
      CULTURE_WAYPOINT_NONE_NOTE,
      CULTURE_WAYPOINT_UNKNOWN_NOTE,
      CULTURE_WAYPOINT_OPEN_AIR_NOTE,
      ...CULTURE_CRAWL_CHIPS.flatMap((chip) => [chip.label, chip.query]),
    ];
    for (const value of strings) {
      expect(value).not.toMatch(/—|–/);
      expect(value).not.toMatch(/!/);
      expect(value).not.toMatch(/\b(?:curated|discover|experience|seamless|unlock|journey)\b/i);
    }
  });

  it("names no free entry, no hours and no exhibition anywhere in its copy", () => {
    const source = readFileSync(join(process.cwd(), "lib/cultureCrawl.ts"), "utf8");
    // The layer holds none of these, so no shipped sentence may assert one.
    for (const claim of [
      "free entry",
      "free admission",
      "open until",
      "open now",
      "on show",
      "currently showing",
    ]) {
      expect(source.toLowerCase()).not.toContain(claim);
    }
  });
});

describe("Culture Crawl prefill queries", () => {
  it.each(CULTURE_CRAWL_CHIPS)("parses $id into a real area with its occasion", (chip) => {
    const { context } = inferNightContext(chip.query, EVENING);
    expect(context.nightArea).not.toBeNull();
    expect(() => getNightArea(context.nightArea!)).not.toThrow();
  });

  it("never carries a transport word, which would refuse the route outright", () => {
    // selectGroundedPlanRoute returns ok:false the moment a context has ANY
    // transportConstraint, so "river walk ..." 422s where "riverside ..."
    // builds. A chip that 422s is a promise the planner cannot keep.
    for (const chip of CULTURE_CRAWL_CHIPS) {
      expect(
        inferNightContext(chip.query, EVENING).context.transportConstraints,
        `${chip.id} would refuse the grounded route`,
      ).toEqual([]);
    }
  });

  it("carries the occasion each label promises", () => {
    expect(inferNightContext(cultureCrawlChipQuery("market-kebab"), EVENING).context.foodNeeds)
      .toContain("kebab");
    expect(inferNightContext(cultureCrawlChipQuery("river-historic"), EVENING).context.atmosphere)
      .toContain("historic");
    expect(inferNightContext(cultureCrawlChipQuery("sights-quiet"), EVENING).context.atmosphere)
      .toContain("quiet");
    expect(inferNightContext(cultureCrawlChipQuery("gallery-pint"), EVENING).context.groupSize).toBe(2);
  });

  it("round-trips every chip through the plan deep link", () => {
    for (const chip of CULTURE_CRAWL_CHIPS) {
      expect(planOccasionHref(chip.id, { src: "tonight-culture" })).toBe(
        `/plan?occasion=${chip.id}&src=tonight-culture`,
      );
      expect(parsePlanDescribeFromSearch(`?occasion=${chip.id}`)).toBe(chip.query);
      expect(parsePlanDescribeFromSearch(`?describe=${encodeURIComponent(chip.query)}`)).toBe(
        chip.query,
      );
    }
    expect(parsePlanDescribeFromSearch("?occasion=gallery")).toBeNull();
    expect(parsePlanDescribeFromSearch("?describe=gallery%20then%20a%20pint%20in%20Soho")).toBeNull();
  });

  it("keeps the culture queries out of the plain example chip row", () => {
    for (const query of CULTURE_CRAWL_CHIP_QUERIES) {
      expect(DESCRIBE_FIRST_CHIPS).not.toContain(query);
    }
  });
});

describe("Culture waypoint lanes", () => {
  it("reads only the closed lane vocabulary out of a query", () => {
    expect(cultureWaypointKindsForQuery("gallery then a pint in Soho for 2")).toEqual(["gallery"]);
    expect(cultureWaypointKindsForQuery("market wander then a kebab in Camden for 3")).toEqual(["market"]);
    expect(cultureWaypointKindsForQuery("sights then a quiet one in Victoria for 2")).toEqual(["sight"]);
    expect(cultureWaypointKindsForQuery("")).toEqual([]);
    expect(cultureWaypointKindsForQuery(null)).toEqual([]);
  });

  it("gives the waypoint to the riverside, not to the pub adjective", () => {
    const kinds = cultureWaypointKindsForQuery("river walk then a historic pub in Bermondsey for 2");
    expect(kinds).toEqual(["riverside", "historic"]);
    expect(kinds[0]).toBe<CultureWaypointKind>("riverside");
  });

  it("adds nothing to an ordinary pub describe chip", () => {
    for (const chip of DESCRIBE_FIRST_CHIPS) {
      expect(cultureWaypointKindsForQuery(chip)).toEqual([]);
      expect(buildCultureOpener({ query: chip, pois: LONDON_POIS, origin: { lat: 51.462, lng: -0.138 } }))
        .toBeNull();
    }
  });

  it("keeps every lane pointed at a category the layer actually has", () => {
    for (const kind of CULTURE_WAYPOINT_KINDS) {
      const found = LONDON_POIS.some((poi) =>
        selectCultureWaypoint([poi], [kind], {
          lat: poi.coordinates[1],
          lng: poi.coordinates[0],
        }) !== null);
      expect(found, `no London POI can ever answer the ${kind} lane`).toBe(true);
    }
  });
});

describe("Culture waypoint selection", () => {
  const soho = getNightArea("piccadilly-soho").centre;

  it("only ever answers a gallery ask with a POI whose own name says so", () => {
    const waypoint = selectCultureWaypoint(LONDON_POIS, ["gallery"], soho);
    expect(waypoint).not.toBeNull();
    expect(waypoint!.name).toMatch(/\b(?:gallery|galleries|museum)\b/i);
    expect(waypoint!.kind).toBe("gallery");
  });

  it("picks the nearest qualifying POI and breaks ties on id", () => {
    const pois: Poi[] = [
      { id: "market-b", name: "B Market", category: "market", coordinates: [-0.1, 51.5] },
      { id: "market-a", name: "A Market", category: "market", coordinates: [-0.1, 51.5] },
      { id: "market-far", name: "Far Market", category: "market", coordinates: [-0.5, 51.5] },
    ];
    const waypoint = selectCultureWaypoint(pois, ["market"], { lat: 51.5, lng: -0.1 });
    expect(waypoint?.poiId).toBe("market-a");
    expect(waypoint?.distanceKm).toBe(0);
  });

  it("refuses a POI beyond the walk budget rather than reaching for it", () => {
    const far: Poi[] = [
      { id: "market-far", name: "Far Market", category: "market", coordinates: [-0.3, 51.5] },
    ];
    expect(selectCultureWaypoint(far, ["market"], { lat: 51.5, lng: -0.1 })).toBeNull();
    expect(CULTURE_WAYPOINT_MAX_KM).toBeLessThanOrEqual(1.5);
  });

  it("emits only the fields the POI record holds", () => {
    const waypoint = selectCultureWaypoint(LONDON_POIS, ["market"], getNightArea("camden").centre);
    expect(waypoint).not.toBeNull();
    expect(Object.keys(waypoint!).sort()).toEqual([
      "categoryLabel",
      "category",
      "coordinates",
      "distanceKm",
      "kind",
      "name",
      "poiId",
    ].sort());
  });
});

describe("Culture opener honesty", () => {
  it("builds an opener for every shipped chip against the real layer", () => {
    for (const chip of CULTURE_CRAWL_CHIPS) {
      const area = getNightArea(inferNightContext(chip.query, EVENING).context.nightArea!);
      const opener = buildCultureOpener({ query: chip.query, pois: LONDON_POIS, origin: area.centre });
      expect(opener, chip.id).not.toBeNull();
      expect(opener!.requested.length).toBeGreaterThan(0);
      expect(opener!.waypoint, `${chip.id} found no waypoint near ${area.name}`).not.toBeNull();
      expect(opener!.note).not.toBe(CULTURE_WAYPOINT_NONE_NOTE);
    }
  });

  it("says it found nothing rather than substituting a nearest anything", () => {
    const opener = buildCultureOpener({
      query: "gallery then a pint in Soho for 2",
      pois: [{ id: "park-x", name: "Some Park", category: "park", coordinates: [-0.134, 51.511] }],
      origin: { lat: 51.511, lng: -0.134 },
    });
    expect(opener?.waypoint).toBeNull();
    expect(opener?.note).toBe(CULTURE_WAYPOINT_NONE_NOTE);
  });

  it("drops the admission clause for a place with no door", () => {
    const pier = buildCultureOpener({
      query: "river walk then a historic pub in Bermondsey for 2",
      pois: [{ id: "river-x", name: "A Pier", category: "river", coordinates: [-0.082, 51.504] }],
      origin: { lat: 51.504, lng: -0.082 },
    });
    expect(pier?.note).toBe(CULTURE_WAYPOINT_OPEN_AIR_NOTE);
    const gallery = buildCultureOpener({
      query: "gallery then a pint in Soho for 2",
      pois: [{ id: "sight-x", name: "A Museum", category: "sight", coordinates: [-0.134, 51.511] }],
      origin: { lat: 51.511, lng: -0.134 },
    });
    expect(gallery?.note).toBe(CULTURE_WAYPOINT_UNKNOWN_NOTE);
  });

  it("never emits a price, an hour or an era beside a waypoint", () => {
    const opener = buildCultureOpener({
      query: "market wander then a kebab in Camden for 3",
      pois: LONDON_POIS,
      origin: getNightArea("camden").centre,
    });
    // The note is allowed to NAME what is missing; the waypoint may not carry it.
    const serialized = JSON.stringify(opener?.waypoint);
    expect(serialized).not.toMatch(/price|pence|opensAt|closesAt|hours|era|admission|listed|free/i);
  });
});

describe("Culture opener response reader", () => {
  const valid = {
    requested: ["market"],
    waypoint: {
      poiId: "market-camden-market",
      name: "Camden Market",
      category: "market",
      categoryLabel: "Markets",
      kind: "market",
      distanceKm: 0.12,
      coordinates: [-0.1464, 51.5414],
    },
    note: CULTURE_WAYPOINT_UNKNOWN_NOTE,
  };

  it("accepts a well-formed opener unchanged", () => {
    expect(cleanCultureOpener(valid)).toEqual(valid);
  });

  it("refuses a half-built waypoint rather than printing a bare name", () => {
    const broken = cleanCultureOpener({
      ...valid,
      waypoint: { ...valid.waypoint, distanceKm: "near" },
    });
    expect(broken?.waypoint).toBeNull();
    expect(broken?.note).toBe(CULTURE_WAYPOINT_NONE_NOTE);
  });

  it("refuses junk and an empty lane list", () => {
    expect(cleanCultureOpener(null)).toBeNull();
    expect(cleanCultureOpener({ requested: [], waypoint: null, note: "x" })).toBeNull();
    expect(cleanCultureOpener({ requested: ["nope"], waypoint: null, note: "x" })).toBeNull();
    expect(cleanCultureOpener({ requested: ["market"], waypoint: null, note: "" })).toBeNull();
  });
});
