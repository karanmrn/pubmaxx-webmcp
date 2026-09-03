import { describe, it, expect } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AREA_NEWS_KINDS,
  areaLabel,
  awardForVenue,
  entriesForBorough,
  entriesForNightArea,
  freshAreaNews,
  formatAreaNewsDate,
  isKnownAreaSlug,
  resolveAreaBorough,
  validateAreaNewsEntry,
  type AreaNewsDataset,
  type AreaNewsEntry,
} from "@/lib/areaNews";

// The matcher is a plain .mjs build-lib (no .d.ts), same import pattern as the
// heritage matcher test.
// prettier-ignore
// @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
import { matchVenue, slugifyBorough } from "../scripts/lib/areaNewsMatch.mjs";

import { KNOWN_AREA_SLUGS, parseExtractedFact } from "../scripts/lib/keenableAreaNews.mjs";

const dataset = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "area_news.json"), "utf8"),
) as AreaNewsDataset;

describe("area-news browser/server boundary", () => {
  it("keeps Node built-ins and the dataset loader out of the client-safe module", () => {
    const clientSource = readFileSync(path.join(process.cwd(), "lib", "areaNews.ts"), "utf8");

    expect(clientSource).not.toMatch(/node:(?:fs|path)/);
    expect(clientSource).not.toContain("loadAreaNews");
  });
});

describe("area_news.json dataset shape", () => {
  it("has a version, a generatedAt stamp and a healthy entry count", () => {
    expect(dataset.version).toBe(1);
    expect(typeof dataset.generatedAt).toBe("string");
    expect(new Date(dataset.generatedAt).toString()).not.toBe("Invalid Date");
    // The brief expected roughly 60-100 sourced facts.
    expect(dataset.entries.length).toBeGreaterThanOrEqual(60);
    expect(dataset.entries.length).toBeLessThanOrEqual(120);
  });

  it("every entry passes the schema + house-rule validator", () => {
    const problems = dataset.entries.flatMap((entry) => validateAreaNewsEntry(entry));
    expect(problems).toEqual([]);
  });

  it("keeps current generated rows valid under refresh extraction rules", () => {
    const now = Date.parse(dataset.generatedAt);
    const nowDay = new Date(now);
    nowDay.setUTCHours(0, 0, 0, 0);
    const currentYear = nowDay.getUTCFullYear();
    const oldest = nowDay.getTime() - 21 * 24 * 60 * 60 * 1000;
    const currentRows = dataset.entries.filter((entry) => {
      const observedAt = Date.parse(`${entry.observedAt}T00:00:00Z`);
      return observedAt >= oldest && observedAt <= nowDay.getTime();
    });

    expect(currentRows).not.toHaveLength(0);
    for (const entry of currentRows) {
      expect(
        parseExtractedFact(
          { content: JSON.stringify(entry) },
          { knownAreas: KNOWN_AREA_SLUGS, currentYear, now: nowDay.getTime() },
        ),
      ).toEqual({
        area: entry.area,
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
      });
    }
  });

  it("rejects an https URL without a hostname", () => {
    expect(validateAreaNewsEntry({
      ...dataset.entries[0],
      sourceUrl: "https://",
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("sourceUrl must be an https URL"),
    ]));
  });

  it("has unique ids", () => {
    const ids = dataset.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every area to a real borough", () => {
    for (const entry of dataset.entries) {
      expect(isKnownAreaSlug(entry.area), `area ${entry.area}`).toBe(true);
      expect(resolveAreaBorough(entry.area), `area ${entry.area}`).not.toBeNull();
    }
  });

  it("only carries the allowed kinds", () => {
    for (const entry of dataset.entries) {
      expect(AREA_NEWS_KINDS).toContain(entry.kind);
    }
  });

  it("keeps social-confidence flags to price-sighting texture only", () => {
    for (const entry of dataset.entries) {
      if (entry.confidence !== undefined) expect(entry.confidence).toBe("social");
    }
  });
});

