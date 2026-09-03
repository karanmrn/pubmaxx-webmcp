import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: unknown) => void;

type FakeResponse = {
  ok: boolean;
  type: "cors" | "opaque";
  headers?: { get: (name: string) => string | null };
  json?: ReturnType<typeof vi.fn>;
  clone: ReturnType<typeof vi.fn>;
};

function workerHarness(input: {
  response?: FakeResponse;
  fetchError?: Error;
  cached?: FakeResponse | null;
  putError?: Error;
  trimError?: Error;
  activeWorker?: string;
  cacheNames?: string[];
  workerPolicy?: string;
  workerVersion?: string;
}) {
  const listeners = new Map<string, Listener>();
  const put = vi.fn(async () => {
    if (input.putError) throw input.putError;
  });
  const cache = {
    match: vi.fn(async () => input.cached ?? null),
    put,
    keys: vi.fn(async () => {
      if (input.trimError) throw input.trimError;
      return [];
    }),
    delete: vi.fn(async () => true),
  };
  const fakeSelf = {
    location: {
      href:
        `https://pubmaxxing.com/sw.js?v=${input.workerVersion ?? "test"}&cache-policy=${input.workerPolicy ?? "write-safe-v1"}`,
      origin: "https://pubmaxxing.com",
    },
    registration: {
      active: input.activeWorker
        ? { scriptURL: input.activeWorker }
        : null,
      showNotification: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const fakeCaches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => input.cacheNames ?? []),
    delete: vi.fn(async () => true),
  };
  const doFetch = vi.fn(async () => {
    if (input.fetchError) throw input.fetchError;
    return input.response;
  });
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  Function("self", "caches", "fetch", source)(fakeSelf, fakeCaches, doFetch);

  return { listeners, cache, put, doFetch, fakeCaches, fakeSelf };
}

function rolloutWorkerHarness(input: {
  entries: Record<string, Array<[string, Response]>>;
  rejectCurrentWrites?: boolean;
  response?: Response;
}) {
  const listeners = new Map<string, Listener>();
  const records = new Map<
    string,
    Map<string, { request: Request; response: Response }>
  >();
  for (const [name, entries] of Object.entries(input.entries)) {
    records.set(
      name,
      new Map(
        entries.map(([url, response]) => {
          const request = new Request(
            new URL(url, "https://pubmaxxing.com"),
          );
          return [request.url, { request, response }];
        }),
      ),
    );
  }
  const deletedCaches: string[] = [];
  const fakeCaches = {
    async open(name: string) {
      let entries = records.get(name);
      if (!entries) {
        entries = new Map();
        records.set(name, entries);
      }
      return {
        async match(request: RequestInfo, options?: CacheQueryOptions) {
          const url = new URL(
            typeof request === "string" ? request : request.url,
            "https://pubmaxxing.com",
          );
          if (!options?.ignoreSearch) return entries.get(url.href)?.response;
          for (const entry of entries.values()) {
            const candidate = new URL(entry.request.url);
            if (
              candidate.origin === url.origin &&
              candidate.pathname === url.pathname
            ) {
              return entry.response;
            }
          }
          return undefined;
        },
        async put(request: RequestInfo, response: Response) {
          if (
            input.rejectCurrentWrites &&
            name.endsWith("-target")
          ) {
            throw new DOMException(
              "Storage quota exceeded",
              "QuotaExceededError",
            );
          }
          const storedRequest = new Request(
            typeof request === "string"
              ? new URL(request, "https://pubmaxxing.com")
              : request,
          );
          entries.set(storedRequest.url, {
            request: storedRequest,
            response,
          });
        },
        async keys() {
          return [...entries.values()].map(({ request }) => request);
        },
        async delete(request: RequestInfo) {
          const url = new URL(
            typeof request === "string" ? request : request.url,
            "https://pubmaxxing.com",
          );
          return entries.delete(url.href);
        },
      };
    },
    async keys() {
      return [...records.keys()];
    },
    async delete(name: string) {
      deletedCaches.push(name);
      return records.delete(name);
    },
  };
  const fakeSelf = {
    caches: fakeCaches,
    location: {
      href:
        "https://pubmaxxing.com/sw.js?v=target&cache-policy=write-safe-v1",
      origin: "https://pubmaxxing.com",
    },
    registration: {
      active: {
        scriptURL: "https://pubmaxxing.com/sw.js?v=legacy-active",
      },
      showNotification: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => undefined),
    },
    addEventListener(type: string, listener: Listener) {
      listeners.set(type, listener);
    },
  };
  const doFetch = vi.fn(async () => {
    if (input.response) return input.response;
    throw new TypeError("network unavailable");
  });
  const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  const importScripts = vi.fn(() => {
    const planCacheSource = readFileSync(
      join(process.cwd(), "public", "sw-plan-cache.js"),
      "utf8",
    );
    Function("self", planCacheSource)(fakeSelf);
  });
  Function("self", "caches", "fetch", "importScripts", source)(
    fakeSelf,
    fakeCaches,
    doFetch,
    importScripts,
  );

  return {
    deletedCaches,
    fakeCaches,
    fakeSelf,
    importScripts,
    listeners,
    records,
  };
}

