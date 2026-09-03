import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// Hermetic weather: the live refresh workflow rewrites the shipped snapshot,
// and this file only ever asserts the culture opener beside the route.
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: () => null,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => undefined }),
}));

import { POST } from "@/app/api/plans/generate/route";
import {
  CULTURE_CRAWL_CHIPS,
  CULTURE_WAYPOINT_MAX_KM,
  CULTURE_WAYPOINT_NONE_NOTE,
} from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import {
  createPlanIntakeDraft,
  planIntakeHandoff,
  skipRemainingPlanIntake,
} from "@/lib/planIntake";

// Exactly the body the describe-first surface sends: every wizard step skipped.
// The bare { query } shape takes the LEGACY selection path and would let a chip
// that the real grounded optimizer refuses pass this file.
const DESCRIBE_FIRST_INTAKE = planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft()));

async function generate(query: string) {
  const response = await POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify({ query, intake: DESCRIBE_FIRST_INTAKE }),
  }));
  return { status: response.status, body: await response.json() };
}

describe("Culture Crawl chips through POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(CULTURE_CRAWL_CHIPS)(
    "weaves a POI waypoint and three pub stops for $id",
    async (chip) => {
      const { status, body } = await generate(chip.query);
      expect(status).toBe(200);
      expect(body.grounded).toBe(true);
      expect(body.stops).toHaveLength(3);
      expect(body.cultureOpener).toBeTruthy();
      expect(body.cultureOpener.requested.length).toBeGreaterThan(0);
      expect(body.cultureOpener.waypoint, `${chip.id} lost its waypoint`).toBeTruthy();
      expect(body.cultureOpener.note).not.toBe(CULTURE_WAYPOINT_NONE_NOTE);
      expect(body.cultureOpener.waypoint.distanceKm).toBeLessThanOrEqual(CULTURE_WAYPOINT_MAX_KM);
    },
  );

  it("keeps the waypoint out of the Stops, the grounding proof and the totals", async () => {
    const { body } = await generate(CULTURE_CRAWL_CHIPS[0]!.query);
    const waypoint = body.cultureOpener.waypoint;
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).not.toContain(waypoint.poiId);
    expect(body.routeTotals.stopCount).toBe(3);
    expect(JSON.stringify(body.stops)).not.toContain(waypoint.poiId);
    // A waypoint carries no figure, so nothing about it can reach a price lane.
    expect(Object.keys(waypoint)).not.toContain("estimatedPintPricePence");
    expect(Object.keys(waypoint)).not.toContain("priceEvidence");
  });

  it("leaves an ordinary describe chip byte-identical", async () => {
    for (const chip of DESCRIBE_FIRST_CHIPS) {
      const { body } = await generate(chip);
      expect(Object.keys(body)).not.toContain("cultureOpener");
    }
  });
});
