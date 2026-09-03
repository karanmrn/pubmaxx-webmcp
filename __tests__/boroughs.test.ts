import { describe, it, expect } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  canonicalBorough,
  LONDON_BOROUGHS,
  slugifyBorough,
  boroughFromSlug,
  listBoroughs,
  pubsInBorough,
} from "@/lib/boroughs";
import type { Venue } from "@/lib/venues";

// The borough helpers only read name/cheapestPrice/primaryBorough/
// visibleBoroughs (via leaderboard.venueArea), so a partial cast keeps the
// fixtures readable without spelling out every Venue field.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  return { primaryBorough: "", visibleBoroughs: [], cheapestPint: "", ...over } as Venue;
}

describe("slugifyBorough", () => {
  it("kebab-cases a plain borough name", () => {
    expect(slugifyBorough("Camden")).toBe("camden");
    expect(slugifyBorough("City of London")).toBe("city-of-london");
  });

  it("expands & and collapses punctuation/whitespace", () => {
    expect(slugifyBorough("Kensington & Chelsea")).toBe("kensington-and-chelsea");
    expect(slugifyBorough("  Tower   Hamlets  ")).toBe("tower-hamlets");
  });

  it("returns an empty string for empty/symbol-only input", () => {
    expect(slugifyBorough("")).toBe("");
    expect(slugifyBorough("   ")).toBe("");
    expect(slugifyBorough("---")).toBe("");
    expect(slugifyBorough("!@#")).toBe("");
  });
});

describe("slugifyBorough / boroughFromSlug round-trip", () => {
  const venues = [
    v({ id: "1", name: "A", cheapestPrice: 5, primaryBorough: "Camden" }),
    v({ id: "2", name: "B", cheapestPrice: 6, primaryBorough: "City of London" }),
    v({ id: "3", name: "C", cheapestPrice: 4, primaryBorough: "Kensington & Chelsea" }),
  ];

  it("reverses a slug back to the canonical borough name", () => {
    for (const borough of ["Camden", "City of London"]) {
      expect(boroughFromSlug(slugifyBorough(borough), venues)).toBe(borough);
    }
    // Dataset spellings normalise to the canonical LONDON_BOROUGHS name:
    // "Kensington & Chelsea" renders as "Kensington and Chelsea".
    expect(boroughFromSlug(slugifyBorough("Kensington & Chelsea"), venues)).toBe(
      "Kensington and Chelsea",
    );
  });

  it("is case-insensitive on the incoming slug", () => {
    expect(boroughFromSlug("CAMDEN", venues)).toBe("Camden");
    expect(boroughFromSlug("city-of-london", venues)).toBe("City of London");
  });

  it("returns null for a slug no borough produces (drives notFound)", () => {
    expect(boroughFromSlug("narnia", venues)).toBeNull();
    expect(boroughFromSlug("", venues)).toBeNull();
  });
});

describe("listBoroughs", () => {
  const venues = [
    v({ id: "1", name: "Camden Cheap", cheapestPrice: 4.5, primaryBorough: "Camden" }),
    v({ id: "2", name: "Camden Mid", cheapestPrice: 6, primaryBorough: "Camden" }),
    v({ id: "3", name: "Camden Pricey", cheapestPrice: 8, primaryBorough: "Camden" }),
    v({ id: "4", name: "Soho One", cheapestPrice: 7, primaryBorough: "Westminster" }),
    v({ id: "5", name: "Soho Two", cheapestPrice: null, primaryBorough: "Westminster" }),
  ];

  it("counts pubs per borough and finds the cheapest pint", () => {
    const list = listBoroughs(venues);
    const camden = list.find((b) => b.slug === "camden");
    const westminster = list.find((b) => b.slug === "westminster");
    expect(camden).toMatchObject({ name: "Camden", pubCount: 3, cheapestGbp: 4.5 });
    expect(westminster).toMatchObject({ name: "Westminster", pubCount: 2, cheapestGbp: 7 });
  });

  it("sorts by pubCount descending, ties broken on name", () => {
    expect(listBoroughs(venues).map((b) => b.slug)).toEqual(["camden", "westminster"]);
  });

  it("keeps cheapestGbp null when a borough has no priced pub", () => {
    const noPrice = [v({ id: "x", name: "Ghost", cheapestPrice: null, primaryBorough: "Barnet" })];
    expect(listBoroughs(noPrice)[0]).toMatchObject({
      slug: "barnet",
      pubCount: 1,
      cheapestGbp: null,
    });
  });

  it("dedupes boroughs case-insensitively by slug", () => {
    const dup = [
      v({ id: "1", name: "One", cheapestPrice: 5, primaryBorough: "Camden" }),
      v({ id: "2", name: "Two", cheapestPrice: 6, primaryBorough: "camden" }),
    ];
    const list = listBoroughs(dup);
    expect(list).toHaveLength(1);
    expect(list[0].pubCount).toBe(2);
  });
});

