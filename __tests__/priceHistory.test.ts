// A HISTORICAL PRICE IS HISTORY. IT MAY NEVER ANSWER "WHAT DOES A PINT COST HERE NOW".
//
// public/data/price_history/london.json holds dated, sourced prices from years
// gone by: what a pint at a pub cost in 2013, cited to an archived page. That
// figure is the most emotionally loaded number on the product, and it is also
// the easiest one to get wrong: let it leak one seam and a 2013 price paints a
// pin, wins a cheapest-pint bucket, or lands in the Pint Index as this month's
// evidence.
//
// So the separation is a fence, not a convention, and it has three parts:
//
//   1. IDENTITY  — every row names a venue the app actually ships, carries a
//      real past day, an http(s) source, and a price in pint range.
//   2. IMPORTS   — lib/priceHistory.ts and its loader are imported by the venue
//      sheet block and nothing else. No current-price module may reach them.
//   3. DATA      — no historical figure is written into any current-price feed,
//      and the freshness registry does not carry this file as a price feed.
//
// Part 2 is the one that rots quietly, so it is asserted against the real source
// tree rather than a hand-kept list of suspects.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import registry from "@/data/freshness_registry.json";
import {
  formatObservedDay,
  formatObservedMonth,
  groupPriceHistoryByVenue,
  isValidObservedOn,
  isValidPriceHistoryObservation,
  parsePriceHistory,
  venuePriceArc,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

const ROOT = resolve(__dirname, "..");
const HISTORY_FILE = join(ROOT, "public/data/price_history/london.json");

const shipped = parsePriceHistory(
  JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as unknown,
);
const rawShipped = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as {
  version: number;
  observations: unknown[];
};

function slimVenueIds(): Set<string> {
  const dir = join(ROOT, "public/data");
  const ids = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!/^venues_slim\.(?!manifest)/.test(file) && file !== "venues_slim.json") continue;
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    const rows = rowsFromSlimPayload(parsed) ?? [];
    for (const venue of rows as Array<{ id?: unknown }>) {
      if (typeof venue.id === "string") ids.add(venue.id);
    }
  }
  return ids;
}

function slimVenuesWithCurrentPrice(): Set<string> {
  const dir = join(ROOT, "public/data");
  const ids = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (!/^venues_slim\.(?!manifest)/.test(file) && file !== "venues_slim.json") continue;
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    const rows = rowsFromSlimPayload(parsed) ?? [];
    for (const venue of rows as Array<{ id?: unknown; cheapestPrice?: unknown }>) {
      if (typeof venue.id === "string" && typeof venue.cheapestPrice === "number") ids.add(venue.id);
    }
  }
  return ids;
}

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

