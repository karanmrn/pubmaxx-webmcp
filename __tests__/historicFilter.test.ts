import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { HistoricPub, HistoricVenueStatus } from "@/lib/historic";
import {
  availableBoroughs,
  citationHref,
  citationLabel,
  eraStartYear,
  filterAndSortHistoric,
  listedBadge,
  venueStatusBadge,
  type HistoricFilters,
} from "@/lib/historicFilter";

// Minimal factory — only the fields the filter/sort core reads.
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

const filters = (over: Partial<HistoricFilters>): HistoricFilters => ({
  borough: null,
  listedOnly: false,
  hasDate: false,
  sort: "oldest",
  ...over,
});

const SAMPLE: HistoricPub[] = [
  pub({ name: "Old Tavern", slug: "old-tavern", borough: "Southwark", era: "1520", listed: "II*" }),
  pub({ name: "Century House", slug: "century-house", borough: "Camden", era: "17th century", listed: "II" }),
  pub({ name: "Late Bar", slug: "late-bar", borough: "Camden", era: "19th century", listed: null }),
  pub({ name: "Dateless Arms", slug: "dateless-arms", borough: "Southwark", era: null, listed: "II" }),
  pub({ name: "Unknown Inn", slug: "unknown-inn", borough: null, era: null, listed: null }),
];

describe("eraStartYear", () => {
  it("maps a plain year to itself", () => {
    expect(eraStartYear("1520")).toBe(1520);
    expect(eraStartYear("1667")).toBe(1667);
  });

  it("maps 'Nth century' to its opening year", () => {
    expect(eraStartYear("17th century")).toBe(1600);
    expect(eraStartYear("18th century")).toBe(1700);
    expect(eraStartYear("19th century")).toBe(1800);
  });

  it("orders a specific year before the generic later century", () => {
    // 1520 (a 16th-century year) precedes the generic "17th century" (1600).
    expect(eraStartYear("1520")).toBeLessThan(eraStartYear("17th century"));
  });

  it("returns +Infinity for null / unparseable eras", () => {
    expect(eraStartYear(null)).toBe(Number.POSITIVE_INFINITY);
    expect(eraStartYear("some time ago")).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("filterAndSortHistoric — filters", () => {
  it("filters by borough (exact match)", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ borough: "Camden" }));
    expect(out.map((p) => p.slug).sort()).toEqual(["century-house", "late-bar"]);
    expect(out.every((p) => p.borough === "Camden")).toBe(true);
  });

  it("listed-only drops ungraded pubs", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ listedOnly: true }));
    expect(out.every((p) => p.listed)).toBe(true);
    expect(out.map((p) => p.slug)).not.toContain("late-bar");
    expect(out.map((p) => p.slug)).not.toContain("unknown-inn");
  });

  it("has-date drops pubs with no era", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ hasDate: true }));
    expect(out.every((p) => p.era)).toBe(true);
    expect(out.map((p) => p.slug)).not.toContain("dateless-arms");
    expect(out.map((p) => p.slug)).not.toContain("unknown-inn");
  });

  it("combines filters (borough + listed)", () => {
    const out = filterAndSortHistoric(
      SAMPLE,
      filters({ borough: "Southwark", listedOnly: true }),
    );
    expect(out.map((p) => p.slug).sort()).toEqual(["dateless-arms", "old-tavern"]);
  });

  it("returns an empty array when nothing matches", () => {
    const out = filterAndSortHistoric(
      SAMPLE,
      filters({ borough: "Camden", hasDate: true, listedOnly: true }),
    );
    // Camden's only listed+dated pub is Century House.
    expect(out.map((p) => p.slug)).toEqual(["century-house"]);

    const none = filterAndSortHistoric(
      SAMPLE,
      filters({ borough: "Nowhere-on-Thames" }),
    );
    expect(none).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const before = SAMPLE.map((p) => p.slug);
    filterAndSortHistoric(SAMPLE, filters({ sort: "az" }));
    expect(SAMPLE.map((p) => p.slug)).toEqual(before);
  });
});

describe("filterAndSortHistoric — sort", () => {
  it("oldest first: year before century before null, nulls last", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ sort: "oldest" }));
    expect(out.map((p) => p.slug)).toEqual([
      "old-tavern", // 1520
      "century-house", // 17th century (1600)
      "late-bar", // 19th century (1800)
      // undated pubs sink to the bottom, tie-broken A–Z
      "dateless-arms",
      "unknown-inn",
    ]);
  });

  it("A–Z sorts by name", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ sort: "az" }));
    expect(out.map((p) => p.name)).toEqual([
      "Century House",
      "Dateless Arms",
      "Late Bar",
      "Old Tavern",
      "Unknown Inn",
    ]);
  });

  it("by borough groups alphabetically, null borough last", () => {
    const out = filterAndSortHistoric(SAMPLE, filters({ sort: "borough" }));
    expect(out.map((p) => p.borough)).toEqual([
      "Camden",
      "Camden",
      "Southwark",
      "Southwark",
      null, // Unknown Inn — no borough → last
    ]);
    expect(out[out.length - 1].slug).toBe("unknown-inn");
  });
});