function dispatchFetch(
  listener: Listener,
  request: Request,
): {
  response: Promise<unknown> | null;
  lifetime: Promise<unknown>[];
} {
  let response: Promise<unknown> | null = null;
  const lifetime: Promise<unknown>[] = [];
  listener({
    request,
    respondWith(value: Promise<unknown>) {
      response = Promise.resolve(value);
    },
    waitUntil(value: Promise<unknown>) {
      lifetime.push(Promise.resolve(value));
    },
  });
  return { response, lifetime };
}

function dispatchLifecycle(listener: Listener): Promise<unknown>[] {
  const lifetime: Promise<unknown>[] = [];
  listener({
    waitUntil(value: Promise<unknown>) {
      lifetime.push(Promise.resolve(value));
    },
  });
  return lifetime;
}

function fakeResponse(type: FakeResponse["type"], ok = true, cacheControl?: string): FakeResponse {
  const clone = vi.fn();
  const response: FakeResponse = {
    ok,
    type,
    ...(cacheControl ? { headers: { get: () => cacheControl } } : {}),
    json: vi.fn(async () => ({ revision: "test", rows: [] })),
    clone,
  };
  clone.mockReturnValue(response);
  return response;
}

const TILE_URL =
  "https://tiles.openfreemap.org/planet/revision/11/1023/680.pbf";