describe("no em dashes in titles or details (anti-slop voice)", () => {
  it("no title or detail contains an em dash or en dash", () => {
    const offenders = dataset.entries
      .filter((entry) => /[—–]/.test(entry.title) || /[—–]/.test(entry.detail))
      .map((entry) => entry.id);
    expect(offenders).toEqual([]);
  });

  it("the raw file text carries no em/en dash at all", () => {
    const raw = readFileSync(path.join(process.cwd(), "data", "area_news.json"), "utf8");
    expect(/[—–]/.test(raw)).toBe(false);
  });
});

describe("venueMatch integrity", () => {
  it("only kind:award matches drive the award badge, by exact id", () => {
    const leyton = dataset.entries.find((e) => e.id === "leyton-engineer-camra-award");
    expect(leyton?.venueMatch?.venueId).toBeTruthy();
    const award = awardForVenue(leyton!.venueMatch!.venueId, dataset.entries);
    expect(award?.id).toBe("leyton-engineer-camra-award");
  });

  it("returns null for an unmatched venue id", () => {
    expect(awardForVenue("venue-does-not-exist", dataset.entries)).toBeNull();
    expect(awardForVenue("", dataset.entries)).toBeNull();
  });

  it("every venueMatch points at a distinct pin (no id shared across facts)", () => {
    const matched = dataset.entries
      .map((e) => e.venueMatch?.venueId)
      .filter((id): id is string => Boolean(id));
    expect(new Set(matched).size).toBe(matched.length);
  });
});

import { GET } from "@/app/api/area-news/route";
import { __resetAreaNewsCache } from "@/lib/areaNews.server";

