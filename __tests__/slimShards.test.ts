import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bboxContainsPoint,
  bboxIntersects,
  createSlimShardLoader,
  parseShardManifest,
  shardsForBounds,
  shardForPoint,
  type MapBounds,
  type ShardManifest,
} from "@/lib/slimShards";
import { offlineCache } from "@/lib/offlineCache";

// A small synthetic London-ish manifest: one core + two outer shards whose
// bboxes are deliberately non-overlapping so viewport/point mapping is exact.
const MANIFEST: ShardManifest = {
  version: 2,
  grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
  shards: [
    { id: "core", core: true, url: "/data/venues_slim.core.json", count: 2, bbox: [-0.2, 51.45, 0.0, 51.55] },
    { id: "greenwich", core: false, borough: "Greenwich", url: "/data/venues_slim.greenwich.json", count: 1, bbox: [0.0, 51.46, 0.1, 51.52] },
    { id: "enfield", core: false, borough: "Enfield", url: "/data/venues_slim.enfield.json", count: 1, bbox: [-0.15, 51.62, -0.02, 51.68] },
  ],
};

function slimRow(id: string, lat: number, lng: number) {
  return { id, name: id, lat, lng, cheapestPrice: null, borough: "x" };
}

const BODIES: Record<string, unknown> = {
  "/data/venues_slim.manifest.json": MANIFEST,
  "/data/venues_slim.core.json": [slimRow("c1", 51.5, -0.1), slimRow("c2", 51.51, -0.12)],
  "/data/venues_slim.greenwich.json": [slimRow("g1", 51.48, 0.05)],
  "/data/venues_slim.enfield.json": [slimRow("e1", 51.65, -0.08)],
};

describe("slimShards pure geometry", () => {
  it("bboxIntersects is inclusive at the edges and rejects disjoint boxes", () => {
    const bounds: MapBounds = { west: -0.05, south: 51.4, east: 0.05, north: 51.5 };
    expect(bboxIntersects([0.0, 51.46, 0.1, 51.52], bounds)).toBe(true); // greenwich overlaps
    expect(bboxIntersects([-0.15, 51.62, -0.02, 51.68], bounds)).toBe(false); // enfield is north
  });

  it("bboxContainsPoint", () => {
    expect(bboxContainsPoint([0.0, 51.46, 0.1, 51.52], 51.48, 0.05)).toBe(true);
    expect(bboxContainsPoint([0.0, 51.46, 0.1, 51.52], 51.7, 0.05)).toBe(false);
  });

  it("shardsForBounds returns only intersecting NON-core shards", () => {
    const bounds: MapBounds = { west: -0.02, south: 51.44, east: 0.12, north: 51.53 };
    const ids = shardsForBounds(MANIFEST, bounds).map((s) => s.id);
    expect(ids).toEqual(["greenwich"]);
  });

  it("shardForPoint picks the containing shard", () => {
    expect(shardForPoint(MANIFEST, 51.48, 0.05)?.id).toBe("greenwich");
    expect(shardForPoint(MANIFEST, 51.65, -0.08)?.id).toBe("enfield");
    expect(shardForPoint(MANIFEST, 51.5, -0.1)?.id).toBe("core");
  });

  it("excludes kind shards from point partitioning", () => {
    const withRestaurants: ShardManifest = {
      ...MANIFEST,
      shards: [
        ...MANIFEST.shards,
        {
          id: "restaurants",
          core: false,
          partition: "kind",
          url: "/data/venues_slim.restaurants.json",
          count: 25,
          bbox: [-0.2, 51.45, 0.1, 51.55],
        },
      ],
    };
    expect(shardForPoint(withRestaurants, 51.5, -0.1)?.id).toBe("core");
    expect(shardsForBounds(withRestaurants, {
      west: -0.2,
      south: 51.45,
      east: 0.1,
      north: 51.55,
    }).map((shard) => shard.id)).toContain("restaurants");
  });

  it("includes one grid ring only when requested", () => {
    const gridManifest: ShardManifest = {
      version: 2,
      grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
      shards: [
        { id: "centre", core: false, partition: "grid", url: "/centre", count: 1, bbox: [1, 1, 2, 2] },
        { id: "north", core: false, partition: "grid", url: "/north", count: 1, bbox: [1, 2, 2, 3] },
        { id: "far", core: false, partition: "grid", url: "/far", count: 1, bbox: [4, 4, 5, 5] },
      ],
    };
    const bounds = { west: 1.1, south: 1.1, east: 1.9, north: 1.9 };
    expect(shardsForBounds(gridManifest, bounds).map((shard) => shard.id)).toEqual(["centre"]);
    expect(shardsForBounds(gridManifest, bounds, 1).map((shard) => shard.id)).toEqual(["centre", "north"]);
  });
});

