import { describe, expect, it } from "vitest";

import { rememberedAreaCentre } from "@/app/today/todayArea";
import { CENTRAL_PATCH, NIGHT_PATCHES } from "@/lib/nightPatches";

describe("rememberedAreaCentre — /today's single 'near you' coordinate", () => {
  it("uses a remembered patch's own walking-heart coordinate", () => {
    const shoreditch = NIGHT_PATCHES.find((p) => p.id === "shoreditch")!;
    const centre = rememberedAreaCentre({ kind: "patch", id: "shoreditch" });
    expect(centre.id).toBe("shoreditch");
    expect(centre.lat).toBe(shoreditch.lat);
    expect(centre.lng).toBe(shoreditch.lng);
  });

  it("falls back to central London for no memory", () => {
    expect(rememberedAreaCentre(null)).toEqual(CENTRAL_PATCH);
  });

  it("falls back to central London for a remembered borough (no coordinate here)", () => {
    expect(rememberedAreaCentre({ kind: "borough", name: "Hackney" })).toEqual(CENTRAL_PATCH);
  });

  it("falls back to central London for an unknown patch id", () => {
    expect(rememberedAreaCentre({ kind: "patch", id: "atlantis" })).toEqual(CENTRAL_PATCH);
  });
});
