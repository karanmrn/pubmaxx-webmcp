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
  "bristol",
  "venues_slim.json",
);
const POIS_PATH = path.join(ROOT, "public", "data", "cities", "bristol", "pois.json");

const slim = (rowsFromSlimPayload(JSON.parse(readFileSync(SLIM_PATH, "utf8"))) ?? []) as SlimVenue[];
const slimIds = new Set(slim.map((v) => v.id));

describe("Bristol harbour editorial pack", () => {
  const landmarks = landmarksForCity("bristol");
  const bands = storyBandsForCity("bristol");
  const crawls = curatedCrawlsForCity("bristol");

  it("ships ≥8 sourced landmarks", () => {
    expect(landmarks.length).toBeGreaterThanOrEqual(8);
    expect(new Set(landmarks.map((l) => l.id)).size).toBe(landmarks.length);
    for (const landmark of landmarks) {
      expect(landmark.name.trim().length).toBeGreaterThan(0);
      expect(landmark.history.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
      expect(landmark.source.url).toMatch(/^https?:\/\//);
      expect(landmark.coordinates).toHaveLength(2);
      const [lng, lat] = landmark.coordinates;
      expect(lat).toBeGreaterThan(51.42);
      expect(lat).toBeLessThan(51.5);
      expect(lng).toBeGreaterThan(-2.65);
      expect(lng).toBeLessThan(-2.52);
    }
  });

  it("ships ≥3 valid story bands including harbourside for deep links", () => {
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(bands.some((b) => b.id === "harbourside")).toBe(true);
    expect(bands.map((b) => b.id)).toEqual(
      expect.arrayContaining(["harbourside", "king-street", "stokes-croft"]),
    );
    expect(validateAllStoryBands(bands, landmarks)).toEqual({});
  });

  it("ships ≥2 curated crawls whose stop ids exist in the Bristol slim index", () => {
    expect(crawls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(crawls.map((c) => c.id)).size).toBe(crawls.length);
    expect(crawls.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        "King Street classic",
        "Harbourside first night",
        "Clifton hillside",
      ]),
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
    expect(landmarksForCity("bristol").some((l) => l.id === "tower-bridge")).toBe(false);
    expect(storyBandsForCity("bristol").some((b) => b.id === "river-history")).toBe(false);
  });

  it("points CityConfig.poisPath at a valid Bristol POI seed", () => {
    expect(CITIES.bristol.poisPath).toBe("/data/cities/bristol/pois.json");
    const pois = JSON.parse(readFileSync(POIS_PATH, "utf8")) as Poi[];
    expect(pois.length).toBeGreaterThanOrEqual(20);
    expect(pois.length).toBeLessThanOrEqual(40);
    expect(pois.some((p) => /temple meads/i.test(p.name))).toBe(true);
    for (const poi of pois) {
      expect(poi.id.length).toBeGreaterThan(0);
      expect(poi.name.length).toBeGreaterThan(0);
      expect(poi.coordinates).toHaveLength(2);
      const [lng, lat] = poi.coordinates;
      expect(lat).toBeGreaterThan(51.42);
      expect(lat).toBeLessThan(51.5);
      expect(lng).toBeGreaterThan(-2.65);
      expect(lng).toBeLessThan(-2.52);
    }
  });
});
