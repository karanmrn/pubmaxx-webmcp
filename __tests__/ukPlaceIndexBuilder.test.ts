import { describe, expect, it } from "vitest";

import { buildUkPlaceIndex } from "@/scripts/lib/ukPlaceIndex.mjs";

const node = (
  id: number,
  lat: number,
  lon: number,
  tags: Record<string, string>,
) => ({
  type: "node",
  id,
  lat,
  lon,
  tags: { amenity: "pub", name: `Pub ${id}`, ...tags },
});

describe("UK place index builder", () => {
  it("derives navigation places from locality tags already attached to UK pubs", () => {
    const index = buildUkPlaceIndex([
      node(1, 53.381, -1.47, {
        "addr:city": "Sheffield",
        "addr:suburb": "Kelham Island",
        "addr:postcode": "S3 8RY",
      }),
      node(2, 53.383, -1.468, {
        "addr:city": "Sheffield",
        "addr:postcode": "S1 2HH",
      }),
    ]);

    expect(index.source).toBe("OpenStreetMap via Overpass API");
    expect(index.license).toBe("ODbL 1.0");
    expect(index.basis).toContain("pub address locality tags");
    expect(index.places).toEqual(
      expect.arrayContaining([
        ["Kelham Island", 53.381, -1.47, "suburb", "S"],
        ["Sheffield", 53.381, -1.47, "city", "S"],
      ]),
    );
    expect(index.places.flat()).not.toContain(2);
  });

  it("keeps geographically separate places with the same name separate", () => {
    const index = buildUkPlaceIndex([
      node(1, 52.1, -1.1, { "addr:village": "Newton", "addr:postcode": "CV1 1AA" }),
      node(2, 52.11, -1.09, { "addr:village": "Newton", "addr:postcode": "CV1 2BB" }),
      node(3, 56.4, -5.4, { "addr:village": "Newton", "addr:postcode": "PA1 1AA" }),
    ]);
    const newtons = index.places.filter((place: unknown[]) => place[0] === "Newton");

    expect(newtons).toHaveLength(2);
    expect(newtons.map((place: unknown[]) => place[4])).toEqual(["CV", "PA"]);
    expect(newtons[0]?.[1]).toBeLessThan(53);
    expect(newtons[1]?.[1]).toBeGreaterThan(56);
  });

  it("refuses tag noise that is not a place name", () => {
    const index = buildUkPlaceIndex([
      node(1, 54.96, -1.6, { "addr:place": "<different>" }),
      node(2, 51.07, 1.08, { "addr:town": "Hythe;West Hythe" }),
      node(3, 52.7, -1.2, { "addr:town": "- Loughborough" }),
      node(4, 52.12, 0.03, { "addr:city": "retail" }),
      node(5, 51.5, -0.9, { "addr:suburb": "Industrial" }),
      node(6, 53.38, -1.47, { "addr:city": "Sheffield" }),
    ]);

    expect(index.places.map((place: unknown[]) => place[0])).toEqual(["Sheffield"]);
  });

  it("capitalises a miscased town rather than dropping a genuine place", () => {
    const index = buildUkPlaceIndex([
      node(1, 55.78, -4.09, { "addr:city": "blantyre", "addr:postcode": "G72 9AA" }),
    ]);

    expect(index.places).toEqual([["Blantyre", 55.78, -4.09, "city", "G"]]);
  });

  it("ignores blank locality tags and elements without usable coordinates", () => {
    const index = buildUkPlaceIndex([
      node(1, 53.38, -1.47, { "addr:city": " " }),
      { type: "way", id: 2, tags: { amenity: "pub", "addr:town": "Nowhere" } },
      node(3, Number.NaN, -1.47, { "addr:city": "Broken" }),
    ]);

    expect(index.places).toEqual([]);
  });
});