describe("price archaeology: identity", () => {
  it("ships a usable, non-trivial set", () => {
    expect(rawShipped.version).toBe(1);
    // Every raw row survives parsing: a row this file drops is a row a reader
    // would never see, and a silent drop is how a set rots.
    expect(shipped.length).toBe(rawShipped.observations.length);
    expect(shipped.length).toBeGreaterThanOrEqual(60);
    expect(new Set(shipped.map((o) => o.venueId)).size).toBeGreaterThanOrEqual(60);
  });

  it("is described by a README that counts the shipped file", () => {
    // The yield figures are the argument for continuing this stream, so a
    // reader has to be able to trust them. They drifted once already, when two
    // rows were dropped in review after the numbers had been written down, so
    // the prose is checked against the data rather than against memory.
    const readme = readFileSync(join(ROOT, "public/data/price_history/README.md"), "utf8");
    const venueIds = new Set(shipped.map((o) => o.venueId));
    const priced = slimVenuesWithCurrentPrice();
    const withCurrentPrice = [...venueIds].filter((id) => priced.has(id)).length;
    const years = shipped.map((o) => o.observedOn.slice(0, 4)).sort();

    expect(readme).toContain(
      `**${shipped.length} observations across ${venueIds.size} venues, ${years[0]} to ${years[years.length - 1]}**`,
    );
    expect(readme).toContain(`**${withCurrentPrice} of those\n  venues also carry a current price**`);
    expect(readme).toContain(`${venueIds.size} produced usable evidence`);
  });

  it("names venues the app actually ships", () => {
    const ids = slimVenueIds();
    const strangers = [...new Set(shipped.map((o) => o.venueId))].filter((id) => !ids.has(id));
    expect(strangers).toEqual([]);
  });

  it("carries a source URL and a past day on every row", () => {
    const now = Date.now();
    for (const row of shipped) {
      expect(isValidPriceHistoryObservation(row, now)).toBe(true);
      expect(row.source.url.startsWith("https://")).toBe(true);
      expect(row.source.label.length).toBeGreaterThan(0);
      expect(row.source.licence.length).toBeGreaterThan(0);
      expect(Date.parse(`${row.observedOn}T00:00:00.000Z`)).toBeLessThan(now);
    }
  });

  it("holds prices in pint range, and none of them is today's", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const row of shipped) {
      expect(row.priceGbp).toBeGreaterThan(0.5);
      expect(row.priceGbp).toBeLessThan(15);
      expect(row.observedOn < today).toBe(true);
    }
  });

  it("holds at most one figure per venue per day", () => {
    const seen = new Set<string>();
    for (const row of shipped) {
      const key = `${row.venueId}|${row.observedOn}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("attributes one archived page to one pub", () => {
    // The inverse of the rule above, and the one an import gets wrong quietly:
    // a source page is evidence about ONE pub, so citing it for two venue ids
    // ships the same dated fact twice and inflates the set. The only accepted
    // exceptions are venue ids the app's own index holds twice for a single
    // pub, where both records can legitimately show the same history.
    const DUPLICATE_INDEX_RECORDS: Array<{ reason: string; venueIds: string[] }> = [
      {
        reason: "Horniman at Hays: three index records for the one Hay's Galleria pub.",
        venueIds: ["venue-2txloa", "venue-7qifhm", "venue-aihlwx"],
      },
      {
        reason: "Eastbrook, Dagenham: two index records, 'Eastbrook' and 'The Eastbrook'.",
        venueIds: ["venue-16nj2fe", "venue-cn9acj"],
      },
    ];
    const byUrl = new Map<string, Set<string>>();
    for (const row of shipped) {
      const ids = byUrl.get(row.source.url) ?? new Set<string>();
      ids.add(row.venueId);
      byUrl.set(row.source.url, ids);
    }
    for (const [url, ids] of byUrl) {
      if (ids.size === 1) continue;
      const allowed = DUPLICATE_INDEX_RECORDS.find((entry) =>
        [...ids].every((id) => entry.venueIds.includes(id)),
      );
      expect(
        allowed,
        `${url} is cited for ${[...ids].sort().join(", ")}: one archived page is evidence about one pub, so either the identity is wrong or these ids are a documented duplicate index record`,
      ).toBeTruthy();
    }
  });
});

describe("price archaeology: the venue-sheet gate", () => {
  const overviewTab = readFileSync(
    join(ROOT, "components/map/inspector/VenueOverviewTab.tsx"),
    "utf8",
  );

  it("withholds 'now' from a venue whose current price is not a pint", () => {
    // A bar or food venue's cheapestPrice is an anchor price: a cocktail, a
    // doner, a signature dish. Setting an old PINT against it would read as a
    // pint-to-pint comparison and be a lie in the one place this feature is
    // supposed to be evidence. Every shipped history venue happens to be a pub
    // today, so nothing in the data exercises this branch: it is the source
    // that has to hold it.
    const start = overviewTab.indexOf("<VenuePriceThen");
    expect(start, "VenueOverviewTab must render the then-and-now block").toBeGreaterThan(-1);
    const element = overviewTab.slice(start, overviewTab.indexOf("/>", start) + 2);
    expect(element).toMatch(/currentPriceGbp=\{[\s\S]*isPubVenue\(venue\)[\s\S]*:\s*null[\s\S]*\}/);
  });

  it("renders only the historical line when there is no price to compare against", () => {
    // History with no current price still ships: the dated fact stands alone
    // and the block degrades to that one sentence rather than disappearing.
    const arc = venuePriceArc(
      [
        {
          venueId: "venue-x",
          venueName: "Hand and Shears",
          priceGbp: 4,
          observedOn: "2013-04-17",
          source: { label: "beerintheevening.com", url: "https://example.com/a", licence: "l" },
        },
      ],
      null,
    );
    expect(arc?.then.priceGbp).toBe(4);
    expect(arc?.nowGbp).toBeNull();
    // No movement line, so no "Up £0.00 in 13 years" against a price we do not have.
    expect(arc?.deltaGbp).toBeNull();
  });
});

describe("price archaeology: the import fence", () => {
  // The only two places allowed to know historical prices exist.
  const ALLOWED = new Set([
    "lib/priceHistory.ts",
    "lib/priceHistoryLoader.ts",
    "components/map/VenuePriceThen.tsx",
  ]);

  it("is reached by the venue-sheet block and nothing else", () => {
    const importers = sourceFiles
      .filter((file) => /from\s+["']@\/lib\/priceHistory(Loader)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(new Set(importers)).toEqual(new Set([...ALLOWED].filter((f) => f !== "lib/priceHistory.ts")));
  });

  it("is not reached by any module that answers a price today", () => {
    // The surfaces the brief names: bands and pin colour, the pin price label,
    // cheapest-pint buckets, the Pint Index, the freshness spine, and every
    // current-price merge.
    const CURRENT_PRICE_MODULES = [
      "components/map/canvas/geojson.ts",
      "components/map/canvas/buildScene.ts",
      "components/map/canvas/filters.ts",
      "components/map/communityPriceSignals.ts",
      "lib/venues.ts",
      "lib/priceUpdates.ts",
      "lib/drinkPriceUpdates.ts",
      "lib/foodPriceUpdates.ts",
      "lib/communityPrice.ts",
      "lib/communityPriceStore.ts",
      "lib/venuePriceIndex.ts",
      "lib/mapPriceLegend.ts",
      "lib/pintIndex.ts",
      "lib/pintIndexArchive.ts",
      "lib/freshness.ts",
    ];
    for (const modulePath of CURRENT_PRICE_MODULES) {
      let source: string;
      try {
        source = readFileSync(join(ROOT, modulePath), "utf8");
      } catch {
        continue; // a module that no longer exists cannot import anything
      }
      expect(source, `${modulePath} must not read historical prices`).not.toMatch(/priceHistory/);
    }
  });

  it("exposes nothing a current-price merge could mistake for today's price", () => {
    // Every row is stamped with a calendar day and a source, and carries no
    // "observedAt"/"priceGbp-now" shape the live merges read.
    for (const row of shipped) {
      expect(Object.keys(row).sort()).toEqual(
        expect.arrayContaining(["observedOn", "priceGbp", "source", "venueId", "venueName"]),
      );
      expect(row).not.toHaveProperty("observedAt");
      expect(row).not.toHaveProperty("cheapestPrice");
      expect(row).not.toHaveProperty("priceBand");
    }
  });
});

describe("price archaeology: the data fence", () => {
  it("is absent from the freshness registry", () => {
    const artifacts = registry.datasets
      .map((d) => (d as { artifact?: unknown }).artifact)
      .filter((a): a is string => typeof a === "string");
    expect(artifacts.some((a) => a.includes("price_history"))).toBe(false);
  });

  it("has not been written into the current-price update feeds", () => {
    const feeds = [
      "public/data/price_updates/latest.json",
      "public/data/drink_price_updates/latest.json",
    ];
    for (const feed of feeds) {
      let raw: string;
      try {
        raw = readFileSync(join(ROOT, feed), "utf8");
      } catch {
        continue;
      }
      for (const row of shipped) {
        expect(raw, `${feed} must not cite a historical source`).not.toContain(row.source.url);
      }
    }
  });

  it("has not been written into the published Pint Index editions", () => {
    const dir = join(ROOT, "public/data/pint_index");
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      files = [];
    }
    for (const file of files) {
      const raw = readFileSync(join(dir, file), "utf8");
      for (const row of shipped) {
        expect(raw, `${file} must not cite a historical source`).not.toContain(row.source.url);
      }
    }
  });
});

describe("price archaeology: the module", () => {
  const row: PriceHistoryObservation = {
    venueId: "venue-abc",
    venueName: "The Test Arms",
    priceGbp: 2.8,
    observedOn: "2009-06-14",
    source: { label: "example.com", url: "https://example.com/a", licence: "Quoted." },
  };

  it("drops a row with no source, no day, or a day that never happened", () => {
    expect(isValidPriceHistoryObservation(row)).toBe(true);
    expect(isValidPriceHistoryObservation({ ...row, source: undefined })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, source: { ...row.source, url: "ftp://x" } })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, observedOn: "2009-6-14" })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, observedOn: "2009-02-31" })).toBe(false);
    expect(isValidPriceHistoryObservation({ ...row, priceGbp: 0 })).toBe(false);
  });

  it("refuses a day in the future", () => {
    const now = Date.parse("2020-01-01T00:00:00.000Z");
    expect(isValidObservedOn("2019-12-31", now)).toBe(true);
    expect(isValidObservedOn("2020-06-01", now)).toBe(false);
  });

  it("parses either a bare array or the file wrapper, dropping bad rows", () => {
    expect(parsePriceHistory([row, { venueId: "x" }])).toHaveLength(1);
    expect(parsePriceHistory({ observations: [row] })).toHaveLength(1);
    expect(parsePriceHistory(null)).toEqual([]);
  });

  it("builds the arc from the oldest row, and never invents a price for today", () => {
    const older = { ...row, observedOn: "2009-06-14", priceGbp: 2.8 };
    const newer = { ...row, observedOn: "2016-01-02", priceGbp: 4.1 };
    const asOf = Date.parse("2026-07-01T00:00:00.000Z");
    const arc = venuePriceArc([newer, older], 6.2, asOf);
    expect(arc?.then.observedOn).toBe("2009-06-14");
    expect(arc?.nowGbp).toBe(6.2);
    expect(arc?.deltaGbp).toBeCloseTo(3.4, 2);
    expect(arc?.years).toBe(17);

    const noCurrent = venuePriceArc([older], null, asOf);
    expect(noCurrent?.nowGbp).toBeNull();
    expect(noCurrent?.deltaGbp).toBeNull();

    expect(venuePriceArc([], 6.2, asOf)).toBeNull();
  });

  it("groups by venue, oldest first", () => {
    const other = { ...row, venueId: "venue-def", observedOn: "2011-01-01" };
    const grouped = groupPriceHistoryByVenue([{ ...row, observedOn: "2014-01-01" }, row, other]);
    expect(grouped.get("venue-abc")?.map((o) => o.observedOn)).toEqual(["2009-06-14", "2014-01-01"]);
    expect(grouped.get("venue-def")).toHaveLength(1);
  });

  it("dates a claim to the month on screen and the day in the citation", () => {
    expect(formatObservedMonth("2013-07-14")).toBe("July 2013");
    expect(formatObservedDay("2013-07-14")).toBe("14 July 2013");
    expect(formatObservedMonth("not-a-date")).toBe("not-a-date");
  });
});
