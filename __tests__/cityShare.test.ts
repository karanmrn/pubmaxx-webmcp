import { describe, expect, it } from "vitest";

import {
  CULT_STORY_BAND_IDS,
  cityMapOgAlt,
  cityMapOgDescription,
  cityMapOgImageUrl,
  cityMapOgTitle,
  cityMapShareUrl,
  firstSearchParam,
  stopCountFromPubsParam,
} from "@/lib/cityShare";

describe("cityMapShareUrl", () => {
  it("keeps London on /map for back-compat", () => {
    expect(cityMapShareUrl("london")).toBe("/map");
    expect(cityMapShareUrl("london", { band: "river-history" })).toBe(
      "/map?band=river-history",
    );
  });

  it("builds /map/[city] paths with optional band", () => {
    expect(cityMapShareUrl("oxford")).toBe("/map/oxford");
    expect(cityMapShareUrl("glasgow", { band: "subcrawl" })).toBe(
      "/map/glasgow?band=subcrawl",
    );
    expect(cityMapShareUrl("Oxford", { band: " Freshers-First-Night " })).toBe(
      "/map/oxford?band=freshers-first-night",
    );
  });

  it("appends crawl when set", () => {
    expect(cityMapShareUrl("london", { crawl: "victorian-soho" })).toBe(
      "/map?crawl=victorian-soho",
    );
    expect(
      cityMapShareUrl("glasgow", {
        crawl: "subcrawl-starter",
        band: "subcrawl",
      }),
    ).toBe("/map/glasgow?band=subcrawl&crawl=subcrawl-starter");
  });

  it("falls back to London for unknown city ids", () => {
    expect(cityMapShareUrl("paris")).toBe("/map");
  });
});

describe("cityMapOgTitle / cityMapOgDescription", () => {
  it("uses city display name + tagline when no band", () => {
    expect(cityMapOgTitle("oxford")).toBe("Oxford pub map");
    expect(cityMapOgDescription("oxford")).toContain("College-town");
    expect(cityMapOgDescription("oxford")).toContain("PUBMAXXING");
  });

  it("leads with cult band title/blurb when the band resolves", () => {
    expect(cityMapOgTitle("glasgow", { band: "subcrawl" })).toBe(
      "Subcrawl: Clockwork Orange loop · Glasgow",
    );
    expect(cityMapOgDescription("glasgow", { band: "subcrawl" })).toMatch(
      /Subcrawl/i,
    );

    expect(cityMapOgTitle("oxford", { band: "freshers-first-night" })).toBe(
      "Freshers first night · Oxford",
    );
    expect(
      cityMapOgDescription("oxford", { band: "freshers-first-night" }),
    ).toMatch(/Freshers/i);

    expect(cityMapOgTitle("liverpool", { band: "match-day-anfield" })).toBe(
      "Match-day Anfield corridor · Liverpool",
    );
  });

  it("leads with curated crawl title when crawl resolves", () => {
    expect(cityMapOgTitle("london", { crawl: "victorian-soho" })).toBe(
      "Victorian Soho · London",
    );
    expect(
      cityMapOgDescription("london", {
        crawl: "victorian-soho",
        stopCount: 5,
      }),
    ).toBe(
      "5-stop crawl: Victorian Soho in London. Open it on PUBMAXXING.",
    );

    expect(cityMapOgTitle("london", { crawl: "Victorian-Soho" })).toBe(
      "Victorian Soho · London",
    );

    expect(
      cityMapOgTitle("glasgow", { crawl: "subcrawl-starter", band: "subcrawl" }),
    ).toBe("Subcrawl starter · Glasgow");
    expect(
      cityMapOgDescription("glasgow", { crawl: "subcrawl-starter" }),
    ).toMatch(/^6-stop crawl: Subcrawl starter in Glasgow/);
  });

  it("ignores unknown crawls and falls through to band / city copy", () => {
    expect(cityMapOgTitle("london", { crawl: "not-a-real-crawl" })).toBe(
      "London pub map",
    );
    expect(
      cityMapOgTitle("glasgow", {
        crawl: "missing",
        band: "subcrawl",
      }),
    ).toBe("Subcrawl: Clockwork Orange loop · Glasgow");
  });

  it("ignores unknown bands and keeps city copy", () => {
    expect(cityMapOgTitle("glasgow", { band: "not-a-real-band" })).toBe(
      "Glasgow pub map",
    );
    expect(cityMapOgDescription("glasgow", { band: "not-a-real-band" })).toContain(
      "West End",
    );
  });
});

describe("cityMapOgImageUrl", () => {
  it("points at the query-aware city-map-card route", () => {
    expect(cityMapOgImageUrl("oxford")).toBe("/api/city-map-card?city=oxford");
    expect(cityMapOgImageUrl("glasgow", { band: "subcrawl" })).toBe(
      "/api/city-map-card?city=glasgow&band=subcrawl",
    );
    expect(cityMapOgImageUrl("london", { crawl: "victorian-soho" })).toBe(
      "/api/city-map-card?city=london&crawl=victorian-soho",
    );
  });
});

describe("cityMapOgAlt / firstSearchParam / cult ids", () => {
  it("builds an alt string with PUBMAXXING", () => {
    expect(cityMapOgAlt("oxford", { band: "freshers-first-night" })).toBe(
      "Freshers first night · Oxford · PUBMAXXING",
    );
    expect(cityMapOgAlt("london", { crawl: "victorian-soho" })).toBe(
      "Victorian Soho · London · PUBMAXXING",
    );
  });

  it("unwraps Next searchParams values", () => {
    expect(firstSearchParam(undefined)).toBeUndefined();
    expect(firstSearchParam("subcrawl")).toBe("subcrawl");
    expect(firstSearchParam(["a", "b"])).toBe("a");
  });

  it("counts stops from pubs= param", () => {
    expect(stopCountFromPubsParam(undefined)).toBeUndefined();
    expect(stopCountFromPubsParam("")).toBeUndefined();
    expect(stopCountFromPubsParam("a,b,c")).toBe(3);
    expect(stopCountFromPubsParam(" a , , b ")).toBe(2);
  });

  it("lists the known cult story band ids", () => {
    expect(CULT_STORY_BAND_IDS).toEqual([
      "subcrawl",
      "freshers-first-night",
      "king-street-run",
      "bailey-crawl",
      "match-day-anfield",
      "harbourside",
    ]);
  });
});
