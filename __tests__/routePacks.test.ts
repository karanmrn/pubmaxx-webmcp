import { describe, expect, it } from "vitest";

import { curatedCrawlMapHref, curatedCrawls } from "@/lib/curatedCrawls";
import {
  allPackCrawlIds,
  getRoutePack,
  routePackMapHref,
  routePackPrimaryCrawl,
  routePacks,
} from "@/lib/routePacks";

const curatedIds = new Set(curatedCrawls.map((c) => c.id));

describe("routePacks", () => {
  it("ships the named London route packs", () => {
    expect(routePacks.map((p) => p.id).sort()).toEqual(
      [
        "cheap-chaos",
        "civic-west",
        "coding-pint",
        "late-train",
        "markets-late-trains",
        "music-theatre",
        "old-london",
        "quiet-table",
        "southwark-tide",
        "thames",
        "writers",
      ].sort(),
    );
  });

  it("only references real curated crawl ids", () => {
    for (const pack of routePacks) {
      expect(pack.crawlIds.length).toBeGreaterThan(0);
      for (const id of pack.crawlIds) {
        expect(curatedIds.has(id)).toBe(true);
      }
    }
  });

  it("maps Thames / writers / coding pint membership to the expected crawls", () => {
    expect(getRoutePack("thames")?.crawlIds).toEqual(
      expect.arrayContaining(["riverside-heritage", "bankside-riverside"]),
    );
    expect(getRoutePack("writers")?.crawlIds).toEqual(
      expect.arrayContaining(["fleet-street-writers", "bloomsbury-literary"]),
    );
    expect(getRoutePack("coding-pint")?.crawlIds).toEqual(
      expect.arrayContaining(["pint-park-view", "barbican-coding-pint"]),
    );
    expect(getRoutePack("old-london")?.crawlIds).toEqual(
      expect.arrayContaining(["victorian-soho", "bankside-riverside"]),
    );
    expect(getRoutePack("civic-west")?.crawlIds).toEqual(
      expect.arrayContaining([
        "westminster-civic",
        "leicester-mocktail-crawl",
        "fleet-street-writers",
      ]),
    );
    expect(getRoutePack("southwark-tide")?.crawlIds).toEqual(
      expect.arrayContaining([
        "borough-market-crawl",
        "bankside-riverside",
        "riverside-heritage",
      ]),
    );
  });

  it("deep-links Old London to Victorian Soho on the map", () => {
    const pack = getRoutePack("old-london");
    expect(pack).toBeDefined();
    const primary = routePackPrimaryCrawl(pack!);
    expect(primary?.id).toBe("victorian-soho");
    const href = routePackMapHref(pack!);
    expect(href).toBe(curatedCrawlMapHref(primary!));
    expect(href).toContain("crawl=victorian-soho");
    expect(href.startsWith("/map?")).toBe(true);
  });

  it("falls back to /map when a pack has no resolvable lead crawl", () => {
    expect(
      routePackMapHref({
        id: "empty",
        title: "Empty",
        blurb: "No routes",
        crawlIds: [],
      }),
    ).toBe("/map");
  });

  it("uses the first resolvable crawl when earlier ids are stale", () => {
    const primary = routePackPrimaryCrawl({
      id: "stale-first",
      title: "Stale first",
      blurb: "One stale id, one valid id",
      crawlIds: ["missing-crawl", "victorian-soho"],
    });
    expect(primary?.id).toBe("victorian-soho");
  });

  it("exposes a deduped union of pack crawl ids", () => {
    const ids = allPackCrawlIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(5);
  });
});
