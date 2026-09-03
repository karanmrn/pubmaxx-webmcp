import { describe, expect, it } from "vitest";

import { createOfflineCache, offlineCache } from "@/lib/offlineCache";

// lib/offlineCache.ts — the IndexedDB fallback layer for the slim venue index
// (issue #32). Two things matter and both are tested here:
//   1. GRACEFUL NO-OP: in a runtime without IndexedDB (this Node process is
//      one) nothing throws — get → null, set → false. This is the path SSR
//      and old WebViews hit.
//   2. ROUND-TRIP: against a minimal in-memory shim of the IDB API surface
//      the wrapper actually uses (open/upgrade → transaction → objectStore →
//      get/put), values persist and come back parsed.
//
// fake-indexeddb isn't a dependency (issue constraint: no new deps), so the
// shim below implements exactly the event-based subset the wrapper touches.

type Handler = (() => void) | null;

class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;

  succeed(result: T) {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(error: Error) {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

class FakeObjectStore {
  constructor(private rows: Map<string, unknown>) {}

  get(key: string): FakeRequest {
    const request = new FakeRequest();
    request.succeed(this.rows.get(key));
    return request;
  }

  put(row: { key: string }): FakeRequest {
    const request = new FakeRequest();
    this.rows.set(row.key, row);
    request.succeed(row.key);
    return request;
  }
}

class FakeDatabase {
  private stores = new Map<string, Map<string, unknown>>();

  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string) {
    this.stores.set(name, new Map());
    return new FakeObjectStore(this.stores.get(name)!);
  }

  // Extra runtime args (mode) are accepted and ignored.
  transaction(name: string) {
    const rows = this.stores.get(name);
    if (!rows) throw new Error(`no object store: ${name}`);
    return { objectStore: () => new FakeObjectStore(rows) };
  }
}

// Databases persist across open() calls within one factory, like the real thing.
class FakeIDBFactory {
  private databases = new Map<string, FakeDatabase>();
  failOpens = false;

  open(name: string): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    if (this.failOpens) {
      request.fail(new Error("quota exceeded"));
      return request;
    }
    const isNew = !this.databases.has(name);
    if (isNew) this.databases.set(name, new FakeDatabase());
    const db = this.databases.get(name)!;
    request.result = db;
    queueMicrotask(() => {
      if (isNew) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

function fakeFactory(): IDBFactory {
  return new FakeIDBFactory() as unknown as IDBFactory;
}

describe("offlineCache — graceful no-op without IndexedDB", () => {
  it("this Node runtime really has no indexedDB (precondition for the no-op tests)", () => {
    expect(typeof indexedDB).toBe("undefined");
  });

  it("get resolves null instead of throwing", async () => {
    const cache = createOfflineCache(null);
    await expect(cache.get("venues_slim:v1")).resolves.toBeNull();
  });

  it("set resolves false instead of throwing", async () => {
    const cache = createOfflineCache(null);
    await expect(cache.set("venues_slim:v1", [{ id: "venue-1" }])).resolves.toBe(false);
  });

  it("the default app-wide instance is the no-op variant in Node", async () => {
    await expect(offlineCache.get("anything")).resolves.toBeNull();
    await expect(offlineCache.set("anything", 1)).resolves.toBe(false);
  });
});

describe("offlineCache — round-trip via an in-memory IDB shim", () => {
  it("stores and returns a parsed value", async () => {
    const cache = createOfflineCache(fakeFactory());
    const rows = [
      { id: "venue-abc", name: "The Fox", lat: 51.5, lng: -0.1, cheapestPrice: 4.2, borough: "Hackney" },
    ];
    await expect(cache.set("venues_slim:v1", rows)).resolves.toBe(true);
    await expect(cache.get("venues_slim:v1")).resolves.toEqual(rows);
  });

  it("returns null for a key never written", async () => {
    const cache = createOfflineCache(fakeFactory());
    await expect(cache.get("missing")).resolves.toBeNull();
  });

  it("overwrites an existing key (keyPath put semantics)", async () => {
    const cache = createOfflineCache(fakeFactory());
    await cache.set("k", "first");
    await cache.set("k", "second");
    await expect(cache.get<string>("k")).resolves.toBe("second");
  });

  it("keys are independent", async () => {
    const cache = createOfflineCache(fakeFactory());
    await cache.set("a", 1);
    await cache.set("b", 2);
    await expect(cache.get("a")).resolves.toBe(1);
    await expect(cache.get("b")).resolves.toBe(2);
  });

  it("a failed open degrades to null/false, and a later successful open recovers", async () => {
    const factory = new FakeIDBFactory();
    const cache = createOfflineCache(factory as unknown as IDBFactory);

    factory.failOpens = true;
    await expect(cache.set("k", "v")).resolves.toBe(false);
    await expect(cache.get("k")).resolves.toBeNull();

    // The memoized open must not be poisoned by the earlier failure.
    factory.failOpens = false;
    await expect(cache.set("k", "v")).resolves.toBe(true);
    await expect(cache.get<string>("k")).resolves.toBe("v");
  });
});

describe("loadSlimVenues offline fallback (lib/venuesSlim.ts wiring)", () => {
  it("propagates the fetch error when no fallback exists (contract preserved)", async () => {
    const { loadSlimVenues } = await import("@/lib/venuesSlim");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("cellar signal"))) as typeof fetch;
    try {
      // Node has no indexedDB → the offline layer is a no-op → the original
      // fetch error must surface, exactly as before issue #32.
      await expect(loadSlimVenues()).rejects.toThrow("cellar signal");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loadSlimVenuesForCity uses the city slim path", async () => {
    const { loadSlimVenuesForCity } = await import("@/lib/venuesSlim");
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      seen.push(String(input));
      return Promise.reject(new Error("cellar signal"));
    }) as typeof fetch;
    try {
      await expect(loadSlimVenuesForCity("manchester")).rejects.toThrow("cellar signal");
      expect(seen).toEqual(["/data/cities/manchester/venues_slim.json"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("distinguishes malformed and valid empty slim payloads", async () => {
    const { loadSlimVenuesFromPathResult } = await import("@/lib/venuesSlim");
    const originalFetch = globalThis.fetch;
    const payloads = new Map<string, unknown>([
      ["/data/slim-malformed-result.json", { malformed: true }],
      ["/data/slim-invalid-result.json", [{}]],
      [
        "/data/slim-partial-result.json",
        [
          {},
          {
            id: "venue-partial",
            name: "Partial Arms",
            lat: 51.5,
            lng: -0.1,
            cheapestPrice: 5,
            borough: "Camden",
          },
        ],
      ],
      ["/data/slim-empty-result.json", []],
    ]);
    globalThis.fetch = ((input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payloads.get(String(input))),
      } as Response)) as typeof fetch;
    try {
      await expect(
        loadSlimVenuesFromPathResult("/data/slim-malformed-result.json"),
      ).resolves.toEqual({ rows: [], status: "unavailable" });
      await expect(
        loadSlimVenuesFromPathResult("/data/slim-invalid-result.json"),
      ).resolves.toEqual({ rows: [], status: "unavailable" });
      await expect(
        loadSlimVenuesFromPathResult("/data/slim-partial-result.json"),
      ).resolves.toEqual({
        rows: [
          {
            id: "venue-partial",
            name: "Partial Arms",
            lat: 51.5,
            lng: -0.1,
            cheapestPrice: 5,
            borough: "Camden",
          },
        ],
        status: "unavailable",
      });
      await expect(
        loadSlimVenuesFromPathResult("/data/slim-empty-result.json"),
      ).resolves.toEqual({ rows: [], status: "ready" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
