import { describe, expect, it } from "vitest";

import {
  buildAreaDemandRequest,
  coerceAreaDemandSource,
  formatApproxKm,
  matchNightPatch,
  nearestSupportedPatch,
  normaliseArea,
  parseAreaDemandInput,
} from "@/lib/areaDemand";
import { NIGHT_PATCHES } from "@/lib/nightPatches";

describe("normaliseArea", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normaliseArea("  Broadway   Market ")).toBe("Broadway Market");
  });

  it("rejects empty / whitespace-only / non-string", () => {
    expect(normaliseArea("   ")).toBeNull();
    expect(normaliseArea("")).toBeNull();
    expect(normaliseArea(42)).toBeNull();
    expect(normaliseArea(null)).toBeNull();
  });

  it("caps to the domain max length", () => {
    const long = "a".repeat(200);
    expect(normaliseArea(long)).toHaveLength(80);
  });
});

describe("matchNightPatch", () => {
  it("matches a supported patch by label, case-insensitively", () => {
    expect(matchNightPatch("Soho")).toBe("soho");
    expect(matchNightPatch("  shoreditch ")).toBe("shoreditch");
  });

  it("matches central and unknown areas honestly", () => {
    expect(matchNightPatch("central London")).toBe("central");
    expect(matchNightPatch("Peckham")).toBeNull();
    expect(matchNightPatch("")).toBeNull();
  });
});

describe("nearestSupportedPatch", () => {
  it("returns the closest patch to a coordinate with a distance", () => {
    const soho = NIGHT_PATCHES.find((p) => p.id === "soho")!;
    const near = nearestSupportedPatch(soho.lat + 0.001, soho.lng + 0.001);
    expect(near?.patch.id).toBe("soho");
    expect(near?.distanceKm).toBeGreaterThanOrEqual(0);
    expect(near?.distanceKm).toBeLessThan(1);
  });

  it("returns a far patch for an out-of-town point, not null", () => {
    // Somewhere well outside London (Reading-ish) still resolves a nearest.
    const near = nearestSupportedPatch(51.4543, -0.9781);
    expect(near).not.toBeNull();
    expect(near!.distanceKm).toBeGreaterThan(20);
  });

  it("returns null for non-finite input", () => {
    expect(nearestSupportedPatch(Number.NaN, 0)).toBeNull();
  });
});

describe("formatApproxKm", () => {
  it("reads honestly with no false precision", () => {
    expect(formatApproxKm(0.4)).toBe("under 1 km");
    expect(formatApproxKm(6.25)).toBe("about 6.3 km");
    expect(formatApproxKm(-1)).toBe("");
  });
});

describe("coerceAreaDemandSource", () => {
  it("passes known sources and defaults unknown ones", () => {
    expect(coerceAreaDemandSource("near-empty")).toBe("near-empty");
    expect(coerceAreaDemandSource("area-picker")).toBe("area-picker");
    expect(coerceAreaDemandSource("nonsense")).toBe("map-miss");
    expect(coerceAreaDemandSource(undefined)).toBe("map-miss");
  });
});

describe("parseAreaDemandInput", () => {
  it("accepts an area with no email (demand without contact)", () => {
    const result = parseAreaDemandInput({ area: "Peckham", source: "area-picker" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.area).toBe("Peckham");
      expect(result.value.email).toBeNull();
      expect(result.value.source).toBe("area-picker");
      expect(result.value.matchedPatchId).toBeNull();
    }
  });

  it("accepts an area with an offered email", () => {
    const result = parseAreaDemandInput({ area: "Peckham", email: "Me@Example.com " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe("me@example.com");
  });

  it("re-derives a matched patch from a supported area name", () => {
    const result = parseAreaDemandInput({ area: "Soho" });
    expect(result.ok && result.value.matchedPatchId).toBe("soho");
  });

  it("400s a missing area", () => {
    const result = parseAreaDemandInput({ source: "map-miss" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_AREA");
  });

  it("400s a non-empty invalid email", () => {
    const result = parseAreaDemandInput({ area: "Peckham", email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_EMAIL");
  });
});

describe("buildAreaDemandRequest", () => {
  it("omits the email key entirely when blank", () => {
    const body = buildAreaDemandRequest({ area: "Peckham", source: "near-empty", email: "  " });
    expect(body).toEqual({ area: "Peckham", source: "near-empty" });
    expect("email" in body).toBe(false);
  });

  it("includes a trimmed email and matched patch when present", () => {
    const body = buildAreaDemandRequest({
      area: "Peckham",
      source: "near-empty",
      matchedPatchId: "soho",
      email: " me@example.com ",
    });
    expect(body).toEqual({
      area: "Peckham",
      source: "near-empty",
      matchedPatchId: "soho",
      email: "me@example.com",
    });
  });
});