describe("pubsInBorough", () => {
  const venues = [
    v({ id: "1", name: "Zeta", cheapestPrice: 6, primaryBorough: "Camden" }),
    v({ id: "2", name: "Alpha", cheapestPrice: 4, primaryBorough: "Camden" }),
    v({ id: "3", name: "NoPrice", cheapestPrice: null, primaryBorough: "Camden" }),
    v({ id: "4", name: "Elsewhere", cheapestPrice: 3, primaryBorough: "Hackney" }),
  ];

  it("returns only that borough's pubs, cheapest-first", () => {
    const pubs = pubsInBorough(venues, "camden");
    expect(pubs.map((p) => p.id)).toEqual(["2", "1", "3"]);
    // the Hackney pub is never included
    expect(pubs.some((p) => p.id === "4")).toBe(false);
  });

  it("pushes unpriced pubs to the end, name-sorted", () => {
    const withTwoUnpriced = [
      v({ id: "a", name: "Yeti", cheapestPrice: null, primaryBorough: "Camden" }),
      v({ id: "b", name: "Cheap", cheapestPrice: 4, primaryBorough: "Camden" }),
      v({ id: "c", name: "Aardvark", cheapestPrice: null, primaryBorough: "Camden" }),
    ];
    expect(pubsInBorough(withTwoUnpriced, "camden").map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("accepts the URL slug form and matches through slugifyBorough", () => {
    const kc = [
      v({ id: "1", name: "Pub", cheapestPrice: 5, primaryBorough: "Kensington & Chelsea" }),
    ];
    expect(pubsInBorough(kc, "kensington-and-chelsea").map((p) => p.id)).toEqual(["1"]);
  });

  it("returns [] for an unknown or empty slug (never crashes)", () => {
    expect(pubsInBorough(venues, "narnia")).toEqual([]);
    expect(pubsInBorough(venues, "")).toEqual([]);
    expect(pubsInBorough([], "camden")).toEqual([]);
  });
});

describe("LONDON_BOROUGHS canonical list (SEO integrity)", () => {
  it("matches the point-in-polygon GeoJSON source exactly", () => {
    const geo = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "data", "london_boroughs_simplified.json"),
        "utf8",
      ),
    ) as { features: { properties: { name: string } }[] };
    const geoNames = geo.features.map((f) => f.properties.name).sort();
    expect([...LONDON_BOROUGHS].sort()).toEqual(geoNames);
    expect(LONDON_BOROUGHS).toHaveLength(33);
  });
});

describe("canonicalBorough (SEO integrity)", () => {
  it("accepts real boroughs and normalises ceremonial prefixes", () => {
    expect(canonicalBorough(v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: "Camden" }))).toBe("Camden");
    expect(canonicalBorough(v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: "Royal Borough of Greenwich" }))).toBe(
      "Greenwich",
    );
    expect(canonicalBorough(v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: "London Borough of Hackney" }))).toBe(
      "Hackney",
    );
    expect(canonicalBorough(v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: "Kensington & Chelsea" }))).toBe(
      "Kensington and Chelsea",
    );
  });

  it("rejects neighbourhoods and junk — Soho is not a borough", () => {
    for (const notABorough of ["Soho", "Mayfair", "Victoria", "Covent Garden", "London", ""]) {
      expect(canonicalBorough(v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: notABorough }))).toBeNull();
    }
  });

  it("never falls back to visibleBoroughs", () => {
    const venue = v({ id: "t", name: "T", cheapestPrice: null, primaryBorough: "", visibleBoroughs: ["Westminster"] });
    expect(canonicalBorough(venue)).toBeNull();
  });

  it("keeps non-borough venues out of listings and borough pages", () => {
    const venues = [
      v({ id: "1", name: "Real", cheapestPrice: 5, primaryBorough: "Camden" }),
      v({ id: "2", name: "SohoPub", cheapestPrice: 4, primaryBorough: "Soho" }),
    ];
    expect(listBoroughs(venues).map((b) => b.name)).toEqual(["Camden"]);
    expect(pubsInBorough(venues, "soho")).toEqual([]);
  });
});
