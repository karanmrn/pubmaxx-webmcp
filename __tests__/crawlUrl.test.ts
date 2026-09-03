import { describe, it, expect } from "vitest";

import {
  buildCrawlMapHref,
  encodeCrawl,
  decodeCrawl,
  seedCrawlState,
  type CrawlUrlState,
} from "@/lib/crawlUrl";
import { initialFilters } from "@/components/map/ControlRail";

const sample: CrawlUrlState = {
  mode: "build",
  filters: {
    ...initialFilters,
    crawlStyle: "heritage",
    maxPrice: 6.5,
    stopCount: 5,
    routeWindow: 25,
    requirePintDrops: true,
  },
  builtIds: ["venue-abc", "venue-def"],
  selectedVenueId: "venue-abc",
};

describe("crawlUrl", () => {
  it("round-trips encode -> decode for a representative state", () => {
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(decoded.mode).toBe("build");
    expect(decoded.filters).toMatchObject({
      crawlStyle: "heritage",
      maxPrice: 6.5,
      stopCount: 5,
      routeWindow: 25,
      requirePintDrops: true,
    });
    expect(decoded.builtIds).toEqual(["venue-abc", "venue-def"]);
    expect(decoded.selectedVenueId).toBe("venue-abc");
  });

  it("omits default crawl params so a fresh /map stays clean", () => {
    const defaults: CrawlUrlState = {
      mode: "suggest",
      filters: { ...initialFilters },
      builtIds: [],
      selectedVenueId: "",
    };
    expect(encodeCrawl(defaults)).toBe("");
    // Defaults still round-trip through seedCrawlState when the URL is bare.
    expect(seedCrawlState("")).toMatchObject({
      mode: "suggest",
      filters: expect.objectContaining({
        crawlStyle: "balanced",
        maxPrice: 10,
        stopCount: 6,
        routeWindow: 20,
      }),
      builtIds: [],
    });
  });

  it("round-trips a concrete zone lens and omits the default (all)", () => {
    const zoned = encodeCrawl({ ...sample, filters: { ...sample.filters, zone: "3" } });
    expect(zoned).toContain("zone=3");
    expect(decodeCrawl(new URLSearchParams(zoned)).filters).toMatchObject({ zone: "3" });
    // "" / "all" is the default and must not clutter the URL.
    expect(encodeCrawl({ ...sample, filters: { ...sample.filters, zone: "" } })).not.toContain("zone");
    expect(encodeCrawl({ ...sample, filters: { ...sample.filters, zone: "all" } })).not.toContain("zone");
    // A junk zone param is ignored on decode (no zone key set).
    expect(decodeCrawl(new URLSearchParams("zone=9")).filters?.zone).toBeUndefined();
    expect(decodeCrawl(new URLSearchParams("zone=nope")).filters?.zone).toBeUndefined();
  });

  it("encodes requirePintDrops as drops=1 and omits it when off", () => {
    expect(encodeCrawl(sample)).toContain("drops=1");
    const off = encodeCrawl({ ...sample, filters: { ...sample.filters, requirePintDrops: false } });
    expect(off).not.toContain("drops");
  });

  it("only drops=1 turns the Pint Drops filter on; other values leave it off", () => {
    expect(decodeCrawl(new URLSearchParams("drops=1")).filters?.requirePintDrops).toBe(true);
    // absent, empty, or any non-"1" value must not enable it (default off)
    expect(decodeCrawl(new URLSearchParams("")).filters?.requirePintDrops).toBeUndefined();
    expect(decodeCrawl(new URLSearchParams("drops=0")).filters?.requirePintDrops).toBeUndefined();
    expect(decodeCrawl(new URLSearchParams("drops=yes")).filters?.requirePintDrops).toBeUndefined();
  });

  it("preserves hand-built stop order (a reversed route stays reversed)", () => {
    const reversed: CrawlUrlState = { ...sample, builtIds: ["venue-def", "venue-abc"] };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(reversed)));
    expect(decoded.builtIds).toEqual(["venue-def", "venue-abc"]);
    // and the reverse of that round-trips back to the original order
    const back = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(back.builtIds).toEqual(["venue-abc", "venue-def"]);
  });

  it("seedCrawlState reproduces the captured state atop defaults", () => {
    const seeded = seedCrawlState(`?${encodeCrawl(sample)}`);
    expect(seeded).toEqual({
      mode: sample.mode,
      filters: sample.filters,
      builtIds: sample.builtIds,
      selectedVenueId: sample.selectedVenueId,
      bandId: "", // additive story-band field, "" when no ?band= in the URL
      altStyle: "pint", // additive alt-style field, defaults to "pint" (issue #31)
      landmarkId: "",
      crawlId: "",
    });
  });

  it("round-trips a curated crawl id via ?crawl=", () => {
    const withCrawl = { ...sample, crawlId: "victorian-soho" };
    const encoded = encodeCrawl(withCrawl);
    expect(encoded).toContain("crawl=victorian-soho");
    const decoded = decodeCrawl(new URLSearchParams(encoded));
    expect(decoded.crawlId).toBe("victorian-soho");
    expect(seedCrawlState(`?${encoded}`).crawlId).toBe("victorian-soho");
    // Absent crawl= stays short; seed resolves to "".
    expect(decodeCrawl(new URLSearchParams(encodeCrawl(sample))).crawlId).toBeUndefined();
    expect(seedCrawlState(`?${encodeCrawl(sample)}`).crawlId).toBe("");
    // Slug-ish normalize: trim, lowercase, strip junk.
    expect(decodeCrawl(new URLSearchParams("crawl=Victorian%20Soho!")).crawlId).toBe(
      "victorian-soho",
    );
  });

  it("round-trips an active story band via ?band=", () => {
    const withBand = { ...sample, bandId: "river-history" };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(withBand)));
    expect(decoded.bandId).toBe("river-history");
    // No band = no param (kept short); seed resolves it to "".
    const bare = decodeCrawl(new URLSearchParams(encodeCrawl(sample)));
    expect(bare.bandId).toBeUndefined();
    expect(seedCrawlState(`?${encodeCrawl(withBand)}`).bandId).toBe("river-history");
  });

  it("round-trips a landmark chapter via ?landmark=", () => {
    const withLandmark = { ...sample, landmarkId: "tower-bridge" };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(withLandmark)));
    expect(decoded.landmarkId).toBe("tower-bridge");
    expect(seedCrawlState(`?${encodeCrawl(withLandmark)}`).landmarkId).toBe("tower-bridge");
  });

  it("round-trips an alt crawl style via ?alt= (issue #31)", () => {
    const coffee = { ...sample, altStyle: "coffee" as const };
    const decoded = decodeCrawl(new URLSearchParams(encodeCrawl(coffee)));
    expect(decoded.altStyle).toBe("coffee");
    // The default "pint" is omitted from the URL (kept short) and seeds back.
    const pint = { ...sample, altStyle: "pint" as const };
    expect(encodeCrawl(pint)).not.toContain("alt=");
    expect(decodeCrawl(new URLSearchParams(encodeCrawl(pint))).altStyle).toBeUndefined();
    expect(seedCrawlState(`?${encodeCrawl(coffee)}`).altStyle).toBe("coffee");
    // An unknown alt value is ignored (decodes to undefined -> seeds "pint").
    expect(decodeCrawl(new URLSearchParams("alt=wizard")).altStyle).toBeUndefined();
    expect(seedCrawlState("?alt=wizard").altStyle).toBe("pint");
  });

  it("decodes garbage without throwing and returns a safe partial", () => {
    const garbage = new URLSearchParams(
      "mode=teleport&style=wizard&max=NaN&stops=999&win=-40&pubs=,,&junk=1",
    );
    const decoded = decodeCrawl(garbage);
    // unknown mode/style dropped; empty pubs dropped
    expect(decoded.mode).toBeUndefined();
    expect(decoded.filters?.crawlStyle).toBeUndefined();
    expect(decoded.filters?.maxPrice).toBeUndefined();
    expect(decoded.builtIds).toBeUndefined();
    // out-of-range numbers clamp to slider bounds, never throw
    expect(decoded.filters?.stopCount).toBe(7); // clamped to max 7
    expect(decoded.filters?.routeWindow).toBe(15); // clamped to min 15
  });

  it("decodes an empty query to an empty partial", () => {
    expect(decodeCrawl(new URLSearchParams(""))).toEqual({});
  });

  it("seeds ?style=heritage from a bare landing-page link", () => {
    const seeded = seedCrawlState("?style=heritage");
    expect(seeded.filters.crawlStyle).toBe("heritage");
    expect(seeded.mode).toBe("suggest");
    expect(seeded.builtIds).toEqual([]);
  });

  it("seeds drink chooser links into map filters (lens only, not text query)", () => {
    const cocktail = seedCrawlState("?drink=cocktail");
    expect(cocktail.filters.requireCocktails).toBe(true);
    expect(cocktail.filters.drinkCategory).toBe("cocktail");
    expect(cocktail.filters.query).toBe("");

    const lowNo = seedCrawlState("?drink=low-no&low=1");
    expect(lowNo.filters.requireNonAlcoholic).toBe(true);
    expect(lowNo.altStyle).toBe("mocktail");

    const wine = seedCrawlState("?drink=wine");
    expect(wine.filters.drinkCategory).toBe("wine");
    expect(wine.filters.query).toBe("");

    const gin = seedCrawlState("?drink=gin");
    expect(gin.filters.drinkCategory).toBe("gin");
    expect(gin.filters.query).toBe("");
  });

  it("refuses a category the map can neither lens nor clear", () => {
    // `other` stays a submittable category, but as a filter it would narrow the
    // map with no lens shown, no chip pressed and no way to turn it off.
    const other = seedCrawlState("?drink=other");
    expect(other.filters.drinkCategory).toBe("");

    const encoded = encodeCrawl({
      ...sample,
      filters: { ...sample.filters, drinkCategory: "other" },
    });
    expect(encoded).not.toContain("drink=other");
  });

  it("decodes cocktails=1 into the cocktail drink lens (not amenity alone)", () => {
    const seeded = seedCrawlState("?cocktails=1");
    expect(seeded.filters.requireCocktails).toBe(true);
    expect(seeded.filters.drinkCategory).toBe("cocktail");
    expect(seeded.filters.query).toBe("");

    // Explicit drink= wins over the cocktails=1 soft lens fill-in.
    const winePlus = seedCrawlState("?drink=wine&cocktails=1");
    expect(winePlus.filters.drinkCategory).toBe("wine");
    expect(winePlus.filters.requireCocktails).toBe(true);
    expect(winePlus.filters.query).toBe("");
  });

  it("drink deep-link leaves an explicit query untouched", () => {
    const seeded = seedCrawlState("?drink=wine&q=borough");
    expect(seeded.filters.drinkCategory).toBe("wine");
    expect(seeded.filters.query).toBe("borough");
  });

  it("round-trips drink + brand query params", () => {
    const encoded = encodeCrawl({
      ...sample,
      filters: {
        ...sample.filters,
        drinkCategory: "gin",
        drinkBrand: "sipsmith",
      },
    });
    expect(encoded).toContain("drink=gin");
    expect(encoded).toContain("brand=sipsmith");

    const decoded = seedCrawlState(`?${encoded}`);
    expect(decoded.filters.drinkCategory).toBe("gin");
    expect(decoded.filters.drinkBrand).toBe("sipsmith");
  });

  it("round-trips a subtype refinement alongside its category", () => {
    const encoded = encodeCrawl({
      ...sample,
      filters: {
        ...sample.filters,
        drinkCategory: "rum",
        drinkSubtype: "rum-dark",
        topShelfOnly: true,
      },
    });
    expect(encoded).toContain("drink=rum");
    expect(encoded).toContain("sub=rum-dark");
    expect(encoded).toContain("topshelf=1");

    const decoded = seedCrawlState(`?${encoded}`);
    expect(decoded.filters.drinkCategory).toBe("rum");
    expect(decoded.filters.drinkSubtype).toBe("rum-dark");
    expect(decoded.filters.topShelfOnly).toBe(true);
  });

  it("a bare ?sub= deep-link supplies its own parent category", () => {
    const seeded = seedCrawlState("?sub=whisky-japanese");
    expect(seeded.filters.drinkCategory).toBe("whisky");
    expect(seeded.filters.drinkSubtype).toBe("whisky-japanese");
  });

  it("drops a subtype that disagrees with the encoded category, keeping the category", () => {
    const seeded = seedCrawlState("?drink=gin&sub=rum-dark");
    expect(seeded.filters.drinkCategory).toBe("gin");
    expect(seeded.filters.drinkSubtype).toBe("");

    // An unknown subtype id is ignored, never obeyed.
    const bogus = seedCrawlState("?drink=rum&sub=rum-unicorn");
    expect(bogus.filters.drinkCategory).toBe("rum");
    expect(bogus.filters.drinkSubtype).toBe("");
  });

  it("never encodes an orphaned subtype", () => {
    const encoded = encodeCrawl({
      ...sample,
      filters: {
        ...sample.filters,
        drinkCategory: "",
        drinkSubtype: "rum-dark",
        topShelfOnly: true,
      },
    });
    expect(encoded).not.toContain("sub=");
    expect(encoded).not.toContain("topshelf=");

    const decoded = seedCrawlState("?topshelf=1");
    expect(decoded.filters.topShelfOnly).toBe(false);
  });

  it("seeds Discover brand deep-links like ?drink=vodka&brand=absolut", () => {
    const seeded = seedCrawlState("?drink=vodka&brand=absolut");
    expect(seeded.filters.drinkCategory).toBe("vodka");
    expect(seeded.filters.drinkBrand).toBe("absolut");
  });

  it("infers drinkCategory from a known brand when drink= is omitted", () => {
    const seeded = seedCrawlState("?brand=sipsmith");
    expect(seeded.filters.drinkBrand).toBe("sipsmith");
    expect(seeded.filters.drinkCategory).toBe("gin");
  });

  it("ignores unknown drink/brand values", () => {
    const seeded = seedCrawlState("?drink=wizard&brand=not-real");
    expect(seeded.filters.drinkCategory).toBe("");
    expect(seeded.filters.drinkBrand).toBe("");
  });

  it("maps non-alcoholic drink aliases onto the low/no filter", () => {
    const seeded = seedCrawlState("?drink=non-alcoholic");
    expect(seeded.filters.requireNonAlcoholic).toBe(true);
    expect(seeded.altStyle).toBe("mocktail");
  });

  it("decodes food=1 into requireFood (Discover Hungry? deep-link)", () => {
    expect(decodeCrawl(new URLSearchParams("food=1")).filters?.requireFood).toBe(true);
    expect(decodeCrawl(new URLSearchParams("food=0")).filters?.requireFood).toBeUndefined();
    expect(seedCrawlState("?food=1").filters.requireFood).toBe(true);
    const encoded = encodeCrawl({
      ...sample,
      filters: { ...sample.filters, requireFood: true },
    });
    expect(encoded).toContain("food=1");
    expect(
      encodeCrawl({ ...sample, filters: { ...sample.filters, requireFood: false } }),
    ).not.toContain("food=");
  });

  it("round-trips explicit drink search filters", () => {
    const encoded = encodeCrawl({
      ...sample,
      filters: {
        ...sample.filters,
        query: "Lucky Saint",
        requireNonAlcoholic: true,
        requireCocktails: true,
      },
    });
    const decoded = seedCrawlState(`?${encoded}`);
    expect(decoded.filters.query).toBe("Lucky Saint");
    expect(decoded.filters.requireNonAlcoholic).toBe(true);
    expect(decoded.filters.requireCocktails).toBe(true);
  });

  describe("buildCrawlMapHref", () => {
    it("deep links the whole ordered crawl into build mode", () => {
      const href = buildCrawlMapHref(["venue-abc", "venue-def", "venue-ghi"]);
      expect(href).toMatch(/^\/map\?mode=build&pubs=/);
      // Ordered pub ids round-trip back through the decoder in the same order
      // (URLSearchParams percent-encodes the commas, same as every share link).
      const decoded = decodeCrawl(new URLSearchParams(href!.split("?")[1]));
      expect(decoded.mode).toBe("build");
      expect(decoded.builtIds).toEqual(["venue-abc", "venue-def", "venue-ghi"]);
    });

    it("returns null for fewer than two stops (no walk to show)", () => {
      expect(buildCrawlMapHref([])).toBeNull();
      expect(buildCrawlMapHref(["venue-abc"])).toBeNull();
      expect(buildCrawlMapHref(["", ""])).toBeNull();
    });
  });
});
