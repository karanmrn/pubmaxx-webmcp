import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  readRememberedArea,
  writeRememberedArea,
} from "@/lib/nightPatches";
import { resolveTonightNear } from "@/lib/tonight";
import { orderPicksNear, type TonightPickDto } from "@/lib/todayBrief";

// #427 follow-up: Tonight and Today read the area the viewer already chose
// (the map's Near me writes it), so the tabs stop re-asking and stop
// disagreeing. These tests pin the three pure seams the adoption rides on:
// near-precedence, the loader's near param, and the picks reorder.

const soho = NIGHT_PATCHES[0];

describe("resolveTonightNear (precedence)", () => {
  it("a real position wins over any remembered area, and carries no patch label", () => {
    const near = resolveTonightNear(
      { lat: 51.5, lng: -0.1 },
      { kind: "patch", id: soho.id },
    );
    expect(near).toEqual({ near: { lat: 51.5, lng: -0.1 }, patchLabel: null });
  });

  it("a remembered patch supplies its heart and its label", () => {
    const near = resolveTonightNear(null, { kind: "patch", id: soho.id });
    expect(near).toEqual({
      near: { lat: soho.lat, lng: soho.lng },
      patchLabel: soho.label,
    });
  });

  it("the central default patch resolves too (it is a valid remembered id)", () => {
    const near = resolveTonightNear(null, { kind: "patch", id: CENTRAL_PATCH.id });
    expect(near?.patchLabel).toBe(CENTRAL_PATCH.label);
  });

  it("a remembered borough has no single heart, so ordering stays untouched", () => {
    expect(resolveTonightNear(null, { kind: "borough", name: "Camden" })).toBeNull();
  });

  it("nothing remembered, nothing shared: null, exactly today's behaviour", () => {
    expect(resolveTonightNear(null, null)).toBeNull();
  });
});

describe("loadWhatsOnTonight near param", () => {
  const okResponse = {
    ok: true,
    status: 200,
    json: async () => ({ rows: [], asOf: null }),
  } as unknown as Response;

  it("coarsens a viewer point before appending near=lat,lng", async () => {
    let url = "";
    await loadWhatsOnTonight({
      near: { lat: 51.51361234, lng: -0.1365789 },
      fetchImpl: async (input) => {
        url = String(input);
        return okResponse;
      },
    });
    expect(url).toBe("/api/whats-on?window=tonight&limit=60&near=51.514,-0.137");
  });

  it("omits near entirely when absent — the pre-seam request, byte for byte", async () => {
    let url = "";
    await loadWhatsOnTonight({
      fetchImpl: async (input) => {
        url = String(input);
        return okResponse;
      },
    });
    expect(url).toBe("/api/whats-on?window=tonight&limit=60");
  });

  it("refuses a non-finite point rather than sending junk", async () => {
    let url = "";
    await loadWhatsOnTonight({
      near: { lat: Number.NaN, lng: -0.1 },
      fetchImpl: async (input) => {
        url = String(input);
        return okResponse;
      },
    });
    expect(url).toBe("/api/whats-on?window=tonight&limit=60");
  });
});

function pick(id: string, lat: number | null, lng: number | null): TonightPickDto {
  return {
    id,
    title: id,
    placeName: id,
    kind: "quiz",
    kindLabel: "Quiz",
    sourceLabel: "Org",
    href: null,
    external: false,
    priceGbp: null,
    lat,
    lng,
  };
}

describe("orderPicksNear (Today picks continuity)", () => {
  const brixtonish = pick("brixton", 51.4627, -0.1145);
  const sohoish = pick("soho", 51.5136, -0.1365);
  const unlocated = pick("unlocated", null, null);

  it("leads with the pick nearest the point; unlocated picks keep their order at the tail", () => {
    const ordered = orderPicksNear(
      [brixtonish, unlocated, sohoish],
      { lat: soho.lat, lng: soho.lng },
    );
    expect(ordered.map((p) => p.id)).toEqual(["soho", "brixton", "unlocated"]);
  });

  it("no point: same array content in the same order (zero regression)", () => {
    const input = [brixtonish, unlocated, sohoish];
    expect(orderPicksNear(input, null).map((p) => p.id)).toEqual([
      "brixton",
      "unlocated",
      "soho",
    ]);
  });

  it("reorders, never drops or invents: same ids, same count", () => {
    const input = [brixtonish, unlocated, sohoish];
    const ordered = orderPicksNear(input, { lat: 51.4627, lng: -0.1145 });
    expect([...ordered].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...input].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});

// Node test environment: install a window + in-memory Storage, same idiom as
// __tests__/nightPatches.test.ts.
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

describe("corrupted remembered storage degrades to today's behaviour", () => {
  beforeEach(() => {
    (globalThis as { window?: { localStorage: Storage } }).window = {
      localStorage: makeMemoryStorage(),
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("junk in the storage key composes to null ordering, not a throw", () => {
    window.localStorage.setItem("pubmax:nightPatch:v1", "{not json");
    expect(resolveTonightNear(null, readRememberedArea())).toBeNull();
  });

  it("a remembered patch written by the map reaches the seam intact", () => {
    writeRememberedArea({ kind: "patch", id: soho.id });
    const near = resolveTonightNear(null, readRememberedArea());
    expect(near?.patchLabel).toBe(soho.label);
  });
});
