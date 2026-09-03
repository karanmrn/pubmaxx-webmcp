// The map a reader is looking at loads first, and the sides fill in afterwards.
//
// Captain's standing law, verbatim: "when I click on a map, I want only that
// map load, and then it slowly, you know, moves to the other sides. Speed is
// the number one factor that can only differentiate us from Google Maps."
//
// MEASURED on production (2026-09-01, 390x844, storage cleared, counted up to
// the route's own readiness gate the way perf/route-budgets.json counts):
// a cold `/map` asked for 163 of London's 244 slim cells - lat 51.275 to
// 51.55, lng -0.5 to 0.175, the entire city - all inside one 250 ms window at
// t=450 ms, for a phone screen covering about four kilometres. 168 of the
// route's 242 same-origin requests were that read.
//
// Two faults, both here.
//
//  1. While the opening location question is open the map holds a PLACEHOLDER
//     viewport, centre [0, 0] at zoom 0. `boundsForOpeningView` turned that
//     into the whole world, and the opening shard read took it literally.
//  2. The settled-viewport read and the ring around it were one request set on
//     the caller's turn, so the sides raced the screen for connections before
//     the map was interactive.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  NEIGHBOUR_SHARD_RING,
  openingLoadViewportFor,
  scheduleSlimShardRingLoads,
  scheduleSlimShardViewportLoad,
  shardsForBounds,
  viewportNamesNowhere,
  VIEWPORT_SHARD_RING,
  type ShardManifest,
} from "@/lib/slimShards";

const HOLD_VIEW = { center: [0, 0] as [number, number], zoom: 0 };
const LONDON_VIEW = { center: [-0.12, 51.52] as [number, number], zoom: 12 };

/** The bounds rule the map uses, restated here only to feed the manifest. */
function boundsForOpeningView(
  viewport: { center: [number, number]; zoom: number },
  width = 390,
  height = 844,
) {
  const scale = 512 * 2 ** viewport.zoom;
  const longitudeDelta = (width * 180) / scale;
  const latitudeDelta = (height * 180 * 1.4) / scale;
  const [lng, lat] = viewport.center;
  return {
    west: lng - longitudeDelta,
    south: Math.max(-85, lat - latitudeDelta),
    east: lng + longitudeDelta,
    north: Math.min(85, lat + latitudeDelta),
  };
}

/** The shipped London manifest: the real 244 cells this defect was measured on. */
function londonManifest(): ShardManifest {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "public/data/venues_slim.manifest.json"), "utf8"),
  ) as { grid: ShardManifest["grid"]; shards: Array<Record<string, unknown>> };
  return {
    ...(raw as unknown as ShardManifest),
    shards: raw.shards.map((shard) => ({
      ...(shard as unknown as ShardManifest["shards"][number]),
      url: `/data/venues_slim.cell.${String(shard.id)}.json`,
    })),
  };
}

describe("a viewport that names nowhere may not be read from", () => {
  it("recognises the placeholder the map holds while location is unresolved", () => {
    expect(viewportNamesNowhere(HOLD_VIEW)).toBe(true);
    expect(viewportNamesNowhere(LONDON_VIEW)).toBe(false);
  });

  it("answers the city's own view instead, and leaves a real one alone", () => {
    expect(openingLoadViewportFor(HOLD_VIEW, LONDON_VIEW)).toBe(LONDON_VIEW);
    expect(openingLoadViewportFor(LONDON_VIEW, HOLD_VIEW)).toBe(LONDON_VIEW);
  });

  it("stops the cold open asking for the whole city", () => {
    const manifest = londonManifest();
    expect(manifest.shards.length).toBeGreaterThan(200);

    const wholeWorld = shardsForBounds(
      manifest,
      boundsForOpeningView(HOLD_VIEW),
      0,
      true,
    );
    // What shipped: effectively every cell London has.
    expect(wholeWorld.length).toBeGreaterThan(150);

    const onScreen = shardsForBounds(
      manifest,
      boundsForOpeningView(openingLoadViewportFor(HOLD_VIEW, LONDON_VIEW)),
      0,
      true,
    );
    expect(onScreen.length).toBeLessThan(40);
    expect(onScreen.length).toBeGreaterThan(0);
  });
});

describe("the viewport loads on this turn, the ring on idle", () => {
  it("keeps the two rings apart, with the viewport as the nearer one", () => {
    expect(VIEWPORT_SHARD_RING).toBe(0);
    expect(NEIGHBOUR_SHARD_RING).toBe(1);
    expect(VIEWPORT_SHARD_RING).toBeLessThan(NEIGHBOUR_SHARD_RING);
  });

  it("runs a target load immediately and a refresh on idle", () => {
    const immediate = vi.fn();
    scheduleSlimShardViewportLoad(immediate, "target", {
      requestIdleCallback: () => 0,
      setTimeout: () => 0,
    });
    expect(immediate).toHaveBeenCalledTimes(1);

    const deferred = vi.fn();
    const idle: Array<() => void> = [];
    scheduleSlimShardViewportLoad(deferred, "refresh", {
      requestIdleCallback: (callback) => {
        idle.push(callback as unknown as () => void);
        return 0;
      },
      setTimeout: () => 0,
    });
    expect(deferred).not.toHaveBeenCalled();
    idle[0]?.();
    expect(deferred).toHaveBeenCalledTimes(1);
  });

  it("starts every settled viewport immediately and defers only its neighbour ring", () => {
    const idle: Array<() => void> = [];
    const timing = {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        idle.push(callback as unknown as () => void);
        return 0;
      },
      setTimeout: vi.fn(),
    };
    const targetViewport = vi.fn();
    const targetNeighbour = vi.fn();
    const refreshViewport = vi.fn();
    const refreshNeighbour = vi.fn();

    scheduleSlimShardRingLoads(targetViewport, targetNeighbour, timing);
    scheduleSlimShardRingLoads(refreshViewport, refreshNeighbour, timing);

    expect(targetViewport).toHaveBeenCalledTimes(1);
    expect(refreshViewport).toHaveBeenCalledTimes(1);
    expect(targetNeighbour).not.toHaveBeenCalled();
    expect(refreshNeighbour).not.toHaveBeenCalled();

    idle.forEach((callback) => callback());

    expect(targetNeighbour).toHaveBeenCalledTimes(1);
    expect(refreshNeighbour).toHaveBeenCalledTimes(1);
  });

  it("sends the ring through the idle lane, whatever the settle was", () => {
    const source = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
    const lane = source.slice(source.indexOf("const scheduleRingLoad = useCallback("));
    const body = lane.slice(0, lane.indexOf("[mergeSlimVenues, refreshCountCoverage]"));

    expect(body).toContain("loadRing(VIEWPORT_SHARD_RING)");
    expect(body).toContain("loadRing(NEIGHBOUR_SHARD_RING");
    expect(body).toContain("scheduleSlimShardRingLoads(");
    expect(body).not.toContain('scheduleRingLoad(loader, bounds, "target")');
    expect(body).not.toContain('scheduleRingLoad(loader, bounds, "refresh")');
    expect(body).not.toContain("inBounds(bounds, 1)");
  });

  it("reads the opening bounds through the placeholder guard", () => {
    const source = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
    expect(source).toContain("openingLoadViewportFor(initialShardStart.viewport");
    expect(source).not.toContain(
      "boundsForOpeningView(initialShardStart.viewport)",
    );
  });
});
