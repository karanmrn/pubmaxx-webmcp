// A Plan Stop id is a listed venue OR a `place:<poi id>` meeting point, and
// nothing else. Open plans are the reason the second shape exists: the host
// picks a named public place, and the stop write has to be able to store it.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: vi.fn(async (cityId: string) =>
    cityId === "london"
      ? [
          { id: "venue-angel-islington", name: "The Angel" },
          { id: "venue-camden-arms", name: "Camden Arms" },
          { id: "venue-soho-tavern", name: "Soho Tavern" },
        ]
      : [],
  ),
}));

vi.mock("@/lib/cultureCrawl.server", () => ({
  cultureWaypointPois: (cityId: string) =>
    cityId === "london"
      ? [
          {
            id: "tube-kings-cross-st-pancras",
            name: "King's Cross St Pancras",
            category: "tube",
            coordinates: [-0.124, 51.5308],
          },
        ]
      : [],
}));

import { canonicalPlanRoute, planStopResolver } from "@/lib/planRoute";

describe("plan stop ids", () => {
  it("stores a named public place under its canonical POI name", async () => {
    const resolve = await planStopResolver("london");
    expect(resolve({ venueId: "place:tube-kings-cross-st-pancras" })).toEqual({
      venueId: "place:tube-kings-cross-st-pancras",
      venueName: "King's Cross St Pancras",
    });
  });

  it("refuses a place id the POI layer does not hold, and free text", async () => {
    const resolve = await planStopResolver("london");
    expect(resolve({ venueId: "place:nowhere-at-all" })).toBeNull();
    expect(resolve({ venueId: "place:" })).toBeNull();
    expect(resolve({ venueId: "by the canal near the bridge" })).toBeNull();
    expect(resolve({ venueId: "venue-not-listed" })).toBeNull();
  });

  it("rebuilds a route whose Stop 1 is a place", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "venue-camden-arms" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toEqual([
      {
        venueId: "place:tube-kings-cross-st-pancras",
        venueName: "King's Cross St Pancras",
        position: 0,
      },
      { venueId: "venue-camden-arms", venueName: "Camden Arms", position: 1 },
      { venueId: "venue-soho-tavern", venueName: "Soho Tavern", position: 2 },
    ]);
  });

  it("refuses a whole route when one stop does not resolve", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "venue-angel-islington" },
        { venueId: "place:nowhere-at-all" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toBeNull();
  });

  it("refuses a route that names the same place twice", async () => {
    await expect(
      canonicalPlanRoute([
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "place:tube-kings-cross-st-pancras" },
        { venueId: "venue-soho-tavern" },
      ]),
    ).resolves.toBeNull();
  });
});
