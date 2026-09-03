import { describe, expect, it } from "vitest";
import {
  INITIAL_TILE_FAILURE_SPEND,
  TILE_FAILURE_BURST,
  TILE_FAILURE_SUSTAIN_MS,
  TILE_FAILURE_WINDOW_MS,
  areBasemapTilesLoaded,
  classifyTileFailure,
  createBasemapTileFailureTracker,
  isCriticalBasemapFailure,
  basemapFailureSurface,
  markTileFailureSurfaced,
  markTileRetrySpent,
  pruneTileFailures,
  spendTileFailureDecision,
  tileFailureRecheckDelay,
  type TileFailureInput,
} from "@/lib/mapTileFailure";

describe("areBasemapTilesLoaded", () => {
  it("treats the transient style-less theme-swap frame as not ready", () => {
    const map = {
      getStyle: () => undefined,
      areTilesLoaded: () => {
        throw new Error("must not inspect tiles without a style");
      },
      isSourceLoaded: () => {
        throw new Error("must not inspect sources without a style");
      },
    };

    expect(areBasemapTilesLoaded(map)).toBe(false);
  });

  it("requires every vector or raster source and ignores GeoJSON overlays", () => {
    const map = {
      getStyle: () => ({
        sources: {
          openfreemap: { type: "vector" },
          terrain: { type: "raster-dem" },
          landmarks: { type: "geojson" },
        },
      }),
      areTilesLoaded: () => true,
      isSourceLoaded: (id: string) => id !== "terrain",
    };

    expect(areBasemapTilesLoaded(map)).toBe(false);
    map.isSourceLoaded = () => true;
    expect(areBasemapTilesLoaded(map)).toBe(true);
  });
});

describe("createBasemapTileFailureTracker", () => {
  it("requires every failed tile to recover before confirming recovery", () => {
    const tracker = createBasemapTileFailureTracker();
    tracker.recordFailure({
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2047/1360",
    });
    tracker.recordFailure({
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2048/1360",
    });

    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2049/1360",
      }),
    ).toBe(false);
    expect(tracker.hasFailures()).toBe(true);
    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2047/1360",
      }),
    ).toBe(false);
    expect(tracker.hasFailures()).toBe(true);
    expect(
      tracker.recordSuccess({
        sourceId: "openfreemap",
        sourceType: "vector",
        tileKey: "12/2048/1360",
      }),
    ).toBe(true);
    expect(tracker.hasFailures()).toBe(false);
  });

  it("scopes failed tiles to the current generation", () => {
    const tracker = createBasemapTileFailureTracker();
    const tile = {
      sourceId: "openfreemap",
      sourceType: "vector",
      tileKey: "12/2047/1360",
    };
    tracker.recordFailure(tile);
    tracker.reset();

    expect(tracker.recordSuccess(tile)).toBe(false);
    expect(tracker.hasFailures()).toBe(false);
  });

  it("ignores non-basemap and incomplete tile references", () => {
    const tracker = createBasemapTileFailureTracker();
    tracker.recordFailure({
      sourceId: "pubs",
      sourceType: "geojson",
      tileKey: "pubs",
    });
    tracker.recordFailure({
      sourceType: "vector",
      tileKey: "12/2047/1360",
    });

    expect(tracker.hasFailures()).toBe(false);
  });
});

