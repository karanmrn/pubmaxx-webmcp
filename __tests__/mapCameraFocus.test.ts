// Picking an area must move the map, every time.
//
// DEFECT (captain, live, 2026-09-01, mobile): the map header read
// "Piccadilly & Soho" over a viewport of rural Cumbria. The chip is written
// from the remembered area, so it changed; the camera did not.
//
// The canvas takes ONE focus prop fed by TWO owners - the opening-location
// answer and the area lane - and each kept its own counter starting at 1 while
// the canvas remembered one bare number. A reader whose opening location had
// flown at token 1 then picked an area, that pick arrived as token 1, and the
// canvas read it as a move it had already made.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  mapCameraFocusKey,
  mapCameraFocusMoves,
  type MapCameraFocus,
} from "@/lib/mapCameraFocus";

const LONDON: [number, number] = [-0.1341, 51.5108];
const CUMBRIA: [number, number] = [-2.3216, 54.5232];

function focus(
  source: MapCameraFocus["source"],
  token: number,
  center: [number, number],
): MapCameraFocus {
  return { center, zoom: 14, source, token };
}

describe("two camera owners can never mint the same identity", () => {
  it("keys a focus by its owner as well as its count", () => {
    expect(mapCameraFocusKey(focus("opening-location", 1, CUMBRIA))).not.toBe(
      mapCameraFocusKey(focus("area", 1, LONDON)),
    );
  });

  it("moves the camera on the captain's journey: locate, then pick an area", () => {
    // 1. The opening location answers and the canvas flies to it.
    const located = focus("opening-location", 1, CUMBRIA);
    expect(mapCameraFocusMoves(located, null)).toBe(true);
    const afterLocate = mapCameraFocusKey(located);

    // 2. The reader picks Piccadilly & Soho. The area lane's own counter also
    //    starts at 1, and this is the move that used to be swallowed.
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, afterLocate)).toBe(true);
  });

  it("still refuses to re-fly the move it has already made", () => {
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, mapCameraFocusKey(picked))).toBe(false);
  });

  it("flies again when the same owner asks a second time", () => {
    const first = focus("area", 1, LONDON);
    const second = focus("area", 2, LONDON);
    expect(mapCameraFocusMoves(second, mapCameraFocusKey(first))).toBe(true);
  });

  it("has nothing to do with no focus at all", () => {
    expect(mapCameraFocusMoves(null, null)).toBe(false);
    expect(mapCameraFocusMoves(undefined, "area:1")).toBe(false);
  });
});

describe("the canvas holds the identity, never a bare number", () => {
  const canvas = readFileSync(
    join(__dirname, "..", "components/PubMapCanvas.tsx"),
    "utf8",
  );

  it("compares through the shared rule", () => {
    expect(canvas).toContain("mapCameraFocusMoves(focusPoint, focusKeyRef.current)");
    // The number-only compare is what let one owner's move look like another's.
    expect(canvas).not.toContain("focusPoint.token === focusTokenRef.current");
  });
});

describe("both camera owners name themselves", () => {
  const pubMap = readFileSync(
    join(__dirname, "..", "components/PubMap.tsx"),
    "utf8",
  );

  it("stamps a source on every focus it mints", () => {
    expect(pubMap).toContain('source: "opening-location"');
    expect(pubMap).toContain('source: "area"');
  });

  it("keeps the area lane as the ONE deliberate move", () => {
    // moveMapCameraTo is the single door the choose-area pick, the Area
    // sheet's "go somewhere else" and a map-search select all go through.
    expect(pubMap).toContain("const moveMapCameraTo = useCallback(");
    expect(pubMap).toContain("setAreaFocus((prev) => ({");
  });
});
