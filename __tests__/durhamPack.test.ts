import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { landmarksForCity } from "@/lib/cityLandmarks";
import { storyBandsForCity } from "@/lib/cityStoryBands";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { validateAllStoryBands } from "@/lib/storyBands";
import { CITIES } from "@/lib/cities";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { Poi } from "@/lib/pois";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

const ROOT = path.join(__dirname, "..");
const SLIM_PATH = path.join(
  ROOT,
  "public",
  "data",
  "cities",
  "durham",
  "venues_slim.json",
);
const POIS_PATH = path.join(ROOT, "public", "data", "cities", "durham", "pois.json");

const slim = (rowsFromSlimPayload(JSON.parse(readFileSync(SLIM_PATH, "utf8"))) ?? []) as SlimVenue[];
const slimIds = new Set(slim.map((v) => v.id));

describe("Durham Bailey editorial pack", () => {
  const landmarks = landmarksForCity("durham");
  const bands = storyBandsForCity("durham");
  const crawls = curatedCrawlsForCity("durham");

  it("ships ≥6 sourced landmarks", () => {
    expect(landmarks.length).toBeGreaterThanOrEqual(6);
    expect(landmarks.length).toBeLessThanOrEqual(10);
    expect(new Set(landmarks.map((l) => l.id)).size).toBe(landmarks.length);
    for (const landmark of landmarks) {
      expect(landmark.name.trim().length).toBeGreaterThan(0);
      expect(landmark.history.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
      expect(landmark.source.url).toMatch(/^https?:\/\//);
      expect(landmark.coordinates).toHaveLength(2);
      const [lng, lat] = landmark.coordinates;
      expect(lat).toBeGreaterThan(54.76);
      expect(lat).toBeLessThan(54.8);
      expect(lng).toBeGreaterThan(-1.6);
      expect(lng).toBeLessThan(-1.54);
    }
  });

  it("ships ≥2 valid story bands including bailey-crawl for deep links", () => {
    expect(bands.length).toBeGreaterThanOrEqual(2);
    expect(bands.some((b) => b.id === "bailey-crawl")).toBe(true);
    expect(bands.map((b) => b.id)).toEqual(
      expect.arrayContaining(["bailey-crawl", "elvet-claypath"]),
    );
    expect(validateAllStoryBands(bands, landmarks)).toEqual({});
  });

  it("ships ≥2 curated crawls whose stop ids exist in the Durham slim index", () => {
    expect(crawls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(crawls.map((c) => c.id)).size).toBe(crawls.length);
    expect(crawls.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Bailey night", "Elvet wander"]),
    );
    for (const crawl of crawls) {
      expect(crawl.venueIds.length).toBeGreaterThanOrEqual(3);
      expect(crawl.venueIds.length).toBeLessThanOrEqual(6);
      expect(new Set(crawl.venueIds).size).toBe(crawl.venueIds.length);
      for (const venueId of crawl.venueIds) {
        expect(slimIds.has(venueId), `${crawl.id} missing slim id ${venueId}`).toBe(true);
      }
      if (crawl.startLandmarkId) {
        expect(
          landmarks.some((lm) => lm.id === crawl.startLandmarkId),
          `${crawl.id} startLandmarkId ${crawl.startLandmarkId}`,
        ).toBe(true);
      }
      if (crawl.placeStoryBandId) {
        expect(
          bands.some((b) => b.id === crawl.placeStoryBandId),
          `${crawl.id} placeStoryBandId ${crawl.placeStoryBandId}`,
        ).toBe(true);
      }
    }
  });

  it("keeps London selectors on the London catalogs", () => {
    expect(landmarksForCity("london").some((l) => l.id === "tower-bridge")).toBe(true);
    expect(storyBandsForCity("london")).toHaveLength(6);
    expect(curatedCrawlsForCity("london").length).toBeGreaterThanOrEqual(3);
    expect(landmarksForCity("durham").some((l) => l.id === "tower-bridge")).toBe(false);
    expect(storyBandsForCity("durham").some((b) => b.id === "river-history")).toBe(false);
  });

  it("points CityConfig.poisPath at a valid Durham POI seed", () => {
    expect(CITIES.durham.poisPath).toBe("/data/cities/durham/pois.json");
    const pois = JSON.parse(readFileSync(POIS_PATH, "utf8")) as Poi[];
    expect(pois.length).toBeGreaterThanOrEqual(12);
    expect(pois.length).toBeLessThanOrEqual(40);
    expect(pois.some((p) => /station/i.test(p.name))).toBe(true);
    for (const poi of pois) {
      expect(poi.id.length).toBeGreaterThan(0);
      expect(poi.name.length).toBeGreaterThan(0);
      expect(poi.coordinates).toHaveLength(2);
    }
  });
});