describe("derived helpers", () => {
  it("availableBoroughs lists distinct boroughs A–Z, dropping null", () => {
    expect(availableBoroughs(SAMPLE)).toEqual(["Camden", "Southwark"]);
  });

  it("listedBadge prefixes the grade", () => {
    expect(listedBadge("II*")).toBe("Grade II*");
    expect(listedBadge("II")).toBe("Grade II");
    expect(listedBadge(null)).toBeNull();
  });

  it("citationHref prefers the fact matching the hook", () => {
    const p = pub({
      hook: "The exact cited sentence.",
      facts: [
        { source: "wikidata", fact: "something else", sourceRef: "https://www.wikidata.org/wiki/Q1" },
        { source: "wikipedia", fact: "The exact cited sentence.", sourceRef: "https://en.wikipedia.org/wiki/X" },
      ],
    });
    expect(citationHref(p)).toBe("https://en.wikipedia.org/wiki/X");
  });

  it("citationHref falls back to first wikipedia fact, then any ref, then null", () => {
    const wikiFallback = pub({
      hook: "unmatched",
      facts: [
        { source: "seed", fact: "seed note", sourceRef: "https://example.com/a" },
        { source: "wikipedia", fact: "wiki note", sourceRef: "https://en.wikipedia.org/wiki/Y" },
      ],
    });
    expect(citationHref(wikiFallback)).toBe("https://en.wikipedia.org/wiki/Y");

    const anyRef = pub({
      hook: "unmatched",
      facts: [{ source: "osm", fact: "osm note", sourceRef: "https://camra.org.uk/z" }],
    });
    expect(citationHref(anyRef)).toBe("https://camra.org.uk/z");

    const noRef = pub({ hook: "unmatched", facts: [{ source: "osm", fact: "no ref" }] });
    expect(citationHref(noRef)).toBeNull();
  });

  it("citationLabel names the actual host", () => {
    expect(citationLabel("https://en.wikipedia.org/wiki/X")).toBe("Wikipedia");
    expect(citationLabel("https://www.wikidata.org/wiki/Q1")).toBe("Wikidata");
    expect(citationLabel("https://camra.org.uk/pub")).toBe("CAMRA");
    expect(citationLabel("https://whatpub.com/pub")).toBe("WhatPub");
    expect(citationLabel("not a url")).toBe("Source");
  });
});

function bundledHistoricPubs(): HistoricPub[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), "public/data/historic_pubs.json"), "utf8"),
  ) as HistoricPub[];
}

describe("venueStatusBadge", () => {
  it("names closed and demolished only", () => {
    expect(venueStatusBadge("closed")).toBe("Closed");
    expect(venueStatusBadge("demolished")).toBe("Demolished");
    expect(venueStatusBadge(undefined)).toBeNull();
    expect(venueStatusBadge(null)).toBeNull();
  });

  it("stays silent on a status it does not know", () => {
    // loadHistoricPubs casts the parsed bundle without validating it, so a
    // status outside the union really can reach here.
    const unvalidated = ["open", "refurbished", ""].map(
      (value) => value as HistoricVenueStatus,
    );
    for (const status of unvalidated) {
      expect(venueStatusBadge(status)).toBeNull();
    }
  });

  it("names a badge for every status the shipped bundle records", () => {
    for (const pub of bundledHistoricPubs()) {
      if (pub.venueStatus == null) continue;
      expect(
        venueStatusBadge(pub.venueStatus),
        `${pub.slug} carries a status the badge names`,
      ).not.toBeNull();
    }
  });

  it("named audit pubs carry a recorded status in the bundle", () => {
    const pubs = bundledHistoricPubs();
    const colony = pubs.find((p) => p.slug === "the-colony-room");
    const blackCap = pubs.find((p) => p.slug === "the-black-cap");
    const robey = pubs.find((p) => p.slug === "the-sir-george-robey");
    expect(colony?.venueStatus).toBe("closed");
    expect(blackCap?.venueStatus).toBe("closed");
    expect(robey?.venueStatus).toBe("demolished");
  });
});
