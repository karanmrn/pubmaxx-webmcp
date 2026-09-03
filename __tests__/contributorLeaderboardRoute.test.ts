import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { GET } from "@/app/api/contributors/route";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
} from "@/lib/communityPriceStore";
import {
  __resetVisitReports,
  memoryVisitReportStore,
} from "@/lib/visitReportsStore";
import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";

beforeEach(() => {
  __resetCommunityPrices();
  __resetVisitReports();
  __resetWeatherRecommendations();
  vi.restoreAllMocks();
});

describe("GET /api/contributors", () => {
  it("refuses to present process-memory contributions as an all-time record", async () => {
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-a",
        contributorHandle: "sam",
      },
      1_000,
    );
    await memoryVisitReportStore.create(
      {
        venueId: "v1",
        handle: "sam",
        visitedAt: "2026-07-27",
        busyness: "steady",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      2_000,
    );
    await memoryWeatherRecommendationStore.create(
      {
        venueId: "v1",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "alex",
        actorHash: "actor-b",
      },
      3_000,
    );
    await memoryVisitReportStore.create(
      {
        venueId: "v2",
        handle: "alex",
        visitedAt: "2026-07-26",
        busyness: "quiet",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      4_000,
    );

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/quality|actor|corroborated/i);
  });

  it("keeps an empty keyless record unavailable rather than implying absence", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
  });
});
