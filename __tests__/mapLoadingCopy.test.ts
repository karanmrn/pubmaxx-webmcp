import { describe, expect, it } from "vitest";

import {
  MAP_LOADING_SLOW_AFTER_MS,
  MAP_LOADING_SLOW_LINE,
  mapLoadingHeld,
  mapLoadingPrimaryLine,
  mapLoadingProgressPercent,
} from "@/lib/mapLoadingCopy";
import { resolveMapDisplayName } from "@/lib/mapDisplayName";

describe("mapLoadingCopy", () => {
  it("names the city in the primary loading line", () => {
    expect(mapLoadingPrimaryLine("London")).toBe("Loading London pubs…");
    expect(mapLoadingPrimaryLine("Manchester")).toBe("Loading Manchester pubs…");
  });

  it("falls back when the city name is empty", () => {
    expect(mapLoadingPrimaryLine("")).toBe("Loading pubs…");
    expect(mapLoadingPrimaryLine("   ")).toBe("Loading pubs…");
  });

  it("keeps the slow line short and honest", () => {
    expect(MAP_LOADING_SLOW_LINE).toBe("Still loading pubs…");
  });
});

describe("mapLoadingProgressPercent", () => {
  const stage = {
    pinsRevealed: false,
    canvasReady: false,
    slimLoaded: false,
    slimPinCount: 0,
  };

  it("climbs one rung per signal and only tops out on painted pins", () => {
    expect(mapLoadingProgressPercent(stage)).toBe(12);
    expect(mapLoadingProgressPercent({ ...stage, slimLoaded: true })).toBe(35);
    expect(
      mapLoadingProgressPercent({ ...stage, slimLoaded: true, slimPinCount: 40 }),
    ).toBe(55);
    expect(
      mapLoadingProgressPercent({
        ...stage,
        slimLoaded: true,
        slimPinCount: 40,
        canvasReady: true,
      }),
    ).toBe(85);
    expect(
      mapLoadingProgressPercent({
        ...stage,
        slimLoaded: true,
        slimPinCount: 40,
        canvasReady: true,
        pinsRevealed: true,
      }),
    ).toBe(100);
  });

  it("does not top out on a reveal that landed before the index answered", () => {
    expect(mapLoadingProgressPercent({ ...stage, pinsRevealed: true })).toBe(85);
  });

  it("never claims a full load from a basemap alone", () => {
    expect(
      mapLoadingProgressPercent({ ...stage, canvasReady: true }),
    ).toBeLessThan(100);
  });
});

describe("MAP_LOADING_SLOW_AFTER_MS", () => {
  it("waits eight seconds before admitting the load is slow", () => {
    expect(MAP_LOADING_SLOW_AFTER_MS).toBe(8_000);
  });
});

describe("mapLoadingHeld", () => {
  const stage = {
    pinsRevealed: false,
    canvasReady: false,
    slimLoaded: false,
    slimPinCount: 0,
  };

  it("holds the frame until the pins are revealed", () => {
    expect(mapLoadingHeld(stage)).toBe(true);
    expect(mapLoadingHeld({ ...stage, canvasReady: true })).toBe(true);
    expect(
      mapLoadingHeld({ ...stage, slimLoaded: true, slimPinCount: 40 }),
    ).toBe(true);
  });

  // Above the phone breakpoint the canvas reveals on painted basemap tiles
  // alone, so a reveal can land while the slim index is still in flight.
  it("keeps holding a reveal that landed over an unanswered index", () => {
    expect(mapLoadingHeld({ ...stage, pinsRevealed: true })).toBe(true);
    expect(
      mapLoadingHeld({ ...stage, pinsRevealed: true, canvasReady: true }),
    ).toBe(true);
  });

  it("lifts once the reveal has pins behind it", () => {
    expect(
      mapLoadingHeld({ ...stage, pinsRevealed: true, slimLoaded: true }),
    ).toBe(false);
    expect(
      mapLoadingHeld({ ...stage, pinsRevealed: true, slimPinCount: 40 }),
    ).toBe(false);
  });
});

describe("resolveMapDisplayName", () => {
  it("names the city by default", () => {
    expect(resolveMapDisplayName({ cityDisplayName: "Manchester" })).toBe(
      "Manchester",
    );
  });

  it("names the country on an explicit UK browse", () => {
    expect(
      resolveMapDisplayName({ cityDisplayName: "London", ukNationalBrowse: true }),
    ).toBe("UK");
  });

  it("lets a place arrival name itself", () => {
    expect(
      resolveMapDisplayName({
        cityDisplayName: "London",
        ukNationalBrowse: true,
        placeName: "Llandudno",
      }),
    ).toBe("Llandudno");
  });

  it("ignores an empty place name rather than losing the map's name", () => {
    expect(
      resolveMapDisplayName({ cityDisplayName: "Bristol", placeName: "   " }),
    ).toBe("Bristol");
  });
});
