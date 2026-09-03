import { describe, expect, it } from "vitest";

import {
  MAX_SURFACE_DEPTH,
  ROOT_SURFACE_STACK,
  backActionLabel,
  backSurface,
  canGoBack,
  currentSurface,
  homeActionLabel,
  homeSurface,
  openSurface,
  parentSurface,
  rememberSurfaceState,
  surfaceDepth,
  surfaceTrail,
  type SurfaceStack,
} from "@/lib/surfaceStack";

type Held = { tab: string };

const area = { id: "area", title: "This area", state: { tab: "cheapest" } };
const nearMe = { id: "near-me", title: "Near me", state: { tab: "walk" } };
const venue = { id: "venue", title: "The Harp", state: { tab: "overview" } };

function stackOf(...ids: string[]): SurfaceStack<Held> {
  return ids.reduce<SurfaceStack<Held>>(
    (held, id) => openSurface(held, { id, title: id, state: { tab: "" } }),
    ROOT_SURFACE_STACK as SurfaceStack<Held>,
  );
}

describe("surface stack", () => {
  it("starts at the top level with nothing open", () => {
    expect(surfaceDepth(ROOT_SURFACE_STACK)).toBe(0);
    expect(currentSurface(ROOT_SURFACE_STACK)).toBeNull();
    expect(parentSurface(ROOT_SURFACE_STACK)).toBeNull();
    expect(canGoBack(ROOT_SURFACE_STACK)).toBe(false);
  });

  it("gives the first surface a home but no back", () => {
    const stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    expect(surfaceDepth(stack)).toBe(1);
    expect(canGoBack(stack)).toBe(false);
    expect(backActionLabel(stack)).toBeNull();
    expect(homeActionLabel("the map")).toBe("Close and return to the map");
  });

  it("names back after where it goes, not the direction", () => {
    const stack = openSurface(openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area), nearMe);
    expect(backActionLabel(stack)).toBe("Back to This area");
  });

  it("restores the parent's state rather than a default", () => {
    let stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    stack = rememberSurfaceState(stack, { tab: "dearest" });
    stack = openSurface(stack, nearMe);
    const back = backSurface(stack);
    expect(currentSurface(back)).toEqual({
      id: "area",
      title: "This area",
      state: { tab: "dearest" },
    });
  });

  it("steps back one level at a time from three deep", () => {
    let stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    stack = openSurface(stack, nearMe);
    stack = openSurface(stack, venue);
    expect(surfaceTrail(stack)).toEqual(["This area", "Near me", "The Harp"]);
    stack = backSurface(stack);
    expect(surfaceTrail(stack)).toEqual(["This area", "Near me"]);
    stack = backSurface(stack);
    expect(surfaceTrail(stack)).toEqual(["This area"]);
    stack = backSurface(stack);
    expect(surfaceTrail(stack)).toEqual([]);
  });

  it("reaches the top level in one action from any depth", () => {
    const stack = openSurface(openSurface(openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area), nearMe), venue);
    expect(surfaceDepth(homeSurface())).toBe(0);
    expect(surfaceDepth(stack)).toBe(3);
  });

  it("replaces rather than deepens when the same surface reopens", () => {
    let stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    stack = openSurface(stack, { ...area, state: { tab: "dearest" } });
    expect(surfaceDepth(stack)).toBe(1);
    expect(currentSurface(stack)?.state).toEqual({ tab: "dearest" });
  });

  it("treats a loop as a return, so back still reaches the top", () => {
    let stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    stack = openSurface(stack, nearMe);
    stack = openSurface(stack, area);
    expect(surfaceTrail(stack)).toEqual(["This area"]);
    expect(canGoBack(stack)).toBe(false);
  });

  it("bounds the trail rather than logging every surface ever opened", () => {
    const ids = Array.from({ length: MAX_SURFACE_DEPTH + 4 }, (_, index) => `s${index}`);
    const stack = stackOf(...ids);
    expect(surfaceDepth(stack)).toBe(MAX_SURFACE_DEPTH);
    expect(currentSurface(stack)?.id).toBe(`s${ids.length - 1}`);
  });

  it("leaves the stack alone when a remembered state has not moved", () => {
    const stack = openSurface(ROOT_SURFACE_STACK as SurfaceStack<Held>, area);
    expect(rememberSurfaceState(stack, area.state)).toBe(stack);
    expect(rememberSurfaceState(ROOT_SURFACE_STACK as SurfaceStack<Held>, { tab: "x" })).toBe(
      ROOT_SURFACE_STACK,
    );
  });
});
