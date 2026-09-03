import { describe, expect, it } from "vitest";

import { CITIES } from "@/lib/cities";
import { nearestEnabledCity } from "@/lib/nearestCity";

describe("nearestEnabledCity", () => {
  it("resolves Manchester coords to manchester", () => {
    const [lng, lat] = CITIES.manchester.mapView.center;
    expect(nearestEnabledCity(lat, lng)).toBe("manchester");
    expect(nearestEnabledCity(53.48, -2.24)).toBe("manchester");
  });

  it("resolves London coords to london", () => {
    const [lng, lat] = CITIES.london.mapView.center;
    expect(nearestEnabledCity(lat, lng)).toBe("london");
    expect(nearestEnabledCity(51.52, -0.12)).toBe("london");
  });

  it("returns null for mid-ocean points far from every city", () => {
    expect(nearestEnabledCity(0, -30)).toBeNull();
    expect(nearestEnabledCity(40, -40)).toBeNull();
  });

  it("picks the closest in-bounds city when several could match", () => {
    // Bath center is inside Bath bounds; Bristol is nearby but outside Bath box.
    const [lng, lat] = CITIES.bath.mapView.center;
    expect(nearestEnabledCity(lat, lng)).toBe("bath");
  });

  it("falls back to nearest center within ~80km when outside all bounds", () => {
    // Just south of Manchester bounds (latMax 53.55) — still near the centre.
    expect(nearestEnabledCity(53.6, -2.24)).toBe("manchester");
  });
});
