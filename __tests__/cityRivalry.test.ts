import { describe, expect, it } from "vitest";

import {
  buildCityRivalrySnapshot,
  cityRivalryLeaderboard,
  crawlPackCountForCity,
  rankCities,
  rivalryScore,
} from "@/lib/cityRivalry";
import { cityMapShareUrl } from "@/lib/cityShare";
import { demoPintDropsForCity } from "@/lib/pintDropSeeds";

describe("rivalryScore", () => {
  it("weights drops×3 + crawls×5 + min(venues,200)/10", () => {
    expect(rivalryScore({ dropCount: 10, crawlPackCount: 3, venueCount: 100 })).toBe(
      10 * 3 + 3 * 5 + 100 / 10,
    );
    expect(rivalryScore({ dropCount: 0, crawlPackCount: 0, venueCount: 500 })).toBe(20);
  });
});

describe("rankCities", () => {
  it("sorts by score descending and fills display names", () => {
    const ranked = rankCities([
      {
        cityId: "glasgow",
        dropCount: 0,
        crawlPackCount: 3,
        venueCount: 100,
        tagline: "Subway nights",
      },
      {
        cityId: "london",
        dropCount: 12,
        crawlPackCount: 12,
        venueCount: 200,
        tagline: "Capital crawls",
      },
      {
        cityId: "manchester",
        dropCount: 10,
        crawlPackCount: 3,
        venueCount: 150,
        tagline: "Tram home",
      },
    ]);
    expect(ranked.map((r) => r.cityId)).toEqual(["london", "manchester", "glasgow"]);
    expect(ranked[0].displayName).toBe("London");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[2].dropCount).toBe(0);
  });
});

describe("buildCityRivalrySnapshot / cityRivalryLeaderboard", () => {
  // Inject known venue counts so the test does not depend on reading multi-MB
  // slim JSON in CI — the pure rank path is what we assert.
  const venueOverrides = {
    london: 1033,
    manchester: 544,
    glasgow: 293,
    liverpool: 406,
    oxford: 97,
    durham: 30,
    bristol: 269,
    cambridge: 81,
    bath: 68,
  } as const;

  it("uses demo seeds only (no invented organics) and ranks enabled cities", () => {
    const board = buildCityRivalrySnapshot(venueOverrides);
    expect(board.length).toBeGreaterThanOrEqual(3);

    const byId = Object.fromEntries(board.map((e) => [e.cityId, e]));
    expect(byId.london.dropCount).toBe(demoPintDropsForCity("london").length);
    expect(byId.manchester.dropCount).toBe(demoPintDropsForCity("manchester").length);
    expect(byId.glasgow.dropCount).toBe(0);
    expect(byId.london.crawlPackCount).toBe(crawlPackCountForCity("london"));
    expect(byId.manchester.crawlPackCount).toBe(crawlPackCountForCity("manchester"));
    expect(byId.glasgow.crawlPackCount).toBe(crawlPackCountForCity("glasgow"));
    expect(byId.liverpool.crawlPackCount).toBe(crawlPackCountForCity("liverpool"));
    expect(byId.liverpool.crawlPackCount).toBeGreaterThanOrEqual(3);

    // London should lead on demo drops + crawl packs.
    expect(board[0].cityId).toBe("london");
    expect(board.every((e) => e.score === rivalryScore(e))).toBe(true);
  });

  it("does not credit London crawl packs to browse-only cities", () => {
    expect(crawlPackCountForCity("liverpool")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("oxford")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("glasgow")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("cambridge")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("durham")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("bristol")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("bath")).toBe(0);
  });

  it("cityRivalryLeaderboard aliases the snapshot", () => {
    expect(cityRivalryLeaderboard(venueOverrides)).toEqual(
      buildCityRivalrySnapshot(venueOverrides),
    );
  });

  it("rivalry city links use cityMapShareUrl (London /map, others /map/{id})", () => {
    const board = buildCityRivalrySnapshot(venueOverrides);
    const byId = Object.fromEntries(board.map((e) => [e.cityId, e]));
    expect(cityMapShareUrl(byId.london.cityId)).toBe("/map");
    expect(cityMapShareUrl(byId.bristol.cityId)).toBe("/map/bristol");
    expect(cityMapShareUrl(byId.manchester.cityId)).toBe("/map/manchester");
    expect(cityMapShareUrl(byId.glasgow.cityId)).toBe("/map/glasgow");
  });
});
