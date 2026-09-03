import { describe, expect, it } from "vitest";
import { COMPASS_ROTATED_EPSILON, resolveCompassAction } from "@/lib/mapCompass";

const LONDON = { pitch: 38, bearing: -8 };

describe("resolveCompassAction", () => {
  it("resets to north whenever map is rotated in either direction", () => {
    expect(resolveCompassAction(-8, LONDON)).toEqual({ kind: "reset-north" });
    expect(resolveCompassAction(12.25, LONDON)).toEqual({ kind: "reset-north" });
    expect(resolveCompassAction(359, LONDON)).toEqual({ kind: "reset-north" });
  });

  it("adopts city attitude when already at north", () => {
    expect(resolveCompassAction(0, LONDON)).toEqual({
      kind: "adopt-attitude",
      bearing: -8,
      pitch: 38,
    });
  });

  it("treats sub-epsilon bearings as north", () => {
    expect(resolveCompassAction(COMPASS_ROTATED_EPSILON, LONDON).kind).toBe("adopt-attitude");
    expect(resolveCompassAction(-0.4, LONDON).kind).toBe("adopt-attitude");
    expect(resolveCompassAction(COMPASS_ROTATED_EPSILON + 0.01, LONDON).kind).toBe("reset-north");
  });

  it("does nothing at north without designed attitude", () => {
    expect(resolveCompassAction(0, {})).toEqual({ kind: "none" });
    expect(resolveCompassAction(0, { pitch: 0, bearing: 0 })).toEqual({ kind: "none" });
  });

  it("adopts an attitude when only one axis is set", () => {
    expect(resolveCompassAction(0, { pitch: 30 })).toEqual({
      kind: "adopt-attitude",
      bearing: 0,
      pitch: 30,
    });
    expect(resolveCompassAction(0, { bearing: -6 })).toEqual({
      kind: "adopt-attitude",
      bearing: -6,
      pitch: 0,
    });
  });
});
