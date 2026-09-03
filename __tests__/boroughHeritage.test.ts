import { describe, expect, it } from "vitest";

import type { HistoricPub } from "@/lib/historic";
import {
  allBoroughHeritageCounts,
  boroughHeritageForSlug,
} from "@/lib/boroughHeritage";

// Minimal factory — only the fields the rollup reads. Mirrors the fixture in
// historicFilter.test.ts so both suites share the same tiny record shape.
function pub(over: Partial<HistoricPub>): HistoricPub {
  return {
    venueId: "venue-x",
    name: "A Pub",
    slug: "a-pub",
    borough: null,
    lat: null,
    lng: null,
    hook: "A cited sentence.",
    facts: [],
    era: null,
    listed: null,
    sourced: true,
    ...over,
  };
}

// Two boroughs plus a borough-less record. Southwark: a dated 1520 pub, an
// undated listed pub, an undated ungraded pub. Camden: two dated pubs
// (year vs century) and one undated. "City of London" exercises the slug that
// isn't a straight de-kebab of the display name.
const SAMPLE: HistoricPub[] = [
  pub({ name: "Old Tavern", slug: "old-tavern", borough: "Southwark", era: "1520", listed: "II*" }),
  pub({ name: "Listed Only", slug: "listed-only", borough: "Southwark", era: null, listed: "II" }),
  pub({ name: "Plain Bar", slug: "plain-bar", borough: "Southwark", era: null, listed: null }),
  pub({ name: "Century House", slug: "century-house", borough: "Camden", era: "17th century", listed: "II" }),
  pub({ name: "Early Inn", slug: "early-inn", borough: "Camden", era: "1667", listed: null }),
  pub({ name: "Dateless Arms", slug: "dateless-arms", borough: "Camden", era: null, listed: "II" }),
  pub({ name: "The Old Bell", slug: "the-old-bell", borough: "City of London", era: "1670", listed: "II*" }),
  pub({ name: "Ghost Pub", slug: "ghost-pub", borough: null, era: "1600", listed: "I" }),
];

describe("boroughHeritageForSlug — matching + counts", () => {
  it("matches pubs by slugifyBorough(pub.borough) === slug", () => {
    const out = boroughHeritageForSlug("southwark", SAMPLE);
    expect(out).not.toBeNull();
    expect(out!.borough).toBe("Southwark");
    expect(out!.slug).toBe("southwark");
    expect(out!.count).toBe(3);
  });

  it("accepts the URL slug form for multi-word boroughs", () => {
    const out = boroughHeritageForSlug("city-of-london", SAMPLE);
    expect(out).not.toBeNull();
    expect(out!.borough).toBe("City of London");
    expect(out!.slug).toBe("city-of-london");
    expect(out!.count).toBe(1);
  });

  it("counts listed grades independently of count", () => {
    // Southwark: Old Tavern (II*) + Listed Only (II) are graded; Plain Bar isn't.
    const out = boroughHeritageForSlug("southwark", SAMPLE)!;
    expect(out.count).toBe(3);
    expect(out.listedCount).toBe(2);

    // Camden: only Century House + Dateless Arms carry a grade.
    const camden = boroughHeritageForSlug("camden", SAMPLE)!;
    expect(camden.count).toBe(3);
    expect(camden.listedCount).toBe(2);
  });

  it("skips null-borough pubs and returns null for an unmatched slug", () => {
    // Ghost Pub has a null borough → never matched by any slug.
    expect(boroughHeritageForSlug("", SAMPLE)).toBeNull();
    expect(boroughHeritageForSlug("nowhere-on-thames", SAMPLE)).toBeNull();
  });
});

