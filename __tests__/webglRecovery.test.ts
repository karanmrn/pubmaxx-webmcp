import { describe, expect, it } from "vitest";
import {
  CONTEXT_LOST_RECOVERY_MS,
  contextHealthAction,
  snapshotMapCamera,
} from "@/components/map/canvas/webglRecovery";

describe("contextHealthAction", () => {
  it("repaints when the context is healthy", () => {
    expect(
      contextHealthAction({ contextLost: false, reinitAlreadySpent: false }),
    ).toBe("repaint");
    expect(
      contextHealthAction({ contextLost: false, reinitAlreadySpent: true }),
    ).toBe("repaint");
  });

  it("re-inits once when the context is dead", () => {
    expect(
      contextHealthAction({ contextLost: true, reinitAlreadySpent: false }),
    ).toBe("reinit");
  });

  it("surfaces soft-retry after the auto re-init budget is spent", () => {
    expect(
      contextHealthAction({ contextLost: true, reinitAlreadySpent: true }),
    ).toBe("soft-retry");
  });
});

describe("snapshotMapCamera", () => {
  it("captures center/zoom/pitch/bearing from the map surface", () => {
    const snap = snapshotMapCamera({
      getCenter: () => ({ lng: -0.1348, lat: 51.5099 }),
      getZoom: () => 15,
      getPitch: () => 42,
      getBearing: () => -12,
    });
    expect(snap).toEqual({
      center: [-0.1348, 51.5099],
      zoom: 15,
      pitch: 42,
      bearing: -12,
    });
  });
});

describe("CONTEXT_LOST_RECOVERY_MS", () => {
  it("is a short grace window (not the old 4s dead-end wait)", () => {
    expect(CONTEXT_LOST_RECOVERY_MS).toBeGreaterThanOrEqual(200);
    expect(CONTEXT_LOST_RECOVERY_MS).toBeLessThanOrEqual(2000);
  });
});
