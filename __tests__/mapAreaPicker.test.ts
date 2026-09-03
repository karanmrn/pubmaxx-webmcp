import { describe, expect, it } from "vitest";

import type { Locality } from "@/lib/localities";
import { getNightAreasForCity } from "@/lib/nightAreas";
import {
  completeNeighbourhoodCountSlugs,
  filterChooseAreaNeighbourhoods,
  londonNeighbourhoodRows,
  nightAreaCoverageBounds,
  otherCityRows,
  type ChooseAreaNeighbourhood,
} from "@/lib/mapAreaPicker";
import { boundsCoveredByLoadedShards, type ShardManifest } from "@/lib/slimShards";
import type { Venue } from "@/lib/venues";

const CAMDEN: ChooseAreaNeighbourhood = {
  slug: "camden",
  name: "Camden",
  pubCount: 42,
  center: [-0.143, 51.539],
};

const SHOREDITCH: ChooseAreaNeighbourhood = {
  slug: "shoreditch",
  name: "Shoreditch",
  pubCount: 30,
  center: [-0.078, 51.526],
};

function pubAt(id: string, lat: number, lng: number): Venue {
  return { id, name: id, latitude: lat, longitude: lng } as unknown as Venue;
}

function locality(name: string, borough: string): Locality {
  return { name, borough, lat: 51.5, lng: -0.1 };
}

describe("filterChooseAreaNeighbourhoods", () => {
  it("returns every row for an empty query", () => {
    expect(filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "  ")).toEqual([
      CAMDEN,
      SHOREDITCH,
    ]);
  });

  it("matches a night area by name, case-insensitively", () => {
    expect(
      filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "shore"),
    ).toEqual([SHOREDITCH]);
  });

  it("adds gazetteer rows matched by name or borough", () => {
    const rows = filterChooseAreaNeighbourhoods(
      [CAMDEN, SHOREDITCH],
      "willesden",
      [locality("Willesden", "Brent"), locality("Peckham", "Southwark")],
    );
    expect(rows.map((row) => row.name)).toEqual(["Willesden"]);
    // A gazetteer row is a navigation target and nobody counted its pubs, so it
    // may never print a figure - least of all a zero.
    expect(rows[0]).toMatchObject({ slug: "locality:willesden", pubCount: null });
  });

  it("never prints two rows a reader cannot tell apart", () => {
    // A gazetteer entry sharing a night area's name is the collision: the two
    // rows carry different slugs by construction (`locality:` prefix), so only
    // the visible name can decide, and the counted night area wins.
    const rows = filterChooseAreaNeighbourhoods([CAMDEN, SHOREDITCH], "camden", [
      locality("Camden", "Camden"),
    ]);
    expect(rows).toEqual([CAMDEN]);
  });

  it("keeps a gazetteer row whose name differs only by case out too", () => {
    const rows = filterChooseAreaNeighbourhoods([CAMDEN], "camden", [
      locality("camden", "Camden"),
    ]);
    expect(rows).toEqual([CAMDEN]);
  });
});

describe("otherCityRows", () => {
  it("never offers the city the reader is already in", () => {
    const rows = otherCityRows("london");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.cityId)).not.toContain("london");
  });
});

describe("neighbourhood pub counts only speak for a complete index", () => {
  const areas = getNightAreasForCity("london");
  const camden = areas.find((area) => area.slug === "camden")!;
  const shoreditch = areas.find((area) => area.slug === "shoreditch")!;

  function pubsInside(area: typeof camden, count: number): Venue[] {
    return Array.from({ length: count }, (_, index) =>
      pubAt(`${area.slug}-${index}`, area.centre.lat, area.centre.lng),
    );
  }

  it("prints a figure only for an area whose shards have all landed", () => {
    const venues = [...pubsInside(camden, 3), ...pubsInside(shoreditch, 2)];
    const rows = londonNeighbourhoodRows(venues, "london", new Set(["camden"]));
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    expect(bySlug.get("camden")?.pubCount).toBe(3);
    // Shoreditch really holds two loaded pins, and the row still says nothing,
    // because nobody can promise those two are all of them.
    expect(bySlug.get("shoreditch")?.pubCount).toBeNull();
  });

  it("says nothing at all when no area can be vouched for", () => {
    const rows = londonNeighbourhoodRows(pubsInside(camden, 3), "london", null);
    expect(rows.every((row) => row.pubCount === null)).toBe(true);
    // And an uncounted list is still ordered, by name rather than by figure.
    expect(rows.map((row) => row.name)).toEqual(
      [...rows.map((row) => row.name)].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("orders counted areas ahead of uncounted ones", () => {
    const venues = [...pubsInside(camden, 3), ...pubsInside(shoreditch, 9)];
    const rows = londonNeighbourhoodRows(
      venues,
      "london",
      new Set(["camden", "shoreditch"]),
    );
    expect(rows[0]?.slug).toBe("shoreditch");
    expect(rows[1]?.slug).toBe("camden");
    expect(rows.slice(2).every((row) => row.pubCount === null)).toBe(true);
  });
});

describe("completeNeighbourhoodCountSlugs", () => {
  it("takes only a definite yes, never a loader that has not answered", () => {
    const slugByBoundsKey = new Map(
      getNightAreasForCity("london").map((area) => {
        const bounds = nightAreaCoverageBounds(area);
        return [`${bounds.west}:${bounds.south}`, area.slug];
      }),
    );
    const complete = completeNeighbourhoodCountSlugs("london", (bounds) =>
      slugByBoundsKey.get(`${bounds.west}:${bounds.south}`) === "camden"
        ? true
        : null,
    );
    expect([...complete]).toEqual(["camden"]);
  });

  it("drops an area whose shard is still in flight", () => {
    const complete = completeNeighbourhoodCountSlugs("london", () => false);
    expect(complete.size).toBe(0);
  });
});

describe("boundsCoveredByLoadedShards", () => {
  const manifest: ShardManifest = {
    version: 1,
    shards: [
      {
        id: "core",
        core: true,
        url: "/data/venues_slim.core.json",
        count: 900,
        bbox: [-0.2, 51.45, 0.0, 51.56],
      },
      {
        id: "brent",
        core: false,
        url: "/data/venues_slim.brent.json",
        count: 120,
        bbox: [-0.35, 51.53, -0.2, 51.6],
        partition: "borough",
        borough: "Brent",
      },
    ],
  };
  const inCoreOnly = { west: -0.16, east: -0.12, south: 51.5, north: 51.54 };
  const spanningBrent = { west: -0.3, east: -0.15, south: 51.52, north: 51.58 };

  it("is complete for a patch only core covers once core has loaded", () => {
    expect(
      boundsCoveredByLoadedShards(
        manifest,
        new Set(["/data/venues_slim.core.json"]),
        inCoreOnly,
      ),
    ).toBe(true);
  });

  it("is incomplete while an intersecting shard has not loaded", () => {
    expect(
      boundsCoveredByLoadedShards(
        manifest,
        new Set(["/data/venues_slim.core.json"]),
        spanningBrent,
      ),
    ).toBe(false);
    expect(
      boundsCoveredByLoadedShards(
        manifest,
        new Set([
          "/data/venues_slim.core.json",
          "/data/venues_slim.brent.json",
        ]),
        spanningBrent,
      ),
    ).toBe(true);
  });

  it("is incomplete before core itself has landed", () => {
    expect(boundsCoveredByLoadedShards(manifest, new Set(), inCoreOnly)).toBe(
      false,
    );
  });
});