describe("parseShardManifest", () => {
  it("accepts a well-formed manifest and rejects malformed ones", () => {
    expect(parseShardManifest(MANIFEST)?.shards.length).toBe(3);
    expect(parseShardManifest(null)).toBeNull();
    expect(parseShardManifest({ version: 1 })).toBeNull();
    expect(parseShardManifest({ version: 1, shards: [{ id: "x" }] })).toBeNull();
    expect(
      parseShardManifest({ version: 1, shards: [{ id: "x", url: "/u", count: 1, core: false, bbox: [1, 2, 3] }] }),
    ).toBeNull();
    expect(
      parseShardManifest({
        version: 1,
        shards: [{
          id: "x",
          url: "/u",
          count: 1,
          core: false,
          bbox: [1, 2, 3, 4],
          partition: "district",
        }],
      }),
    ).toBeNull();
  });

  it("rejects a legacy schema when spatial version is required", () => {
    expect(
      parseShardManifest(
        { ...MANIFEST, version: 1, grid: undefined },
        2,
      ),
    ).toBeNull();
    expect(
      parseShardManifest(
        { ...MANIFEST, version: 1, grid: undefined },
        1,
      )?.version,
    ).toBe(1);
  });

  it("requires matching deployment revision when one is supplied", () => {
    const current = { ...MANIFEST, revision: "deploy-42" };
    expect(parseShardManifest(current, 2, "deploy-42")?.revision).toBe("deploy-42");
    expect(parseShardManifest(current, 2, "other-deploy")).toBeNull();
    expect(parseShardManifest(MANIFEST, 2, "deploy-42")).toBeNull();
  });
});