describe("service worker map cache", () => {
  it("activates over a pre-fix worker without leaving it in control", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker: "https://pubmaxxing.com/sw.js?v=legacy-active",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("activates over an explicitly marked pre-fix worker", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=legacy-active&cache-policy=cache-write-coupled-v1",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).toHaveBeenCalledOnce();
  });

  it("keeps later write-safe updates on the normal waiting path", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=previous&cache-policy=write-safe-v1",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("does not serve a cached manifest requested for another deployment revision", async () => {
    const manifest = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ version: 2, shards: [] })),
    };
    manifest.clone.mockReturnValue(manifest);
    const { listeners } = workerHarness({ cached: manifest, fetchError: new Error("offline") });
    const request = new Request(
      "https://pubmaxxing.com/data/venues_slim.manifest.json?v=other-deploy",
    );
    const dispatched = dispatchFetch(listeners.get("fetch")!, request);

    const response = await dispatched.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not serve a stale cached London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(
        "https://pubmaxxing.com/data/venues_slim.json?v=test",
      ),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not let a previous worker serve its London monolith to a new deployment", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners, put } = workerHarness({
      workerVersion: "previous",
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=target"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("serves a matching cached London monolith while offline", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "test", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    await expect(event.response).resolves.toBe(monolith);
  });

  it("does not serve a stale cached city monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners } = workerHarness({
      cached: monolith,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(
        "https://pubmaxxing.com/data/cities/manchester/venues_slim.json?v=test",
      ),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not cache a stale network London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "previous", rows: [] });
    const { listeners, put } = workerHarness({ response: monolith });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("returns and caches a current network London monolith", async () => {
    const monolith = fakeResponse("cors");
    monolith.json?.mockResolvedValue({ revision: "test", rows: [] });
    const { listeners, put } = workerHarness({ response: monolith });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.json?v=test"),
    );

    await expect(event.response).resolves.toBe(monolith);
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).toHaveBeenCalledOnce();
  });

  it("returns a fresh manifest when deployment revisions differ", async () => {
    const manifest = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ version: 2, revision: "other-deploy", shards: [] })),
    };
    manifest.clone.mockReturnValue(manifest);
    const { listeners } = workerHarness({ response: manifest });
    const request = new Request(
      "https://pubmaxxing.com/data/venues_slim.manifest.json?v=other-deploy",
    );
    const dispatched = dispatchFetch(listeners.get("fetch")!, request);

    const response = await dispatched.response;
    expect(response).toBe(manifest);
  });

  it("rejects and does not cache a network shard from another revision", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "stale-deploy", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners, put } = workerHarness({ response: shard });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=other-deploy"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("does not serve an unversioned cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "test", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("serves a current-revision cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "test", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=test"),
    );

    await expect(event.response).resolves.toBe(shard);
  });

  it("serves an unversioned cached venue shard for local builds", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "local", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      workerVersion: "local",
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    await expect(event.response).resolves.toBe(shard);
  });

  it("does not serve a prior-revision cached venue shard", async () => {
    const shard = {
      ok: true,
      type: "cors" as const,
      clone: vi.fn(),
      json: vi.fn(async () => ({ revision: "previous", rows: [] })),
    };
    shard.clone.mockReturnValue(shard);
    const { listeners } = workerHarness({
      cached: shard,
      fetchError: new Error("offline"),
    });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json?v=test"),
    );

    const response = await event.response;
    expect(response).toMatchObject({ status: 0, type: "error" });
  });

  it("does not force takeover for future write-safe policy changes", async () => {
    const { fakeSelf, listeners } = workerHarness({
      activeWorker:
        "https://pubmaxxing.com/sw.js?v=previous&cache-policy=write-safe-v1",
      workerPolicy: "write-safe-v2",
    });

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("keeps first installation on the normal activation path", async () => {
    const { fakeSelf, listeners } = workerHarness({});

    const lifetime = dispatchLifecycle(listeners.get("install")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("purges old tiles but preserves usable offline caches when migration writes fail", async () => {
    const shellResponse = new Response("offline map");
    const dataResponse = new Response("legacy data");
    const staticResponse = new Response("legacy static");
    const planResponse = new Response("legacy plan");
    const {
      deletedCaches,
      fakeCaches,
      fakeSelf,
      importScripts,
      listeners,
      records,
    } =
      rolloutWorkerHarness({
        rejectCurrentWrites: true,
        entries: {
          "pubmax-sw-shell-legacy-active": [["/map", shellResponse]],
          "pubmax-sw-data-legacy-active": [
            ["/data/venues_slim.core.json", dataResponse],
          ],
          "pubmax-sw-swr-legacy-active": [
            [TILE_URL, new Response("poisoned", { status: 503 })],
            ["/_next/static/chunks/legacy.js", staticResponse],
          ],
          "pubmax-sw-plan-legacy-active": [
            ["/plan/offline-night", planResponse],
          ],
          "unrelated-cache": [["/unrelated", new Response("unrelated")]],
        },
      });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(deletedCaches).toEqual([]);
    expect(
      records.get("pubmax-sw-swr-legacy-active")?.has(TILE_URL),
    ).toBe(false);
    expect(
      records
        .get("pubmax-sw-swr-legacy-active")
        ?.has("https://pubmaxxing.com/_next/static/chunks/legacy.js"),
    ).toBe(true);
    expect(records.has("pubmax-sw-shell-legacy-active")).toBe(true);
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(true);
    expect(records.has("pubmax-sw-plan-legacy-active")).toBe(true);
    expect(records.has("unrelated-cache")).toBe(true);
    expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();

    const navigation = dispatchFetch(
      listeners.get("fetch")!,
      {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/map",
      } as Request,
    );
    await expect(navigation.response).resolves.toBe(shellResponse);
    expect(await fakeCaches.keys()).toContain(
      "pubmax-sw-shell-legacy-active",
    );

    const planNavigation = dispatchFetch(
      listeners.get("fetch")!,
      {
        method: "GET",
        mode: "navigate",
        url: "https://pubmaxxing.com/plan/offline-night",
      } as Request,
    );
    await expect(planNavigation.response).resolves.toBe(planResponse);
    expect(importScripts).toHaveBeenCalledWith("/sw-plan-cache.js?v=target");
  });

  it("migrates shell entries without promoting old stable data", async () => {
    const { deletedCaches, fakeSelf, listeners, records } =
      rolloutWorkerHarness({
        entries: {
          "pubmax-sw-shell-legacy-active": [
            ["/map", new Response("offline map")],
          ],
          "pubmax-sw-data-legacy-active": [
            ["/data/venues_slim.core.json", new Response("legacy data")],
          ],
        },
      });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    expect(deletedCaches).toEqual(["pubmax-sw-shell-legacy-active"]);
    expect(
      records
        .get("pubmax-sw-shell-target")
        ?.has("https://pubmaxxing.com/map"),
    ).toBe(true);
    expect(
      records
        .get("pubmax-sw-data-target")
        ?.has("https://pubmaxxing.com/data/venues_slim.core.json"),
    ).toBe(false);
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(true);
    expect(fakeSelf.clients.claim).toHaveBeenCalledOnce();
  });

  it("does not use old stable data after current cache and network miss", async () => {
    const oldData = new Response("legacy data");
    const { listeners, records } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.core.json", oldData],
        ],
      },
    });

    const activation = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(activation)).resolves.toBeDefined();
    expect(
      records
        .get("pubmax-sw-data-target")
        ?.has("https://pubmaxxing.com/data/venues_slim.core.json"),
    ).toBe(false);

    const data = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );
    const response = (await data.response) as Response;
    expect(response.type).toBe("error");
    expect(response).not.toBe(oldData);
  });

  it("does not serve an incompatible venue manifest from an old cache", async () => {
    const legacyManifest = new Response(
      JSON.stringify({
        version: 1,
        shards: [{ url: "/data/venues_slim.borough.json" }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    const { listeners } = rolloutWorkerHarness({
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.manifest.json", legacyManifest],
        ],
      },
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.manifest.json"),
    );
    const response = (await event.response) as Response;

    expect(response.type).toBe("error");
    expect(response.status).toBe(0);
  });

  it("prefers fresh network data over an old stable-data fallback", async () => {
    const oldData = new Response(JSON.stringify({ revision: "legacy", rows: [] }));
    const freshData = new Response(JSON.stringify({ revision: "target", rows: [] }));
    Object.defineProperty(freshData, "type", { value: "basic" });
    const { listeners, records } = rolloutWorkerHarness({
      response: freshData,
      entries: {
        "pubmax-sw-data-legacy-active": [
          ["/data/venues_slim.core.json", oldData],
        ],
      },
    });

    const activation = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(activation)).resolves.toBeDefined();

    const data = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );
    await expect(data.response).resolves.toBe(freshData);
    await expect(Promise.all(data.lifetime)).resolves.toBeDefined();
    const stored = records
      .get("pubmax-sw-data-target")
      ?.get("https://pubmaxxing.com/data/venues_slim.core.json")
      ?.response;
    expect(await stored?.text()).toBe(JSON.stringify({ revision: "target", rows: [] }));
    expect(records.has("pubmax-sw-data-legacy-active")).toBe(false);
  });

  it("does not serve a poisoned OpenFreeMap entry retained in an old cache", async () => {
    const poisoned = new Response("poisoned", { status: 503 });
    const { listeners } = rolloutWorkerHarness({
      rejectCurrentWrites: true,
      entries: {
        "pubmax-sw-swr-legacy-active": [
          [TILE_URL, poisoned],
          ["/_next/static/chunks/legacy.js", new Response("legacy static")],
        ],
      },
    });

    const lifetime = dispatchLifecycle(listeners.get("activate")!);
    await expect(Promise.all(lifetime)).resolves.toBeDefined();

    const tile = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );
    const response = (await tile.response) as Response;
    expect(response.type).toBe("error");
    expect(response).not.toBe(poisoned);
  });

  it("returns a successful tile when Cache Storage rejects the write", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners, put } = workerHarness({
      response: networkResponse,
      putError: new DOMException("Storage quota exceeded", "QuotaExceededError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    expect(event.response).not.toBeNull();
    await expect(event.response).resolves.toBe(networkResponse);
    expect(put).toHaveBeenCalledOnce();
  });

  it("does not cache a tile when its host forbids storage", async () => {
    const networkResponse = fakeResponse("cors", true, "no-store");
    const { listeners, put } = workerHarness({ response: networkResponse });
    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    await expect(Promise.all(event.lifetime)).resolves.toBeDefined();
    expect(put).not.toHaveBeenCalled();
  });

  it("returns successful static data when Cache Storage rejects the write", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners, put } = workerHarness({
      response: networkResponse,
      putError: new DOMException("Storage quota exceeded", "QuotaExceededError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request("https://pubmaxxing.com/data/venues_slim.core.json"),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    expect(put).toHaveBeenCalledOnce();
  });

  it("returns a successful tile when cache trimming rejects", async () => {
    const networkResponse = fakeResponse("cors");
    const { listeners } = workerHarness({
      response: networkResponse,
      trimError: new DOMException("Cache read failed", "InvalidStateError"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    await expect(event.response).resolves.toBe(networkResponse);
    await expect(Promise.all(event.lifetime)).resolves.toEqual([undefined]);
  });

  it("intercepts cross-origin OpenFreeMap reads", () => {
    const { listeners } = workerHarness({ response: fakeResponse("cors") });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );

    expect(event.response).not.toBeNull();
  });

  it("passes an opaque network response through without caching it", async () => {
    const opaque = fakeResponse("opaque", false);
    const { listeners, put } = workerHarness({ response: opaque });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "no-cors" }),
    );

    await expect(event.response).resolves.toBe(opaque);
    expect(put).not.toHaveBeenCalled();
  });

  it("returns an error response only when network and cache both miss", async () => {
    const { listeners } = workerHarness({
      fetchError: new TypeError("network unavailable"),
    });

    const event = dispatchFetch(
      listeners.get("fetch")!,
      new Request(TILE_URL, { mode: "cors" }),
    );
    const response = (await event.response) as Response;

    expect(response.type).toBe("error");
    expect(response.status).toBe(0);
  });
});
