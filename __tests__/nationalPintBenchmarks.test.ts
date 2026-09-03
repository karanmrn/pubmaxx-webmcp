// A NATIONAL FIGURE MAY NEVER BE PRESENTED AS ONE OF OUR OWN OBSERVATIONS.
//
// The Pint Index earns its name by publishing only prices we hold evidence for:
// a public source, a day, a borough. The national yardstick block sits on the
// same page and is made of numbers other people measured. That is the whole
// value of it and also the whole risk: one seam and a UK cask-ale average is
// being cited as a London pub's pint.
//
// So the separation is a fence, not a convention, in four parts:
//
//   1. CITATION - every shipped row names a publisher, links a public https
//      source, carries a real past day, and states WHAT was measured.
//   2. SHAPE    - no row carries a field a price merge reads (venueId,
//      pricePence, observedAt, boroughCode, cheapestPrice...), so nothing can
//      pick one up by duck typing.
//   3. IMPORTS  - the module is reached by the Pint Index block and nothing
//      else. No current-price module, and no dated edition, may read it.
//   4. PRESENTATION - the page prints the publisher, the day and the measure
//      beside every national figure, and never lets one into the Index's own
//      stat tiles, league table, CSV or Dataset structured data.
//
// Part 3 is the one that rots quietly, so it is asserted against the real
// source tree rather than a hand-kept list of suspects.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  citableNationalBenchmarks,
  formatPublishedDay,
  isPublishedDay,
  isValidNationalPintBenchmark,
  nationalPintArc,
  NATIONAL_PINT_BENCHMARKS,
  type NationalPintBenchmark,
} from "@/lib/nationalPintBenchmarks";
import {
  buildLeagueTable,
  dearestFirst,
  LEAGUE_CSV_HEADER,
  validatePintIndexSnapshot,
} from "@/lib/pintIndex";

