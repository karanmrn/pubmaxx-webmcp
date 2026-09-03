// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  VENUE_REVEAL_CINEMA_MS,
} from "@/lib/venueReveal";
import { useVenueReveal } from "@/components/map/useVenueReveal";
import VenueSheetSkeleton from "@/components/map/VenueSheetSkeleton";

function RevealHarness({ startedAt }: { startedAt: number }) {
  const { beginReveal, reveal, revealStyle } = useVenueReveal();

  useEffect(() => {
    beginReveal("venue-1", undefined, undefined, {
      form: "full",
      startedAt,
    });
  }, [beginReveal, startedAt]);

  return createElement("output", {
    "data-reveal": reveal
      ? `${reveal.form}:${String(reveal.active)}:${String(reveal.interrupted)}`
      : "none",
    "data-elapsed": reveal?.elapsedMs == null ? "none" : String(reveal.elapsedMs),
    style: revealStyle,
  });
}

function SkeletonHarness({ startedAt }: { startedAt: number }) {
  return createElement(VenueSheetSkeleton, {
    revealForm: "full",
    revealStartedAt: startedAt,
  });
}

describe("useVenueReveal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a completed full record when inspector mounts after entrance", async () => {
    const startedAt = Date.now() - VENUE_REVEAL_CINEMA_MS - 1;

    await act(async () => {
      root.render(createElement(RevealHarness, { startedAt }));
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.getAttribute("data-reveal")).toBe(
      "full:false:false",
    );
  });

  it("captures elapsed reveal time in state instead of reading the clock during render", async () => {
    const startedAt = Date.now();

    await act(async () => {
      root.render(createElement(RevealHarness, { startedAt }));
      await Promise.resolve();
    });

    const output = container.querySelector("output");
    expect(Number(output?.getAttribute("data-elapsed"))).toBeGreaterThanOrEqual(0);
    expect(output?.getAttribute("style")).toContain("--venue-reveal-elapsed:");
  });

  it("applies tap-relative elapsed time before a late skeleton paints", async () => {
    const startedAt = Date.now() - 300;

    await act(async () => {
      root.render(createElement(SkeletonHarness, { startedAt }));
      await Promise.resolve();
    });

    const skeleton = container.querySelector<HTMLElement>(".venueSheetSkeleton");
    const elapsed = Number.parseFloat(
      skeleton?.style.getPropertyValue("--venue-reveal-elapsed") ?? "NaN",
    );
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(700);
  });
});
