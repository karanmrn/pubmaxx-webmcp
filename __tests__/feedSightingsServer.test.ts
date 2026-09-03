import { promises as fs, readFileSync } from "fs";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGHTING_MAX_AGE_HOURS } from "@/lib/feedSightings";

const { getVenueIndex } = vi.hoisted(() => ({
  getVenueIndex: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndex }));

import {
  loadFeedSightings,
  resetFeedSightingsForTests,
} from "@/app/feed/feedSightings.server";

const MIXED_CITY_OVERLAY = {
  version: 1,
  generatedAt: "2026-07-26T07:13:02.882Z",
  updates: [
    {
      venueKey: "bundobust|6, mill hill, leeds, ls1 5dq|53.79548|-1.54556",
      drinkName: "NIMBU PANI RADLER",
      category: "beer",
      priceGbp: 3.25,
      source: {
        label: "Bundobust menu",
        url: "https://bundobust.com/menu",
        licence: "Attributed use only.",
      },
      observedAt: "2026-07-26T07:12:24.229Z",
    },
    {
      venueKey: "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      drinkName: "Lucky Saint 0.5%",
      category: "beer",
      priceGbp: 4.6,
      source: {
        label: "Prospect of Whitby menu",
        url: "https://www.greeneking.co.uk/pubs/london/prospect-of-whitby",
        licence: "Attributed use only.",
      },
      observedAt: "2026-07-25T12:00:00.000Z",
    },
  ],
};

describe("feed sightings server boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-27T09:00:00.000Z"));
    resetFeedSightingsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("removes an in-window demo overlay when demo content is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "off");
    const demoOverlay = {
      version: 1,
      generatedAt: "2026-07-26T07:13:02.882Z",
      updates: [
        {
          ...MIXED_CITY_OVERLAY.updates[1],
          source: {
            label: "PUBMAXXING demo menu fixture",
            url: "https://pubmaxxing.com/data/drink_price_updates/latest.json",
            licence: "First-party demo fixture for UI coverage; not a live venue price.",
          },
        },
      ],
    };
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(demoOverlay));
    getVenueIndex.mockResolvedValue(
      new Map([
        [
          "venue-16pnwmm",
          {
            id: "venue-16pnwmm",
            name: "Prospect of Whitby",
            borough: "Tower Hamlets",
            lat: 51.5071,
            lng: -0.05113,
          },
        ],
      ]),
    );

    expect(await loadFeedSightings()).toEqual([]);
  });

  it("drops an out-of-city observation while retaining a resolved London venue", async () => {
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(MIXED_CITY_OVERLAY));
    getVenueIndex.mockResolvedValue(
      new Map([
        [
          "venue-16pnwmm",
          {
            id: "venue-16pnwmm",
            name: "Prospect of Whitby",
            borough: "Tower Hamlets",
            lat: 51.5071,
            lng: -0.05113,
          },
        ],
      ]),
    );

    const sightings = await loadFeedSightings();

    expect(sightings).toHaveLength(1);
    expect(sightings[0]).toMatchObject({
      venueId: "venue-16pnwmm",
      venueName: "Prospect of Whitby",
      venueMapUrl: "/map?sel=venue-16pnwmm",
      drink: "Lucky Saint 0.5%",
      priceLabel: "£4.60",
    });
    expect(sightings.some((sighting) => sighting.venueId === "venue-fla5g9")).toBe(false);
  });

  it("drops a resolved London venue whose price has aged past the recency window", async () => {
    const longGone = {
      ...MIXED_CITY_OVERLAY,
      updates: MIXED_CITY_OVERLAY.updates.map((row) => ({
        ...row,
        observedAt: "2026-06-01T12:00:00.000Z",
      })),
    };
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(longGone));
    getVenueIndex.mockResolvedValue(
      new Map([
        [
          "venue-16pnwmm",
          {
            id: "venue-16pnwmm",
            name: "Prospect of Whitby",
            borough: "Tower Hamlets",
            lat: 51.5071,
            lng: -0.05113,
          },
        ],
      ]),
    );

    expect(await loadFeedSightings()).toEqual([]);
  });

  it("re-ages the memoised overlay on every read rather than freezing the window", async () => {
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(MIXED_CITY_OVERLAY));
    getVenueIndex.mockResolvedValue(
      new Map([
        [
          "venue-16pnwmm",
          {
            id: "venue-16pnwmm",
            name: "Prospect of Whitby",
            borough: "Tower Hamlets",
            lat: 51.5071,
            lng: -0.05113,
          },
        ],
      ]),
    );

    expect(await loadFeedSightings()).toHaveLength(1);

    // Same process, same memoised read, a month later: the row has aged out and
    // the surface must go quiet rather than keep claiming recency.
    vi.setSystemTime(new Date("2026-08-27T09:00:00.000Z"));

    expect(await loadFeedSightings()).toEqual([]);
  });

  it("keeps the recency window equal to the overlay's own staleness budget", () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), "data/freshness_registry.json"), "utf8"),
    ) as { datasets: { id: string; stalenessBudgetHours: number | null }[] };
    const overlay = registry.datasets.find(
      (dataset) => dataset.id === "drink_price_updates",
    );

    expect(overlay?.stalenessBudgetHours).toBe(SIGHTING_MAX_AGE_HOURS);
  });
});
