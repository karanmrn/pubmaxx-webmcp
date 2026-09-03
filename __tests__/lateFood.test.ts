import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/late-food/route";
import {
  LATE_FOOD_AREAS,
  LATE_FOOD_TERMINALS,
  getLateFoodForArea,
  isLateFoodOpenAt,
  normalizeLateFoodArea,
  rankFoodHandoff,
  shortlistFoodHandoffs,
  type LateFoodApiErrorResponse,
  type LateFoodApiSuccessResponse,
} from "@/lib/lateFood";

const SNAPSHOT_NOW = Date.parse("2026-07-16T23:00:00.000Z");

describe("rankFoodHandoff", () => {
  it("orders by walking time and leaves an unmeasured detour last", () => {
    const candidates = [
      { id: "far", walkingDetour: { minutes: 14 } },
      { id: "nearest", walkingDetour: { minutes: 3 } },
      { id: "unknown", walkingDetour: { minutes: null } },
      { id: "middle", walkingDetour: { minutes: 8 } },
      { id: "near", walkingDetour: { minutes: 5 } },
    ];

    expect(rankFoodHandoff(candidates).map((c) => c.id)).toEqual([
      "nearest",
      "near",
      "middle",
      "far",
      "unknown",
    ]);
    expect(candidates.map((c) => c.id)).toEqual([
      "far",
      "nearest",
      "unknown",
      "middle",
      "near",
    ]);
  });

  it("keeps validation uncapped while shortlists return at most three", () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      walkingDetour: { minutes: i },
    }));
    const ranked = rankFoodHandoff(candidates);
    expect(ranked).toHaveLength(7);
    expect(shortlistFoodHandoffs(ranked).map((candidate) => candidate.id)).toEqual([
      "c0",
      "c1",
      "c2",
    ]);
    expect(shortlistFoodHandoffs(ranked, 99)).toHaveLength(3);
  });
});

describe("late-food evidence catalogue", () => {
  it("represents all 20 Night Areas with at least one grounded option", () => {
    expect(LATE_FOOD_AREAS).toHaveLength(20);
    expect(normalizeLateFoodArea("shoreditch")).toBe("shoreditch");
    expect(
      getLateFoodForArea("shoreditch", [], { now: SNAPSHOT_NOW }),
    ).toHaveLength(1);
    expect(
      getLateFoodForArea("clapham", [], { now: SNAPSHOT_NOW }),
    ).toHaveLength(1);
  });

  it("exposes only the official-source option that passed the evidence gate", () => {
    const terminals = getLateFoodForArea("piccadilly-soho", [], {
      now: SNAPSHOT_NOW,
      from: { lat: 51.5105, lng: -0.134 },
    });

    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      name: "Balans No.60",
      provenance: {
        kind: "official_operator",
        sourceUrl: "https://balans.co.uk/locations/soho-no-60/",
      },
      walkingDetour: {
        minutes: expect.any(Number),
        distanceKm: expect.any(Number),
        basis: "straight-line-from-final-stop",
      },
      anchor: {
        label: expect.any(String),
        price: expect.any(Number),
        sourceUrl: expect.stringMatching(/^https:\/\//),
        observedAt: expect.any(String),
      },
    });
    expect(LATE_FOOD_TERMINALS).toHaveLength(20);
    expect(terminals[0]).not.toHaveProperty("prices");
  });

  it("uses structured London hours and never treats unknown dietary evidence as a match", () => {
    const terminal = getLateFoodForArea("piccadilly-soho", [], {
      now: SNAPSHOT_NOW,
    })[0]!;
    expect(isLateFoodOpenAt(terminal.hours, "2026-07-17T00:00:00.000Z")).toBe(
      true,
    );
    expect(isLateFoodOpenAt(terminal.hours, "2026-07-17T05:00:00.000Z")).toBe(
      false,
    );
    expect(
      getLateFoodForArea("piccadilly-soho", ["vegan"], { now: SNAPSHOT_NOW }),
    ).toEqual([]);
  });

  it("treats a bare food need as food-requested, not a cuisine name filter", () => {
    const unfiltered = getLateFoodForArea("shoreditch", [], { now: SNAPSHOT_NOW });
    expect(getLateFoodForArea("shoreditch", ["food"], { now: SNAPSHOT_NOW })).toEqual(
      unfiltered,
    );
    expect(getLateFoodForArea("shoreditch", ["meal", "eat"], { now: SNAPSHOT_NOW })).toEqual(
      unfiltered,
    );
  });

  it("filters an evidenced option when it is closed at the requested time", () => {
    expect(
      getLateFoodForArea("piccadilly-soho", [], {
        now: SNAPSHOT_NOW,
        at: "2026-07-17T00:00:00.000Z",
      }),
    ).toHaveLength(1);
    expect(
      getLateFoodForArea("piccadilly-soho", [], {
        now: SNAPSHOT_NOW,
        at: "2026-07-17T05:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("GET /api/late-food", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SNAPSHOT_NOW));
  });

  afterEach(() => vi.useRealTimers());

  it("uses requested time and the actual final-stop origin", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/late-food?near=soho&at=2026-07-17T00%3A00%3A00.000Z&fromLat=51.5105&fromLng=-0.134&limit=1",
      ),
    );
    const body: LateFoodApiSuccessResponse = await response.json();

    expect(response.status).toBe(200);
    // Curated static terminals; body is a pure function of the query + deploy → CDN-cacheable.
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
    expect(response.headers.get("Cache-Control")).toContain(
      "stale-while-revalidate",
    );
    expect(body.requestedAt).toBe("2026-07-17T00:00:00.000Z");
    expect(body.terminals).toEqual([
      expect.objectContaining({
        area: "piccadilly-soho",
        openAtRequestedTime: true,
        walkingDetour: expect.objectContaining({
          basis: "straight-line-from-final-stop",
        }),
      }),
    ]);
    expect(body.rankingSignals).toEqual(
      expect.arrayContaining([
        "open_at_requested_time",
        "distance_from_actual_final_stop",
      ]),
    );
  });

  it("returns honest empty coverage when the grounded option is closed", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/late-food?near=shoreditch&at=2026-07-17T03%3A00%3A00.000Z",
      ),
    );
    const body: LateFoodApiSuccessResponse = await response.json();
    expect(response.status).toBe(200);
    expect(body.area).toBe("shoreditch");
    expect(body.terminals).toEqual([]);
    expect(body.missingEvidence).toContain("eligible_late_food_options");
  });

  it("rejects invalid area, time and partial origin with the flat contract", async () => {
    for (const url of [
      "http://localhost/api/late-food?near=not-a-night-area",
      "http://localhost/api/late-food?near=soho&at=late_night",
      "http://localhost/api/late-food?near=soho&fromLat=51.5",
    ]) {
      const response = await GET(new Request(url));
      const body: LateFoodApiErrorResponse = await response.json();
      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: expect.any(String),
        code: expect.any(String),
        retryable: false,
        terminals: [],
        details: { terminals: [] },
      });
    }
  });
});
