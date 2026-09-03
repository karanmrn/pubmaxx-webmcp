import { describe, expect, it } from "vitest";

import { crawlShareMapHref, curatedCrawlMapHref, curatedCrawls } from "@/lib/curatedCrawls";
import { landmarks } from "@/lib/landmarks";
import { ALT_CRAWL_STYLES } from "@/lib/crawlUrl";
import { groupVenuePrices, type CrawlStyle, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

// Recompute venue ids from the dataset exactly as the app does, so a re-export
// that moves a venue is caught here instead of 404-ing a curated crawl.
const venues = groupVenuePrices(dataset as VenuePrice[]);
const venueById = new Map(venues.map((venue) => [venue.id, venue]));

const validStyles: CrawlStyle[] = [
  "balanced",
  "cheapest",
  "heritage",
  "writerTrail",
  "beerGarden",
  "sports",
  "dateNight",
];

describe("curated crawls", () => {
  it("has 3-16 crawls with unique ids", () => {
    // Started at 3-4; extended with themed POI crawls, alt-style crawls, then
    // London-chain editorial crawls (Eating Europe + Young's + Nicholson's).
    expect(curatedCrawls.length).toBeGreaterThanOrEqual(3);
    expect(curatedCrawls.length).toBeLessThanOrEqual(16);
    expect(new Set(curatedCrawls.map((c) => c.id)).size).toBe(curatedCrawls.length);
  });

  it("every crawl has a name, blurb, enough stops, and a valid crawlStyle", () => {
    for (const crawl of curatedCrawls) {
      expect(crawl.name.trim().length, `${crawl.id} name`).toBeGreaterThan(0);
      expect(crawl.blurb.trim().length, `${crawl.id} blurb`).toBeGreaterThan(0);
      expect(crawl.venueIds.length, `${crawl.id} stop count`).toBeGreaterThanOrEqual(4);
      expect(validStyles, `${crawl.id} crawlStyle`).toContain(crawl.crawlStyle);
    }
  });

  it("ships the London chain/guide crawls with matched venue coverage", () => {
    const byId = new Map(curatedCrawls.map((c) => [c.id, c]));
    expect(byId.get("eating-europe-london-pubs")?.venueIds.length).toBeGreaterThanOrEqual(7);
    expect(byId.get("youngs-beer-gardens")?.venueIds.length).toBeGreaterThanOrEqual(8);
    expect(byId.get("nicholsons-west-end")?.venueIds.length).toBeGreaterThanOrEqual(6);
    expect(byId.get("eating-europe-london-pubs")?.crawlStyle).toBe("heritage");
    expect(byId.get("youngs-beer-gardens")?.crawlStyle).toBe("beerGarden");
    expect(byId.get("nicholsons-west-end")?.crawlStyle).toBe("heritage");
  });

  it("every venueId resolves to a real venue in the dataset", () => {
    for (const crawl of curatedCrawls) {
      for (const venueId of crawl.venueIds) {
        expect(
          venueById.get(venueId),
          `crawl ${crawl.id} points at missing venue ${venueId}`,
        ).toBeDefined();
      }
      // No repeated stops within a crawl.
      expect(new Set(crawl.venueIds).size, `${crawl.id} has duplicate stops`).toBe(
        crawl.venueIds.length,
      );
    }
  });

  it("every startLandmarkId, when set, resolves to a real landmark (story 27)", () => {
    for (const crawl of curatedCrawls) {
      if (!crawl.startLandmarkId) continue;
      expect(
        landmarks.some((lm) => lm.id === crawl.startLandmarkId),
        `crawl ${crawl.id} points at missing landmark ${crawl.startLandmarkId}`,
      ).toBe(true);
    }
  });

  it("at least one new themed crawl threads each POI category (garden/market/historic/viewpoint)", () => {
    // Not a strict per-crawl requirement — poisOnLeg (lib/routeLegs) threads POIs
    // generically for any route — but the themed crawls should sit near real
    // examples of each category so "on the way" has something to surface.
    const ids = new Set(curatedCrawls.map((c) => c.id));
    expect(ids.has("pint-park-view")).toBe(true);
    expect(ids.has("borough-market-crawl")).toBe(true);
    expect(ids.has("bankside-riverside")).toBe(true);
  });

  it("every altStyle, when set, is a known alt crawl style (issue #31)", () => {
    for (const crawl of curatedCrawls) {
      if (!crawl.altStyle) continue;
      expect(ALT_CRAWL_STYLES, `${crawl.id} altStyle`).toContain(crawl.altStyle);
    }
  });

  it("ships the two alt-style crawls, honestly matched to their theme", () => {
    const byId = new Map(curatedCrawls.map((c) => [c.id, c]));
    const food = byId.get("soho-food-crawl");
    const mocktail = byId.get("leicester-mocktail-crawl");
    expect(food?.altStyle).toBe("food");
    expect(mocktail?.altStyle).toBe("mocktail");
    // Every food-crawl stop actually serves food; every mocktail-crawl stop
    // actually mixes drinks — provenance stays honest.
    for (const id of food?.venueIds ?? []) {
      expect(venueById.get(id)?.amenities.food, `${id} food`).toBe(true);
    }
    for (const id of mocktail?.venueIds ?? []) {
      expect(venueById.get(id)?.amenities.cocktails, `${id} cocktails`).toBe(true);
    }
  });

  it("packages Place story corridors on key heritage crawls (Wave F2)", () => {
    const byId = new Map(curatedCrawls.map((c) => [c.id, c]));
    expect(byId.get("fleet-street-writers")?.placeStoryBandId).toBe("fleet-street-writers");
    expect(byId.get("riverside-heritage")?.placeStoryBandId).toBe("thames-industrial");
    expect(byId.get("borough-market-crawl")?.placeStoryBandId).toBe("markets-theatre");
    expect(byId.get("westminster-civic")?.placeStoryBandId).toBe("royal-civic");
    expect(byId.get("barbican-coding-pint")?.placeStoryBandId).toBe("coding-pint");
    expect(byId.get("bankside-riverside")?.placeStoryBandId).toBe("river-history");
    // Soho is not on the Westminster royal-civic corridor.
    expect(byId.get("victorian-soho")?.placeStoryBandId).toBeUndefined();
  });

  it("builds a shareable crawl map URL with pubs and optional band (Wave H1)", () => {
    const riverside = curatedCrawls.find((c) => c.id === "riverside-heritage");
    expect(riverside).toBeDefined();
    const href = crawlShareMapHref({
      venueIds: riverside!.venueIds,
      placeStoryBandId: riverside!.placeStoryBandId,
      crawlId: riverside!.id,
    });
    expect(href.startsWith("/map?")).toBe(true);
    expect(href).toContain("mode=build");
    expect(href).toContain("pubs=");
    expect(href).toContain("crawl=riverside-heritage");
    expect(href).toContain("band=thames-industrial");
    expect(href).toContain(riverside!.venueIds[0]);
  });

  it("routes city-prefixed venue shares onto /map/{city}", () => {
    const href = crawlShareMapHref({
      venueIds: ["venue-oxf-16404bl", "venue-oxf-n2un97"],
      crawlId: "freshers-first-night",
      cityId: "oxford",
    });
    expect(href.startsWith("/map/oxford?")).toBe(true);
    expect(href).toContain("pubs=venue-oxf-16404bl");
    expect(href).toContain("crawl=freshers-first-night");
  });

  it("infers /map/{city} from venue id prefixes when cityId is omitted", () => {
    const href = curatedCrawlMapHref({
      id: "freshers-first-night",
      name: "Freshers first night",
      blurb: "test",
      crawlStyle: "balanced",
      venueIds: ["venue-oxf-16404bl", "venue-oxf-n2un97"],
      placeStoryBandId: "freshers-first-night",
    });
    expect(href.startsWith("/map/oxford?")).toBe(true);
    expect(href).toContain("band=freshers-first-night");
  });

  it("builds a curated map-first href with crawl= and style/alt/band", () => {
    const soho = curatedCrawls.find((c) => c.id === "victorian-soho");
    expect(soho).toBeDefined();
    const href = curatedCrawlMapHref(soho!);
    expect(href.startsWith("/map?")).toBe(true);
    expect(href).toContain("mode=build");
    expect(href).toContain("pubs=");
    expect(href).toContain("crawl=victorian-soho");
    expect(href).toContain("style=heritage");
    expect(href).toContain(soho!.venueIds[0]);
    // Victorian Soho has no Place story band / alt style.
    expect(href).not.toContain("band=");
    expect(href).not.toContain("alt=");

    const mocktail = curatedCrawls.find((c) => c.id === "leicester-mocktail-crawl");
    expect(mocktail).toBeDefined();
    const mockHref = curatedCrawlMapHref(mocktail!);
    expect(mockHref).toContain("crawl=leicester-mocktail-crawl");
    expect(mockHref).toContain("alt=mocktail");
    expect(mockHref).toContain("band=royal-civic");
  });
});

