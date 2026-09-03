import { beforeEach, describe, expect, it, vi } from "vitest";

import { haversineKm } from "@/lib/haversine";
import { legMinutes, WALK_KMH } from "@/lib/routeLegs";
import type { LngLat } from "@/lib/walkRoute";

const { fetchWalkLegRouteMock, orsApiKeyMock, walkRouteStoreMock } = vi.hoisted(() => ({
  fetchWalkLegRouteMock: vi.fn(),
  orsApiKeyMock: vi.fn<() => string | null>(() => null),
  walkRouteStoreMock: {
    getLeg: vi.fn<(_key: string) => Promise<unknown>>(async () => null),
    putLeg: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: fetchWalkLegRouteMock,
  orsApiKey: orsApiKeyMock,
}));

vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => walkRouteStoreMock,
}));

import { estimatePlanWalking, routePathDistanceKm } from "@/lib/walkRouteLegs";

const A: LngLat = [-0.141, 51.515];
const B: LngLat = [-0.135, 51.516];
const C: LngLat = [-0.13, 51.518];

function stop([lng, lat]: LngLat) {
  return { lng, lat };
}

beforeEach(() => {
  fetchWalkLegRouteMock.mockReset();
  fetchWalkLegRouteMock.mockResolvedValue(null);
  orsApiKeyMock.mockReset();
  orsApiKeyMock.mockReturnValue(null);
  walkRouteStoreMock.getLeg.mockReset();
  walkRouteStoreMock.getLeg.mockResolvedValue(null);
  walkRouteStoreMock.putLeg.mockReset();
  walkRouteStoreMock.putLeg.mockResolvedValue(undefined);
});

describe("estimatePlanWalking", () => {
  it("keyless: keeps straight-line route totals and never asks ORS or the store", async () => {
    const estimate = await estimatePlanWalking([stop(A), stop(B), stop(C)]);
    const straightKm = haversineKm(A, B) + haversineKm(B, C);

    expect(estimate.distanceBasis).toBe("straight-line");
    expect(estimate.straightLineWalkingKm).toBeCloseTo(straightKm, 6);
    expect(estimate.estimatedWalkingMinutes).toBe(Math.ceil((straightKm / WALK_KMH) * 60));
    expect(estimate.walkingMinutesFromPrevious).toEqual([
      null,
      legMinutes(haversineKm(A, B)),
      legMinutes(haversineKm(B, C)),
    ]);
    expect(walkRouteStoreMock.getLeg).not.toHaveBeenCalled();
    expect(fetchWalkLegRouteMock).not.toHaveBeenCalled();
  });

  it("uses ORS summary durations and stores routed coordinates when keyed", async () => {
    const durations = [125, 240];
    orsApiKeyMock.mockReturnValue("ork_secret");
    fetchWalkLegRouteMock.mockImplementation(async (from: LngLat, to: LngLat) => ({
      coordinates: [from, to],
      durationSeconds: durations.shift() ?? null,
    }));

    const estimate = await estimatePlanWalking([stop(A), stop(B), stop(C)]);

    expect(estimate.distanceBasis).toBe("routed");
    expect(estimate.estimatedWalkingMinutes).toBe(7);
    expect(estimate.walkingMinutesFromPrevious).toEqual([null, 3, 4]);
    expect(walkRouteStoreMock.getLeg).toHaveBeenCalledTimes(2);
    expect(walkRouteStoreMock.putLeg).toHaveBeenCalledTimes(2);
  });

  it("uses cached routed path length when no ORS duration is available", async () => {
    const cached: LngLat[] = [A, [-0.138, 51.516], B];
    orsApiKeyMock.mockReturnValue("ork_secret");
    walkRouteStoreMock.getLeg.mockResolvedValue(cached);

    const estimate = await estimatePlanWalking([stop(A), stop(B)]);

    expect(estimate.distanceBasis).toBe("routed");
    expect(estimate.walkingMinutesFromPrevious).toEqual([null, legMinutes(routePathDistanceKm(cached))]);
    expect(fetchWalkLegRouteMock).not.toHaveBeenCalled();
  });

  it("falls back to straight-line estimates when routing returns null", async () => {
    orsApiKeyMock.mockReturnValue("ork_secret");
    fetchWalkLegRouteMock.mockResolvedValue(null);

    const estimate = await estimatePlanWalking([stop(A), stop(B), stop(C)]);
    const straightKm = haversineKm(A, B) + haversineKm(B, C);

    expect(estimate.distanceBasis).toBe("straight-line");
    expect(estimate.estimatedWalkingMinutes).toBe(Math.ceil((straightKm / WALK_KMH) * 60));
    expect(estimate.walkingMinutesFromPrevious[1]).toBe(legMinutes(haversineKm(A, B)));
  });
});