describe("createSlimShardLoader (London)", () => {
  const realFetch = globalThis.fetch;
  let fetched: string[];

  function installFetch(overrides: Record<string, "fail" | "404"> = {}) {
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (overrides[url] === "fail") return Promise.reject(new Error("cellar signal"));
      if (overrides[url] === "404") {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url in BODIES) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(BODIES[url]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;
  }

  beforeEach(() => installFetch());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("core() loads only the manifest + core shard (first-paint stays lean)", async () => {
    const loader = createSlimShardLoader("london");
    const core = await loader.core();
    expect(core.map((v) => v.id).sort()).toEqual(["c1", "c2"]);
    expect(fetched).toContain("/data/venues_slim.manifest.json");
    expect(fetched).toContain("/data/venues_slim.core.json");
    expect(fetched).not.toContain("/data/venues_slim.greenwich.json");
    expect(fetched).not.toContain("/data/venues_slim.enfield.json");
  });

  it("inBounds() lazily loads intersecting shards once, skipping already-loaded ones", async () => {
    const loader = createSlimShardLoader("london");
    await loader.core();
    const rows = await loader.inBounds({ west: 0.0, south: 51.44, east: 0.12, north: 51.53 });
    expect(rows.map((v) => v.id)).toEqual(["g1"]);
    expect(fetched).toContain("/data/venues_slim.greenwich.json");

    // A second pass over the same viewport must not refetch the loaded shard.
    fetched = [];
    const again = await loader.inBounds({ west: 0.0, south: 51.44, east: 0.12, north: 51.53 });
    expect(again).toEqual([]);
    expect(fetched).not.toContain("/data/venues_slim.greenwich.json");
  });

  it("inBounds() loads core when a later viewport reaches central London", async () => {
    const loader = createSlimShardLoader("london");

    await loader.inBounds({
      west: -0.15,
      south: 51.62,
      east: -0.02,
      north: 51.68,
    });
    const rows = await loader.inBounds({
      west: -0.16,
      south: 51.48,
      east: -0.08,
      north: 51.53,
    });

    expect(rows.map((venue) => venue.id)).toEqual(["c1", "c2"]);
    expect(fetched).toContain("/data/venues_slim.core.json");
  });

  it("nearPoint() loads the shard the user geolocated into", async () => {
    const loader = createSlimShardLoader("london");
    const result = await loader.nearPoint(51.65, -0.08);
    expect(result.rows.map((v) => v.id)).toEqual(["e1"]);
    expect(result.status).toBe("ready");
    expect((await loader.nearPoint(51.5, -0.1)).rows.map((v) => v.id)).toEqual(["c1", "c2"]);
  });

  it("nearPoint() loads every location shard intersecting its walk radius", async () => {
    const loader = createSlimShardLoader("london");
    const rows = (await loader.nearPoint(51.5, 0.001)).rows;

    expect(rows.map((venue) => venue.id).sort()).toEqual(["c1", "c2", "g1"]);
  });

  it("nearPoint() reports unavailable when a radius shard cannot load", async () => {
    installFetch({ "/data/venues_slim.enfield.json": "fail" });
    const loader = createSlimShardLoader("london");
    const result = await loader.nearPoint(51.65, -0.08);

    expect(result.rows).toEqual([]);
    expect(result.status).toBe("unavailable");
  });

  it("all() loads core plus every outer shard", async () => {
    const loader = createSlimShardLoader("london");
    const rows = await loader.all();
    expect(rows.map((v) => v.id).sort()).toEqual(["c1", "c2", "e1", "g1"]);
  });

  // A figure taken over the loaded pins is only the truth for a patch whose
  // shards have all landed, so the loader answers that question itself.
  it("coverageComplete() is tri-state and follows the shards that landed", async () => {
    const loader = createSlimShardLoader("london");
    const coreOnly = { west: -0.16, south: 51.48, east: -0.08, north: 51.53 };
    const overGreenwich = { west: 0.01, south: 51.47, east: 0.08, north: 51.51 };

    // Nobody has asked the manifest yet, so the honest answer is "cannot tell".
    expect(loader.coverageComplete(coreOnly)).toBeNull();

    await loader.core();
    expect(loader.coverageComplete(coreOnly)).toBe(true);
    expect(loader.coverageComplete(overGreenwich)).toBe(false);

    await loader.inBounds(overGreenwich);
    expect(loader.coverageComplete(overGreenwich)).toBe(true);
  });

  it("coverageComplete() stays false while a shard fetch keeps failing", async () => {
    installFetch({ "/data/venues_slim.greenwich.json": "fail" });
    const loader = createSlimShardLoader("london");
    await loader.core();
    const overGreenwich = { west: 0.01, south: 51.47, east: 0.08, north: 51.51 };
    await loader.inBounds(overGreenwich);
    expect(loader.coverageComplete(overGreenwich)).toBe(false);
  });

  it("coverageComplete() stays false when a shard payload is unavailable", async () => {
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/data/venues_slim.greenwich.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, slimRow("g1", 51.48, 0.05)]),
        } as Response);
      }
      if (url in BODIES) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(BODIES[url]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;
    const loader = createSlimShardLoader("london");
    await loader.core();
    const overGreenwich = { west: 0.01, south: 51.47, east: 0.08, north: 51.51 };
    await expect(loader.inBounds(overGreenwich)).resolves.toEqual([slimRow("g1", 51.48, 0.05)]);
    expect(loader.coverageComplete(overGreenwich)).toBe(false);
  });

  it("coverageComplete() stays false when the unsharded index is unavailable", async () => {
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/data/venues_slim.manifest.json") {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url === "/data/venues_slim.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, slimRow("c1", 51.5, -0.1)]),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;
    const loader = createSlimShardLoader("london");
    const coreOnly = { west: -0.16, south: 51.48, east: -0.08, north: 51.53 };
    await expect(loader.core()).resolves.toEqual([slimRow("c1", 51.5, -0.1)]);
    expect(loader.coverageComplete(coreOnly)).toBe(false);
  });

  it("degrades honestly: a failed shard yields [] and is retried on the next call", async () => {
    installFetch({ "/data/venues_slim.greenwich.json": "fail" });
    const loader = createSlimShardLoader("london");
    await loader.core();
    const bounds = { west: 0.0, south: 51.44, east: 0.12, north: 51.53 };
    // First attempt: shard fetch fails (no offline mirror in Node) → [].
    expect(await loader.inBounds(bounds)).toEqual([]);
    // The failed shard is NOT marked loaded, so it retries — now let it succeed.
    installFetch();
    const rows = await loader.inBounds(bounds);
    expect(rows.map((v) => v.id)).toEqual(["g1"]);
  });

  it("preserves initial shard failure status for the map readiness gate", async () => {
    installFetch({ "/data/venues_slim.core.json": "fail" });
    const loader = createSlimShardLoader("london");
    const bounds = { west: -0.16, south: 51.48, east: -0.08, north: 51.53 };

    await expect(loader.initialResult(bounds)).resolves.toEqual({
      rows: [],
      status: "unavailable",
    });
  });

  it("defers spatial manifest work until after first pins on first visit", async () => {
    const loader = createSlimShardLoader("london", { deferSpatial: true });
    const bounds = { west: -0.16, south: 51.48, east: -0.08, north: 51.53 };

    await expect(loader.initialResult(bounds)).resolves.toEqual({
      rows: [slimRow("c1", 51.5, -0.1), slimRow("c2", 51.51, -0.12)],
      status: "ready",
    });
    expect(fetched).toContain("/data/venues_slim.core.json");
    expect(fetched.filter((url) => url === "/data/venues_slim.core.json")).toHaveLength(1);
    expect(fetched).not.toContain("/data/venues_slim.manifest.json");

    await loader.inBounds(bounds);
    expect(fetched).toContain("/data/venues_slim.manifest.json");
    expect(fetched.filter((url) => url === "/data/venues_slim.core.json")).toHaveLength(1);
  });

  it("does not restore a legacy manifest from the offline boundary", async () => {
    installFetch({ "/data/venues_slim.manifest.json": "fail" });
    const getSpy = vi.spyOn(offlineCache, "get").mockResolvedValue({
      ...MANIFEST,
      version: 1,
      grid: undefined,
    });
    const loader = createSlimShardLoader("london");

    await expect(
      loader.initialResult({ west: -0.2, south: 51.45, east: 0, north: 51.55 }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });
    expect(getSpy).toHaveBeenCalledWith(
      "venues_slim_manifest:v2:/data/venues_slim.manifest.json",
    );
    expect(fetched).not.toContain("/data/venues_slim.json");
    expect(fetched).not.toContain("/data/venues_slim.core.json");
  });

  it("bypasses a shared in-flight read when a new loader retries", async () => {
    let coreFetches = 0;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/data/venues_slim.core.json") {
        coreFetches += 1;
        if (coreFetches === 1) return new Promise<Response>(() => {});
      }
      if (url in BODIES) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(BODIES[url]) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;

    void createSlimShardLoader("london", { bypassInFlight: true }).core();
    await Promise.resolve();
    const retryLoader = createSlimShardLoader("london", { bypassInFlight: true });
    const core = await retryLoader.core();

    expect(core.map((v) => v.id).sort()).toEqual(["c1", "c2"]);
    expect(coreFetches).toBe(2);
  });

  // The core shard is fetched SPECULATIVELY beside the manifest so first paint
  // does not pay two serial round trips. A path that discards that guess must
  // not wait for it: a hanging (or simply slow) speculative request would hold
  // the whole first paint behind a response nobody reads.
  it("does not wait for the speculative core shard on the no-manifest path", async () => {
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/data/cities/manchester/venues_slim.core.json") {
        return new Promise<Response>(() => {});
      }
      if (url === "/data/cities/manchester/venues_slim.manifest.json") {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url === "/data/cities/manchester/venues_slim.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([slimRow("m1", 53.4, -2.2)]),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;

    const loader = createSlimShardLoader("manchester");
    const core = await Promise.race([
      loader.core(),
      new Promise<"serialised">((resolve) =>
        setTimeout(() => resolve("serialised"), 2_000),
      ),
    ]);
    expect(core).not.toBe("serialised");
    expect((core as ReturnType<typeof slimRow>[]).map((v) => v.id)).toEqual(["m1"]);
  });

  it("does not wait for the speculative shard when the manifest names another core", async () => {
    const renamedCore: ShardManifest = {
      version: 2,
      grid: MANIFEST.grid,
      shards: [
        { ...MANIFEST.shards[0]!, url: "/data/venues_slim.central.json" },
        ...MANIFEST.shards.slice(1),
      ],
    };
    fetched = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/data/venues_slim.core.json") return new Promise<Response>(() => {});
      if (url === "/data/venues_slim.manifest.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(renamedCore),
        } as Response);
      }
      if (url === "/data/venues_slim.central.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(BODIES["/data/venues_slim.core.json"]),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;

    const loader = createSlimShardLoader("london");
    const core = await Promise.race([
      loader.core(),
      new Promise<"serialised">((resolve) =>
        setTimeout(() => resolve("serialised"), 2_000),
      ),
    ]);
    expect(core).not.toBe("serialised");
    expect((core as ReturnType<typeof slimRow>[]).map((v) => v.id).sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("falls back to the single city file when there is no manifest", async () => {
    installFetch({ "/data/cities/manchester/venues_slim.manifest.json": "404" });
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "/data/cities/manchester/venues_slim.manifest.json") {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url === "/data/cities/manchester/venues_slim.json") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ revision: "local", rows: [slimRow("m1", 53.4, -2.2)] }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    }) as typeof fetch;

    const loader = createSlimShardLoader("manchester");
    const core = await loader.core();
    expect(core.map((v) => v.id)).toEqual(["m1"]);
    // No manifest → nothing lazy to resolve.
    expect(await loader.inBounds({ west: -3, south: 53, east: -2, north: 54 })).toEqual([]);
    expect(await loader.nearPoint(53.4, -2.2)).toEqual({ rows: [], status: "ready" });
  });
});