describe("isCriticalBasemapFailure", () => {
  it("treats initial vector TileJSON failure as systemic without a tile burst", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(true);
  });

  it("does not promote an individual vector tile miss to critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "vector",
        tilePresent: true,
      }),
    ).toBe(false);
  });

  it("does not call a GeoJSON overlay or settled source critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: true,
        sourceType: "geojson",
        tilePresent: false,
      }),
    ).toBe(false);
    expect(
      isCriticalBasemapFailure({
        message: "AJAXError: Failed to fetch",
        initialBasemapPending: false,
        sourceType: "vector",
        tilePresent: false,
      }),
    ).toBe(false);
  });

  it("keeps sprite and glyph failures critical", () => {
    expect(
      isCriticalBasemapFailure({
        message: "Could not load sprite image",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
    expect(
      isCriticalBasemapFailure({
        message: "Could not load glyph range",
        initialBasemapPending: false,
        tilePresent: false,
      }),
    ).toBe(true);
  });
});

// A visible, settled-camera tab with a sustained burst and a full budget the
// individual cases mutate. Every rule passes here, so each test flips exactly
// one field to prove that rule. The stamps span the sustain requirement while
// staying inside the window.
const NOW = 60_000;
const SPREAD = Math.ceil(TILE_FAILURE_SUSTAIN_MS / (TILE_FAILURE_BURST - 1)) + 100;
const burst = Array.from({ length: TILE_FAILURE_BURST }, (_, i) => NOW - i * SPREAD);
const bursting: TileFailureInput = {
  now: NOW,
  errorTimestamps: burst,
  criticalFailure: false,
  documentVisible: true,
  cameraInFlight: false,
  retrySpent: false,
  recoveryBudgetLeft: 5,
};

describe("classifyTileFailure", () => {
  it("spends the one retry on a sustained burst with budget left", () => {
    expect(classifyTileFailure(bursting)).toBe("retry");
  });

  it("ignores a lone transient tile miss", () => {
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: [NOW] }),
    ).toBe("ignore");
  });

  it("ignores a fast self-healing blip (burst count without sustained span)", () => {
    // The live-observed class: a camera flight paints black, tiles catch up in
    // under 5s. Enough errors to look like a burst, but the span is short.
    const blip = Array.from(
      { length: TILE_FAILURE_BURST + 2 },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: blip }),
    ).toBe("ignore");
  });

  it("reclassifies a concurrent post-paint outage after the sustain window", () => {
    const concurrent = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: concurrent }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        now: NOW + TILE_FAILURE_SUSTAIN_MS,
        errorTimestamps: concurrent,
      }),
    ).toBe("retry");
  });

  it("retries a concentrated burst while the initial basemap is still pending", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
      }),
    ).toBe("retry");
  });

  it("surfaces a repeated initial burst after the bounded retry", () => {
    const initialBurst = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: initialBurst,
        initialBasemapPending: true,
        retrySpent: true,
      }),
    ).toBe("surface");
  });

  it("ignores tile bursts but not terminal resources while the camera is in flight", () => {
    expect(
      classifyTileFailure({ ...bursting, cameraInFlight: true }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        cameraInFlight: true,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores errors that have aged out of the window", () => {
    const stale = burst.map((t) => t - (TILE_FAILURE_WINDOW_MS + SPREAD * TILE_FAILURE_BURST));
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: stale }),
    ).toBe("ignore");
  });

  it("treats one sprite/glyph failure as systemic on its own", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW],
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("ignores tile bursts but not terminal resources while the tab is hidden", () => {
    expect(
      classifyTileFailure({ ...bursting, documentVisible: false }),
    ).toBe("ignore");
    expect(
      classifyTileFailure({
        ...bursting,
        documentVisible: false,
        criticalFailure: true,
      }),
    ).toBe("retry");
  });

  it("surfaces when the retry is already spent", () => {
    expect(classifyTileFailure({ ...bursting, retrySpent: true })).toBe(
      "surface",
    );
  });

  it("surfaces when the shared recovery budget is gone", () => {
    expect(
      classifyTileFailure({ ...bursting, recoveryBudgetLeft: 0 }),
    ).toBe("surface");
  });

  it("needs the full burst count even when the span is sustained", () => {
    const oneShort = burst.slice(0, TILE_FAILURE_BURST - 1);
    expect(
      classifyTileFailure({ ...bursting, errorTimestamps: oneShort }),
    ).toBe("ignore");
  });

  it("honors threshold, window, and sustain overrides", () => {
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 300],
        burstThreshold: 2,
        sustainMs: 200,
      }),
    ).toBe("retry");
    expect(
      classifyTileFailure({
        ...bursting,
        errorTimestamps: [NOW, NOW - 600],
        burstThreshold: 2,
        windowMs: 500,
        sustainMs: 200,
      }),
    ).toBe("ignore");
  });
});

describe("pruneTileFailures", () => {
  it("keeps stamps inside the window and drops the aged", () => {
    const stamps = [NOW, NOW - TILE_FAILURE_WINDOW_MS, NOW - TILE_FAILURE_WINDOW_MS - 1];
    expect(pruneTileFailures(stamps, NOW)).toEqual([
      NOW,
      NOW - TILE_FAILURE_WINDOW_MS,
    ]);
  });

  it("respects a custom window", () => {
    expect(pruneTileFailures([NOW, NOW - 400, NOW - 600], NOW, 500)).toEqual([
      NOW,
      NOW - 400,
    ]);
  });
});

describe("tileFailureRecheckDelay", () => {
  it("arms one sustain-window recheck for a concentrated burst", () => {
    const concurrent = Array.from(
      { length: TILE_FAILURE_BURST },
      (_, i) => NOW - i * 100,
    );
    expect(tileFailureRecheckDelay(concurrent, NOW)).toBe(
      TILE_FAILURE_SUSTAIN_MS - 300,
    );
  });

  it("does not arm below the burst threshold", () => {
    expect(
      tileFailureRecheckDelay(
        burst.slice(0, TILE_FAILURE_BURST - 1),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("spendTileFailureDecision", () => {
  it("spends the one style reload on a real systemic verdict, then surfaces", () => {
    const first = classifyTileFailure(bursting);
    expect(first).toBe("retry");

    const queued = spendTileFailureDecision(INITIAL_TILE_FAILURE_SPEND, first);
    expect(queued.effect).toBe("reload-style");
    expect(queued.state.retryQueued).toBe(true);

    // A second sample while the reload is in flight must not start another.
    expect(spendTileFailureDecision(queued.state, "retry").effect).toBe("none");

    const spent = markTileRetrySpent(queued.state);
    expect(spent.retrySpent).toBe(true);
    expect(spent.retryQueued).toBe(false);

    const afterReload = classifyTileFailure({ ...bursting, retrySpent: true });
    expect(afterReload).toBe("surface");

    const surfaced = spendTileFailureDecision(spent, afterReload);
    expect(surfaced.effect).toBe("surface");
    expect(spendTileFailureDecision(markTileFailureSurfaced(surfaced.state), "retry").effect).toBe(
      "none",
    );
    expect(
      spendTileFailureDecision(markTileFailureSurfaced(surfaced.state), "surface").effect,
    ).toBe("none");
  });

  it("never invents a second retry after the first reload is spent", () => {
    const spent = markTileRetrySpent({
      ...INITIAL_TILE_FAILURE_SPEND,
      retryQueued: true,
    });
    expect(spendTileFailureDecision(spent, "retry").effect).toBe("none");
    expect(spendTileFailureDecision(spent, "surface").effect).toBe("surface");
  });
});

describe("basemapFailureSurface", () => {
  it("shows the tiles card when no style ever loaded", () => {
    expect(basemapFailureSurface(false)).toBe("card");
  });

  it("shows the toast only after a style actually loaded", () => {
    expect(basemapFailureSurface(true)).toBe("toast");
  });
});
