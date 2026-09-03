import { describe, expect, it } from "vitest";

import {
  UNPRICED_VENUE_TRUST_LINE,
  mapPriceTrustBeats,
} from "@/lib/mapPriceTrust";
import { COMMUNITY_PROVISIONAL_SHORT_NOTE } from "@/lib/communityPrice";

describe("mapPriceTrustBeats", () => {
  it("covers trusted, provisional, and unknown without inventing a fourth story", () => {
    const beats = mapPriceTrustBeats();
    expect(beats.map((beat) => beat.id)).toEqual([
      "trusted",
      "provisional",
      "unknown",
    ]);
    expect(beats.find((beat) => beat.id === "provisional")?.detail).toBe(
      COMMUNITY_PROVISIONAL_SHORT_NOTE,
    );
    expect(beats.find((beat) => beat.id === "unknown")?.detail).toMatch(/trusted pint price/i);
  });

  it("keeps the unpriced sheet line honest about grey pins", () => {
    expect(UNPRICED_VENUE_TRUST_LINE).toMatch(/Grey on the map/);
    expect(UNPRICED_VENUE_TRUST_LINE).not.toMatch(/!/);
  });
});
