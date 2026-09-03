import { describe, expect, it } from "vitest";

import {
  CITY_CAPABILITY_PROFILES,
  getCityCapabilityProfile,
} from "@/lib/cityCapabilities";
import { listEnabledCities } from "@/lib/cities";

describe("city capability profiles", () => {
  it("covers every enabled city exactly once", () => {
    const enabled = listEnabledCities().map((city) => city.id).sort();
    const profiled = Object.keys(CITY_CAPABILITY_PROFILES).sort();

    expect(profiled).toEqual(enabled);
  });

  it("keeps London as the evidence-rich flagship", () => {
    const london = getCityCapabilityProfile("london");

    expect(london.releaseTier).toBe("flagship");
    expect(london.prices.availability).toBe("available");
    expect(london.prices.asOf).toBe("2026-07-03");
    expect(london.events.availability).toBe("available");
    expect(london.transport.availability).toBe("available");
  });

  it("does not imply that non-London cities have observed pint prices", () => {
    for (const city of listEnabledCities()) {
      if (city.id === "london") continue;
      const profile = getCityCapabilityProfile(city.id);
      expect(profile.prices.availability).toBe("unavailable");
      expect(profile.prices.asOf).toBeNull();
      expect(profile.prices.explanation).toBe(
        "We haven't yet collected pint prices for this city.",
      );
    }
  });

  it("marks Bath as browseable without inventing editorial or route coverage", () => {
    const bath = getCityCapabilityProfile("bath");

    expect(bath.map.availability).toBe("available");
    expect(bath.routes.availability).toBe("unavailable");
    expect(bath.heritage.availability).toBe("unavailable");
    expect(bath.releaseTier).toBe("core");
  });

  it("keeps Llandudno outside the V1 core cohort as a preview", () => {
    const llandudno = getCityCapabilityProfile("llandudno");

    expect(llandudno.releaseTier).toBe("preview");
  });

  it("falls back to London for an invalid external city value", () => {
    expect(getCityCapabilityProfile("not-a-city").cityId).toBe("london");
  });
});
