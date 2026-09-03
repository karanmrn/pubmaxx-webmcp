import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rankNearMe, type PricedPoint } from "@/lib/nearMeAnswer";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  clearRememberedArea,
  readRememberedArea,
  resolveNightPatch,
  writeRememberedArea,
} from "@/lib/nightPatches";
import { nearestNightPatch } from "@/lib/nearestNightPatch";

// The patch list is a product contract (owner-locked in the near-me taste fix):
// areas people say, nightlife-gravity order, not admin geography and not
// alphabetical. A drive-by re-sort or rename fails here first.
describe("night patches — the list itself", () => {
  it("is exactly the eight areas, in nightlife-gravity order", () => {
    expect(NIGHT_PATCHES.map((patch) => patch.label)).toEqual([
      "Soho",
      "Shoreditch",
      "Camden",
      "London Bridge",
      "Brixton",
      "Clapham",
      "Islington",
      "Hackney",
    ]);
  });

  it("keeps every centre inside the Greater London footprint", () => {
    for (const patch of [...NIGHT_PATCHES, CENTRAL_PATCH]) {
      expect(patch.lat, patch.id).toBeGreaterThan(51.2);
      expect(patch.lat, patch.id).toBeLessThan(51.8);
      expect(patch.lng, patch.id).toBeGreaterThan(-0.6);
      expect(patch.lng, patch.id).toBeLessThan(0.4);
    }
  });

  it("resolves ids including central, and rejects unknowns", () => {
    expect(resolveNightPatch("soho")?.label).toBe("Soho");
    expect(resolveNightPatch("central")).toBe(CENTRAL_PATCH);
    expect(resolveNightPatch("narnia")).toBeNull();
    expect(resolveNightPatch(null)).toBeNull();
  });
});

describe("nearest night patch", () => {
  it("uses haversine distance to resolve a London coordinate", () => {
    expect(nearestNightPatch(51.527, -0.08)?.id).toBe("shoreditch");
    expect(nearestNightPatch(51.4627, -0.1145)?.id).toBe("brixton");
  });

  it("rejects non-finite coordinates", () => {
    expect(nearestNightPatch(Number.NaN, -0.12)).toBeNull();
    expect(nearestNightPatch(51.52, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects finite coordinates outside Greater London's borough boundary", () => {
    expect(nearestNightPatch(53.48, -2.24)).toBeNull();
    expect(nearestNightPatch(51.52, -0.551)).toBeNull();
    expect(nearestNightPatch(51.656, -0.397)).toBeNull(); // Watford
    expect(nearestNightPatch(51.698, 0.11)).toBeNull(); // Epping
    expect(nearestNightPatch(51.446, 0.218)).toBeNull(); // Dartford
  });
});

// Honesty gate: every patch must produce a real answer from the priced index
// that actually ships. A patch whose centre drifts out of the data footprint
// (or a data rebuild that hollows an area out) fails here before it ships.
describe("night patches — every patch answers from shipped data", () => {
  const SLIM_PATH = path.join(path.resolve(__dirname, ".."), "public", "data", "venues_slim.json");
  const payload = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as { rows?: PricedPoint[] };
  const venues = payload.rows ?? [];

  for (const patch of [...NIGHT_PATCHES, CENTRAL_PATCH]) {
    it(`${patch.label} has priced pubs within the walkable ring`, () => {
      const answer = rankNearMe(patch.lat, patch.lng, venues);
      expect(answer.scope).toBe("walkable");
      expect(answer.cards.length).toBeGreaterThanOrEqual(3);
    });
  }
});

// Node test environment: install a window + in-memory Storage the same way
// __tests__/a2hsPrompt.test.ts does for its localStorage-backed seam.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

describe("remembered area persistence", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeMemoryStorage();
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: storage };
  });

  afterEach(() => {
    clearRememberedArea();
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips a patch pick and a borough pick", () => {
    writeRememberedArea({ kind: "patch", id: "brixton" });
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "brixton" });

    writeRememberedArea({ kind: "borough", name: "Hackney" });
    expect(readRememberedArea()).toEqual({ kind: "borough", name: "Hackney" });
  });

  it("refuses an unknown patch id and keeps the previous value", () => {
    writeRememberedArea({ kind: "patch", id: "soho" });
    writeRememberedArea({ kind: "patch", id: "narnia" });
    expect(readRememberedArea()).toEqual({ kind: "patch", id: "soho" });
  });

  it("returns null on stale or corrupt stored shapes", () => {
    storage.setItem("pubmax:nightPatch:v1", "not-json{");
    expect(readRememberedArea()).toBeNull();
    storage.setItem("pubmax:nightPatch:v1", JSON.stringify({ kind: "patch", id: "gone" }));
    expect(readRememberedArea()).toBeNull();
  });

  it("degrades silently when storage is absent", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readRememberedArea()).toBeNull();
    expect(() => writeRememberedArea({ kind: "patch", id: "soho" })).not.toThrow();
  });
});

// Register containment: the near-me surface speaks house voice, never the
// killed vibe-layer terms (docs/VIBE_LAYER_SPEC_2026-07-19.md kill list).
describe("voice containment", () => {
  it("keeps killed slang out of the patch module and near-me surface", () => {
    const sources = [
      path.join(path.resolve(__dirname, ".."), "lib", "nightPatches.ts"),
      path.join(path.resolve(__dirname, ".."), "components", "nearme", "NearMeNow.tsx"),
    ].map((file) => readFileSync(file, "utf8").toLowerCase());
    for (const killed of ["turnt", "no cap", "bussin", "real ones"]) {
      for (const source of sources) {
        expect(source).not.toContain(killed);
      }
    }
  });
});