describe("boroughHeritageForSlug — oldest", () => {
  it("picks the earliest era: a specific year beats a later century", () => {
    // Camden: 1667 (Early Inn) precedes "17th century" (1600 opening)? No —
    // eraStartYear("17th century") = 1600 < 1667, so Century House is older.
    const camden = boroughHeritageForSlug("camden", SAMPLE)!;
    expect(camden.oldest?.slug).toBe("century-house");
  });

  it("picks the dated pub even when undated pubs share the borough", () => {
    const southwark = boroughHeritageForSlug("southwark", SAMPLE)!;
    expect(southwark.oldest?.slug).toBe("old-tavern"); // 1520
  });

  it("is null when no pub in the borough carries an era", () => {
    const noEra: HistoricPub[] = [
      pub({ name: "A", slug: "a", borough: "Barnet", era: null, listed: "II" }),
      pub({ name: "B", slug: "b", borough: "Barnet", era: null, listed: null }),
    ];
    const out = boroughHeritageForSlug("barnet", noEra)!;
    expect(out.count).toBe(2);
    expect(out.oldest).toBeNull();
  });
});

describe("boroughHeritageForSlug — notable ordering", () => {
  it("orders dated-first (earliest), then listed (I→II*→II), then the rest", () => {
    const pubs: HistoricPub[] = [
      pub({ name: "Rest B", slug: "rest-b", borough: "X", era: null, listed: null }),
      pub({ name: "Listed II", slug: "listed-ii", borough: "X", era: null, listed: "II" }),
      pub({ name: "Dated Late", slug: "dated-late", borough: "X", era: "1800", listed: null }),
      pub({ name: "Listed One", slug: "listed-one", borough: "X", era: null, listed: "I" }),
      pub({ name: "Dated Early", slug: "dated-early", borough: "X", era: "1500", listed: "II" }),
      pub({ name: "Rest A", slug: "rest-a", borough: "X", era: null, listed: null }),
      pub({ name: "Listed II Star", slug: "listed-ii-star", borough: "X", era: null, listed: "II*" }),
    ];
    const out = boroughHeritageForSlug("x", pubs)!;
    expect(out.notable.map((p) => p.slug)).toEqual([
      "dated-early", // era 1500
      "dated-late", // era 1800
      "listed-one", // Grade I
      "listed-ii-star", // Grade II*
      "listed-ii", // Grade II
      "rest-a", // undated, ungraded — name tiebreak A before B
    ]);
  });

  it("breaks ties within a tier by name (A–Z)", () => {
    const pubs: HistoricPub[] = [
      pub({ name: "Zulu Arms", slug: "zulu", borough: "X", era: "1700", listed: null }),
      pub({ name: "Alpha Arms", slug: "alpha", borough: "X", era: "1700", listed: null }),
    ];
    const out = boroughHeritageForSlug("x", pubs)!;
    expect(out.notable.map((p) => p.slug)).toEqual(["alpha", "zulu"]);
  });

  it("caps the shortlist at 6", () => {
    const pubs: HistoricPub[] = Array.from({ length: 9 }, (_, i) =>
      pub({
        name: `Pub ${String(i).padStart(2, "0")}`,
        slug: `pub-${i}`,
        borough: "X",
        era: `${1500 + i}`,
      }),
    );
    const out = boroughHeritageForSlug("x", pubs)!;
    expect(out.notable).toHaveLength(6);
    // First six by era ascending (1500..1505).
    expect(out.notable.map((p) => p.slug)).toEqual([
      "pub-0",
      "pub-1",
      "pub-2",
      "pub-3",
      "pub-4",
      "pub-5",
    ]);
  });
});

describe("allBoroughHeritageCounts", () => {
  it("returns one row per borough, count desc then borough name", () => {
    const rows = allBoroughHeritageCounts(SAMPLE);
    expect(rows).toEqual([
      { slug: "camden", borough: "Camden", count: 3 },
      { slug: "southwark", borough: "Southwark", count: 3 },
      { slug: "city-of-london", borough: "City of London", count: 1 },
    ]);
    // Camden and Southwark tie at 3 → alphabetical: Camden before Southwark.
  });

  it("drops null-borough pubs", () => {
    // Ghost Pub (null borough) contributes no row and inflates no count.
    const rows = allBoroughHeritageCounts(SAMPLE);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(7);
    expect(rows.some((r) => r.borough == null)).toBe(false);
  });
});