describe("GET /api/area-news", () => {
  it("returns capped, dated entries for an area", async () => {
    __resetAreaNewsCache();
    const res = await GET(new Request("https://x/api/area-news?area=soho"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AreaNewsEntry[] };
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeLessThanOrEqual(3);
    // newest first
    const dates = body.entries.map((e) => e.observedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("withholds facts older than the 21-day serving window", async () => {
    __resetAreaNewsCache();
    const res = await GET(new Request("https://x/api/area-news?area=soho"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: AreaNewsEntry[] };
    const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(body.entries.every((entry) => entry.observedAt >= cutoff)).toBe(true);
  });

  it("withholds a stale venue-matched award", async () => {
    const leyton = dataset.entries.find((e) => e.id === "leyton-engineer-camra-award");
    const res = await GET(
      new Request(`https://x/api/area-news?venueId=${leyton!.venueMatch!.venueId}`),
    );
    const body = (await res.json()) as { award: AreaNewsEntry | null };
    expect(body.award).toBeNull();

    const none = await GET(new Request("https://x/api/area-news?venueId=venue-nope"));
    expect(((await none.json()) as { award: AreaNewsEntry | null }).award).toBeNull();
  });

  it("400s when neither area nor venueId is given", async () => {
    const res = await GET(new Request("https://x/api/area-news"));
    expect(res.status).toBe(400);
  });
});

const FIXTURES: AreaNewsEntry[] = [
  { id: "a-open", area: "shoreditch", kind: "opening", title: "A opens", detail: "x.", sourceUrl: "https://a.test", sourceName: "a.test", observedAt: "2026-07-10" },
  { id: "b-award", area: "leyton", kind: "award", title: "B wins", detail: "x.", sourceUrl: "https://b.test", sourceName: "b.test", observedAt: "2026-07-12", venueMatch: { venueId: "venue-b", confidence: "high" } },
  { id: "c-buzz", area: "hackney", kind: "buzz", title: "C buzzes", detail: "x.", sourceUrl: "https://c.test", sourceName: "c.test", observedAt: "2026-07-15" },
];

describe("pure resolvers", () => {
  it("keeps only current facts and orders them newest first", () => {
    const now = Date.parse("2026-08-28T12:00:00Z");
    const entries: AreaNewsEntry[] = [
      { ...FIXTURES[0], id: "old", observedAt: "2026-08-06" },
      { ...FIXTURES[1], id: "new", observedAt: "2026-08-27" },
      { ...FIXTURES[2], id: "boundary", observedAt: "2026-08-07" },
      { ...FIXTURES[0], id: "future", observedAt: "2026-08-29" },
    ];

    expect(freshAreaNews(entries, { now }).map((entry) => entry.id)).toEqual([
      "new",
      "boundary",
    ]);
  });

  it("keeps distinct facts from one area and day", () => {
    const entries: AreaNewsEntry[] = [
      { ...FIXTURES[0], id: "same-day-one", observedAt: "2026-08-27", title: "First opening" },
      { ...FIXTURES[0], id: "same-day-two", observedAt: "2026-08-27", title: "Second opening" },
    ];

    expect(freshAreaNews(entries, { now: Date.parse("2026-08-28T12:00:00Z") })).toHaveLength(2);
  });

  it("rejects impossible calendar dates before freshness filtering", () => {
    const invalid = { ...FIXTURES[0], observedAt: "2026-02-31" };
    expect(validateAreaNewsEntry(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining("observedAt must be an ISO date"),
    ]));
    expect(freshAreaNews([invalid], { now: Date.parse("2026-03-10T12:00:00Z") })).toEqual([]);
  });

  it("entriesForBorough joins neighbourhoods into their borough, newest first", () => {
    // shoreditch + hackney both resolve to the Hackney borough.
    const hackney = entriesForBorough("hackney", FIXTURES);
    expect(hackney.map((e) => e.id)).toEqual(["c-buzz", "a-open"]);
    // leyton resolves to Waltham Forest.
    expect(entriesForBorough("waltham-forest", FIXTURES).map((e) => e.id)).toEqual(["b-award"]);
  });

  it("entriesForNightArea pins a neighbourhood to its Night Area", () => {
    expect(entriesForNightArea("shoreditch", FIXTURES).map((e) => e.id)).toEqual(["a-open"]);
    expect(entriesForNightArea("clapham", FIXTURES)).toEqual([]);
  });

  it("areaLabel reads a neighbourhood label or a borough name", () => {
    expect(areaLabel("shoreditch")).toBe("Shoreditch");
    expect(areaLabel("hackney")).toBe("Hackney");
  });

  it("formatAreaNewsDate renders a plain UK date", () => {
    expect(formatAreaNewsDate("2026-06-22")).toBe("22 June 2026");
    expect(formatAreaNewsDate("not-a-date")).toBe("not-a-date");
  });
});

const VENUES = [
  { id: "venue-1", name: "The Leyton Engineer", borough: "Waltham Forest" },
  { id: "venue-2", name: "The Devonshire", borough: "Westminster" },
  { id: "venue-3", name: "The Devonshire Arms", borough: "Westminster" },
  { id: "venue-4", name: "The George IV", borough: "Westminster" },
  { id: "venue-5", name: "The George", borough: "Westminster" },
  { id: "venue-6", name: "The George", borough: "Bexley" },
];

describe("conservative venue matcher", () => {
  it("returns a high-confidence match on an exact, unique core-name in borough", () => {
    expect(matchVenue("The Leyton Engineer", "waltham-forest", VENUES)).toEqual({
      venueId: "venue-1",
      confidence: "high",
    });
  });

  it("prefers the exact same-name pub over a longer same-borough name", () => {
    // "The Devonshire" is exact to venue-2, and only a subset of "The
    // Devonshire Arms" — exact must win, unambiguously.
    expect(matchVenue("The Devonshire", "westminster", VENUES)).toEqual({
      venueId: "venue-2",
      confidence: "high",
    });
  });

  it("refuses when the same name appears twice in the borough", () => {
    const twins = [
      { id: "venue-x", name: "The George", borough: "Westminster" },
      { id: "venue-5", name: "The George", borough: "Westminster" },
    ];
    expect(matchVenue("The George", "westminster", twins)).toBeNull();
  });

  it("refuses a name that isn't in the named borough", () => {
    expect(matchVenue("The George", "camden", VENUES)).toBeNull();
    expect(matchVenue("Some Unknown Tavern", "westminster", VENUES)).toBeNull();
  });

  it("slugifyBorough mirrors lib/boroughs", () => {
    expect(slugifyBorough("Waltham Forest")).toBe("waltham-forest");
    expect(slugifyBorough("Kensington & Chelsea")).toBe("kensington-and-chelsea");
  });
});
