import { describe, expect, it } from "vitest";

import {
  MAP_SURFACE_HISTORY_KEY,
  mapSurfaceOpenTransition,
  readMapSurfaceHistory,
  stampMapSurfaceHistory,
} from "@/lib/mapSurfaceHistory";
import type { SurfaceStack } from "@/lib/surfaceStack";
import { mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";

type Held = { venueId: string; tab: string };

const planner = {
  id: "planner",
  title: "Plan an outing",
  state: { venueId: "", tab: "route" },
};
const venue = {
  id: "venue",
  title: "The French House",
  state: { venueId: "venue-french-house", tab: "pints" },
};

describe("Map surface history snapshot", () => {
  it("stamps full trail and venue sentinel under one owner state", () => {
    const stack: SurfaceStack<Held> = [planner, venue];

    expect(
      stampMapSurfaceHistory(
        { __NA: true, pubmaxSurfaceDepth: 2 },
        stack,
        "venue-french-house",
      ),
    ).toEqual({
      __NA: true,
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack,
      },
      pubmaxSelection: 1,
      venueId: "venue-french-house",
    });
  });

  it("clears a stale venue sentinel when planner or Map owns entry", () => {
    const state = stampMapSurfaceHistory(
      {
        __NA: true,
        pubmaxSelection: 1,
        venueId: "stale-venue",
      },
      [planner],
      "",
    );

    expect(state).toEqual({
      __NA: true,
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack: [planner],
      },
    });
  });

  it("reads valid owner snapshots and rejects malformed external state", () => {
    const valid = {
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack: [planner, venue],
      },
    };

    expect(readMapSurfaceHistory<Held>(valid)).toEqual([planner, venue]);
    expect(readMapSurfaceHistory(null)).toBeNull();
    expect(
      readMapSurfaceHistory({
        [MAP_SURFACE_HISTORY_KEY]: {
          version: 1,
          stack: [{ id: 4, title: "broken" }],
        },
      }),
    ).toBeNull();
    expect(
      readMapSurfaceHistory({
        [MAP_SURFACE_HISTORY_KEY]: {
          version: 2,
          stack: [],
        },
      }),
    ).toBeNull();
  });
});

describe("Map surface URL ownership", () => {
  it("preserves landed selection against a stale crawl-state write", () => {
    expect(
      mergeCrawlUrlSearch(
        "q=The+French+House",
        "?q=The+French+House&sel=venue-french-house",
      ),
    ).toBe("q=The+French+House&sel=venue-french-house");
  });
});

describe("Map surface open decision", () => {
  it("pushes a surface not yet in trail", () => {
    expect(mapSurfaceOpenTransition([planner], venue)).toEqual({
      kind: "push",
      stack: [planner, venue],
    });
  });

  it("replaces current venue without adding Back depth", () => {
    const nextVenue = {
      ...venue,
      title: "The Harp",
      state: { venueId: "venue-harp", tab: "overview" },
    };

    expect(mapSurfaceOpenTransition([planner, venue], nextVenue)).toEqual({
      kind: "replace",
      stack: [planner, nextVenue],
    });
  });

  it("writes a fresh entry when reopening a known parent", () => {
    expect(mapSurfaceOpenTransition([planner, venue], planner)).toEqual({
      kind: "push",
      stack: [venue, planner],
    });
  });
});
