import { describe, expect, it } from "vitest";

import {
  DISCOVER_EDITORIAL,
  discoverDrinkBrowseLede,
} from "@/app/discover/DiscoverPageClient";
import {
  categoryLabel,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/drinks";

// Discover editorial CTAs must open map-first crawl/route URLs (polyline),
// not bare /map or filter-only arrivals.

describe("Discover drink browse lede", () => {
  it("lists every map-lens category so coffee cannot drift out", () => {
    const lede = discoverDrinkBrowseLede();
    expect(lede.startsWith("Browse ")).toBe(true);
    expect(lede.endsWith(".")).toBe(true);
    for (const category of MAP_LENS_DRINK_CATEGORIES) {
      const label =
        category === "alcohol-free"
          ? "alcohol-free drinks"
          : categoryLabel(category).toLocaleLowerCase("en-GB");
      expect(lede).toContain(label);
    }
    expect(lede).toContain("coffee");
    expect(lede).not.toMatch(/\bother\b/i);
  });
});

describe("Discover editorial map deep-links", () => {
  it("every editorial card opens /map with a built crawl polyline", () => {
    expect(DISCOVER_EDITORIAL.length).toBeGreaterThanOrEqual(4);
    for (const card of DISCOVER_EDITORIAL) {
      expect(card.href, card.id).toMatch(/^\/map\?/);
      expect(card.href, card.id).toContain("mode=build");
      expect(card.href, card.id).toContain("crawl=");
      expect(card.href, card.id).toContain("pubs=");
    }
  });

  it("heritage card opens Victorian Soho", () => {
    const card = DISCOVER_EDITORIAL.find((c) => c.id === "golden-days");
    expect(card?.href).toContain("crawl=victorian-soho");
  });

  it("coding pint card opens barbican-coding-pint", () => {
    const card = DISCOVER_EDITORIAL.find((c) => c.id === "coding-pint");
    expect(card?.href).toContain("crawl=barbican-coding-pint");
  });

  it("cheap crawl and tonight cards open distinct pack lead crawls", () => {
    const cheap = DISCOVER_EDITORIAL.find((c) => c.id === "then-vs-now");
    const tonight = DISCOVER_EDITORIAL.find((c) => c.id === "tonights-crawl");
    expect(cheap?.href).toMatch(/crawl=/);
    expect(tonight?.href).toMatch(/crawl=/);
    expect(cheap?.href).not.toBe(tonight?.href);
  });

  it("keeps London editorial on /map (never /map/<other-city>)", () => {
    for (const card of DISCOVER_EDITORIAL) {
      expect(card.href, card.id).toMatch(/^\/map\?/);
      expect(card.href, card.id).not.toMatch(/^\/map\/[^/]+\?/);
    }
  });
});