const ROOT = resolve(__dirname, "..");

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSource(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_DIRS = ["app", "components", "lib", "scripts"].map((d) => join(ROOT, d));
const sourceFiles = SOURCE_DIRS.flatMap((d) => walkSource(d));

const shipped = citableNationalBenchmarks(NATIONAL_PINT_BENCHMARKS);

describe("national yardstick: citation", () => {
  it("ships every curated row, so nothing is silently dropped", () => {
    // A row this filter drops is a figure a reader would never see, and a
    // silent drop is how a curated set rots.
    expect(shipped.length).toBe(NATIONAL_PINT_BENCHMARKS.length);
    expect(shipped.length).toBeGreaterThanOrEqual(2);
    expect(new Set(shipped.map((row) => row.id)).size).toBe(shipped.length);
  });

  it("names a publisher, a public link and a past day on every row", () => {
    const now = Date.now();
    for (const row of shipped) {
      expect(isValidNationalPintBenchmark(row, now)).toBe(true);
      expect(row.sourceUrl.startsWith("https://")).toBe(true);
      expect(row.publisher.trim().length).toBeGreaterThan(0);
      expect(Date.parse(`${row.publishedOn}T00:00:00.000Z`)).toBeLessThanOrEqual(now);
    }
  });

  it("states what was measured on every row, and never just 'a pint'", () => {
    // The honesty rule that costs the most to break: a national cask-ale
    // average and a London pint are different measurements, so the drink and
    // the geography have to be on screen, not in a footnote.
    for (const row of shipped) {
      expect(row.measure.toLowerCase()).toMatch(/pint|ale|lager|beer/);
      expect(row.measure.toLowerCase()).toContain("uk-wide");
      expect(row.method.trim().length).toBeGreaterThan(0);
    }
  });

  it("holds prices in pint range", () => {
    for (const row of shipped) {
      for (const figure of row.figures) {
        expect(figure.priceGbp).toBeGreaterThan(0.5);
        expect(figure.priceGbp).toBeLessThan(15);
        expect(figure.period.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("builds a then-and-now line from one publisher and one series only", () => {
    // Two figures in a row are a comparison. A comparison across two different
    // surveys is not one, so a row owns both ends or it owns neither: the type
    // carries a single publisher, source and measure for the pair.
    const arcs = shipped.filter((row) => row.figures.length === 2);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    for (const row of arcs) {
      const arc = nationalPintArc(row)!;
      expect(arc.then.year).toBeLessThan(arc.latest.year);
      expect(arc.years).toBe(arc.latest.year - arc.then.year);
      expect(arc.deltaGbp).toBeCloseTo(arc.latest.priceGbp - arc.then.priceGbp, 2);
    }
  });
});

describe("national yardstick: the shape fence", () => {
  it("exposes nothing a price merge or the Index could mistake for our own", () => {
    for (const row of shipped) {
      for (const forbidden of [
        "venueId", "venueName", "pricePence", "observedAt", "observedOn",
        "boroughCode", "boroughName", "cheapestPrice", "priceBand", "sourceId",
      ]) {
        expect(row, `${row.id} must not carry ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });

  it("cannot be validated as a Pint Index snapshot", () => {
    // The blunt version of the rule: hand the Index this data and it refuses.
    const result = validatePintIndexSnapshot({
      schemaVersion: 1,
      snapshotId: "national",
      status: "published",
      generatedAt: "2026-07-27T00:00:00.000Z",
      observationWindow: { start: "1990-01-01T00:00:00.000Z", end: "2026-07-27T00:00:00.000Z" },
      classification: {},
      sources: shipped.map((row) => ({ id: row.id, publisher: row.publisher, sourceUrl: row.sourceUrl, licence: null, kind: "national" })),
      observations: shipped.map((row) => ({ ...row, pricePence: Math.round(row.figures[0].priceGbp * 100) })),
      excluded: [],
    });
    expect(result.ok).toBe(false);
  });

  it("keeps national figures out of the Index CSV", () => {
    // The CSV is the citable artifact. It carries borough columns only, so a
    // national row has nowhere to hide in it.
    expect(LEAGUE_CSV_HEADER).not.toContain("national_average_gbp");
    for (const column of LEAGUE_CSV_HEADER) {
      expect(column.startsWith("national")).toBe(false);
    }
  });
});

describe("national yardstick: the import fence", () => {
  const ALLOWED = new Set([
    "components/pintindex/NationalPintBenchmarks.tsx",
    "app/pint-index/page.tsx",
  ]);

  it("is reached by the Pint Index block and nothing else", () => {
    const importers = sourceFiles
      .filter((file) => /from\s+["']@\/lib\/nationalPintBenchmarks["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(new Set(importers)).toEqual(ALLOWED);
  });

  it("is not reached by any module that answers what a pub charges", () => {
    const CURRENT_PRICE_MODULES = [
      "components/map/canvas/geojson.ts",
      "components/map/canvas/buildScene.ts",
      "components/map/canvas/filters.ts",
      "components/map/communityPriceSignals.ts",
      "lib/venues.ts",
      "lib/priceUpdates.ts",
      "lib/drinkPriceUpdates.ts",
      "lib/communityPrice.ts",
      "lib/venuePriceIndex.ts",
      "lib/mapPriceLegend.ts",
      "lib/pintIndex.ts",
      "lib/pintIndexArchive.ts",
      "lib/pintIndexSnapshot.server.ts",
      "lib/zonePintIndex.server.ts",
      "lib/freshness.ts",
    ];
    for (const modulePath of CURRENT_PRICE_MODULES) {
      let source: string;
      try {
        source = readFileSync(join(ROOT, modulePath), "utf8");
      } catch {
        continue; // a module that no longer exists cannot import anything
      }
      expect(source, `${modulePath} must not read national benchmarks`).not.toMatch(/nationalPintBenchmarks/);
    }
  });

  it("stays off every dated edition, whose figures are promised not to move", () => {
    // An edition is frozen the day it is published. A live national average
    // printed on it would move under the reader, which is the one thing that
    // page swears it will not do.
    for (const file of ["app/pint-index/[month]/page.tsx", "app/pint-index/[month]/data.csv/route.ts"]) {
      expect(readFileSync(join(ROOT, file), "utf8")).not.toMatch(/nationalPintBenchmarks|NationalPintBenchmarks/);
    }
  });

  it("is absent from the published editions and the live snapshot on disk", () => {
    const files = [
      join(ROOT, "public/data/pint_index_snapshot.json"),
      ...readdirSync(join(ROOT, "public/data/pint_index"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => join(ROOT, "public/data/pint_index", f)),
    ];
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      for (const row of shipped) {
        expect(raw, `${file} must not cite a national source`).not.toContain(row.sourceUrl);
      }
    }
  });
});

describe("national yardstick: the presentation fence", () => {
  const page = readFileSync(join(ROOT, "app/pint-index/page.tsx"), "utf8");
  const block = readFileSync(join(ROOT, "components/pintindex/NationalPintBenchmarks.tsx"), "utf8");

  it("renders the national figures in their own block, not in the Index stat tiles", () => {
    // The stat tiles are ours: average pint, cheapest borough, dearest borough,
    // eligible pubs. A national figure landing in one would read as a London
    // measurement with no label to say otherwise.
    const tiles = page.slice(page.indexOf("pintIndexStats"), page.indexOf("</dl>"));
    expect(tiles).not.toMatch(/national|NATIONAL/);
  });

  it("keeps national figures out of the Dataset structured data", () => {
    // The JSON-LD is a machine-readable claim about what WE measured.
    const jsonLd = page.slice(page.indexOf("function datasetJsonLd"), page.indexOf("export default"));
    expect(jsonLd).not.toMatch(/national|NATIONAL/);
  });

  it("prints the publisher, the day and the measure beside every figure", () => {
    expect(block).toMatch(/row\.measure/);
    expect(block).toMatch(/row\.publisher/);
    expect(block).toMatch(/formatPublishedDay\(row\.publishedOn\)/);
    expect(block).toMatch(/href=\{row\.sourceUrl\}/);
  });

  it("says on the page that the figures are not ours", () => {
    const dek = page.slice(page.indexOf("nationalHeading"), page.indexOf("zoneHeading"));
    expect(dek).toMatch(/None of these figures are ours/);
  });
});

describe("national yardstick: the module", () => {
  const row: NationalPintBenchmark = {
    id: "test",
    measure: "a draught pint, UK-wide",
    figures: [{ priceGbp: 5, period: "May 2026", year: 2026 }],
    publisher: "A Publisher",
    publishedOn: "2026-05-21",
    sourceUrl: "https://example.com/a",
    method: "its own survey",
  };

  it("drops a row with no publisher, no link, no day or no measure", () => {
    expect(isValidNationalPintBenchmark(row)).toBe(true);
    expect(isValidNationalPintBenchmark({ ...row, publisher: " " })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, measure: "" })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, method: "" })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, sourceUrl: "http://example.com" })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, publishedOn: "2026-5-21" })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, publishedOn: "2026-02-31" })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, figures: [] })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, figures: [{ priceGbp: 0, period: "x", year: 2026 }] })).toBe(false);
    expect(isValidNationalPintBenchmark({ ...row, figures: [{ priceGbp: 5, period: "x", year: 2026 }, { priceGbp: 6, period: "y", year: 2027 }, { priceGbp: 7, period: "z", year: 2028 }] })).toBe(false);
  });

  it("refuses a two-figure row entered newest first", () => {
    // The type says oldest first and the arc trusts it, so a reversed pair
    // would print "Down £3.61 since then." beside a real citation. The guard
    // drops the row rather than letting the page make that claim.
    const reversed = {
      ...row,
      figures: [
        { priceGbp: 4.83, period: "January 2025", year: 2025 },
        { priceGbp: 1.22, period: "1990", year: 1990 },
      ],
    };
    expect(isValidNationalPintBenchmark(reversed)).toBe(false);
    expect(citableNationalBenchmarks([reversed])).toEqual([]);
    expect(isValidNationalPintBenchmark({ ...row, figures: [...reversed.figures].reverse() })).toBe(true);
    // The same year twice is a pair, not a reversal: two figures published for
    // one year stay legal.
    expect(isValidNationalPintBenchmark({
      ...row,
      figures: [
        { priceGbp: 5, period: "January 2026", year: 2026 },
        { priceGbp: 5.2, period: "May 2026", year: 2026 },
      ],
    })).toBe(true);
  });

  it("refuses a publication day in the future", () => {
    const now = Date.parse("2026-07-27T00:00:00.000Z");
    expect(isPublishedDay("2026-07-27", now)).toBe(true);
    expect(isPublishedDay("2026-08-01", now)).toBe(false);
  });

  it("returns no arc for a single figure", () => {
    expect(nationalPintArc(row)).toBeNull();
  });

  it("dates a citation to the day", () => {
    expect(formatPublishedDay("2026-05-21")).toBe("21 May 2026");
    expect(formatPublishedDay("not-a-date")).toBe("not-a-date");
  });
});

describe("the dearest end", () => {
  const observation = (
    venueId: string,
    pubName: string,
    borough: [string, string],
    pricePence: number,
  ) => ({
    venueId, pubName,
    boroughCode: borough[0], boroughName: borough[1],
    pricePence, observedAt: "2026-07-02T00:00:00.000Z", sourceId: "s",
  });
  const HACKNEY: [string, string] = ["hackney", "Hackney"];
  const CAMDEN: [string, string] = ["camden", "Camden"];
  const rows = buildLeagueTable({
    observations: [
      observation("a", "Cheap A", HACKNEY, 500),
      observation("b", "Dear B", HACKNEY, 700),
      // Camden averages lower than Hackney and its dearest pint is cheaper too,
      // so the two orderings come out reversed. That disagreement is the whole
      // reason the second view exists.
      observation("c", "Cheap C", CAMDEN, 300),
      observation("d", "Dear D", CAMDEN, 600),
    ],
  } as never);

  it("names the pub behind the dearest figure, the way the cheapest one does", () => {
    const hackney = rows.find((row) => row.slug === "hackney")!;
    expect(hackney.minPubName).toBe("Cheap A");
    expect(hackney.maxPubName).toBe("Dear B");
    expect(hackney.maxGbp).toBe(7);
  });

  it("leaves cheapest-first as the default and ranks the other view on the dearest pint", () => {
    expect(rows.map((row) => row.name)).toEqual(["Camden", "Hackney"]);
    expect(dearestFirst(rows).map((row) => row.name)).toEqual(["Hackney", "Camden"]);
    expect(dearestFirst(rows).map((row) => row.maxGbp)).toEqual([7, 6]);
    // The default array is not mutated by reading it the other way round.
    expect(rows.map((row) => row.name)).toEqual(["Camden", "Hackney"]);
    expect(rows.map((row) => row.averageGbp)).toEqual([4.5, 6]);
  });

  it("carries the dearest pub into the citable CSV", () => {
    expect(LEAGUE_CSV_HEADER.indexOf("dearest_pint_pub")).toBe(
      LEAGUE_CSV_HEADER.indexOf("dearest_pint_gbp") + 1,
    );
  });
});
