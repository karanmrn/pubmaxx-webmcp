import { describe, expect, it } from "vitest";

import type { CheckIn } from "@/lib/checkIn";
import { normalizeCheckIn } from "@/lib/feed";

function mk(over: Partial<CheckIn> = {}): CheckIn {
  return {
    id: "ci-1",
    handle: "Karan",
    areaSlug: "shoreditch",
    venueId: null,
    note: "garden's rammed",
    visibility: "friends",
    createdAt: "2026-07-18T21:00:00.000Z",
    expiresAt: "2026-07-19T09:00:00.000Z",
    ...over,
  };
}

describe("normalizeCheckIn", () => {
  it("maps a check-in to a check_in FeedItem with an area name", () => {
    const item = normalizeCheckIn(mk());
    expect(item.type).toBe("check_in");
    expect(item.handle).toBe("karan");
    expect(item.caption).toBe("garden's rammed");
    // Shoreditch is a known night-area slug — its display name is resolved.
    expect(item.areaName).toBe("Shoreditch");
    expect(item.photoUrls).toEqual([]);
    expect(item.priceGbp).toBeNull();
  });

  it("never surfaces a raw venue id as the area name", () => {
    const item = normalizeCheckIn(mk({ venueId: "venue-abc" }));
    expect(item.areaName).toBe("Shoreditch");
    // A tagged venue still populates the map link, but the card leads with area.
    expect(item.venueMapUrl).toContain("venue-abc");
  });

  it("never fabricates a place name for an unresolved area slug", () => {
    const item = normalizeCheckIn(mk({ areaSlug: "atlantis" as CheckIn["areaSlug"] }));
    expect(item.areaName).toBeUndefined();
  });

  it("reads as a plain 'out tonight' signal for a genuinely no-area check-in", () => {
    const item = normalizeCheckIn(mk({ areaSlug: null, note: null }));
    expect(item.type).toBe("check_in");
    expect(item.areaName).toBeUndefined();
    expect(item.caption).toBe("");
  });
});
