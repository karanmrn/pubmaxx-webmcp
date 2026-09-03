import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSurfaceCache,
  DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS,
  isSurfaceCacheable,
  loadSurfaceJson,
  readSurfaceSnapshot,
  surfaceCacheSize,
  SURFACE_CACHE_DENIED_PREFIXES,
  writeSurfaceSnapshot,
} from "@/lib/surfaceDataCache";
import { DEVICE_IDENTITY_CHANGED_EVENT } from "@/lib/deviceAccountIdentity";

// The client surface cache is what makes a returning tab paint its last answer
// instead of an empty frame. These are the rules that make holding an answer
// past a navigation safe: identity is never held (and a denied key throws, so a
// computed one cannot slip through either), an account boundary drops
// everything, an entry ages out, the server never keeps a store at all, and a
// failed revalidate never blanks a surface that already had real data on it.

beforeEach(() => {
  // The store is browser-only by design (see the module header). The suite runs
  // in Node, so give it the one browser thing it uses: an event target for the
  // device-identity announcement.
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

describe("what the store may hold", () => {
  it("refuses every denied prefix, loudly rather than silently", () => {
    for (const prefix of SURFACE_CACHE_DENIED_PREFIXES) {
      const key = `${prefix}/whoever`;
      expect(isSurfaceCacheable(key)).toBe(false);
      expect(() => readSurfaceSnapshot(key)).toThrow(/refuses/);
      expect(() => writeSurfaceSnapshot(key, { a: 1 })).toThrow(/refuses/);
    }
  });

  it("refuses a denied key that was computed rather than written out", async () => {
    const segment = ["identity", "handle", "resolve"].join("/");
    await expect(
      loadSurfaceJson(`/api/${segment}?handle=karan`, {}, () => {}),
    ).rejects.toThrow(/refuses/);
  });

  it("holds the ordinary public reads a tab makes", () => {
    for (const key of [
      "/api/whats-on?window=tonight&limit=60",
      "/api/pint-drops?author=karan",
      "/api/profiles/karan?viewer=sam",
      "/api/crawls?author=karan",
    ]) {
      expect(isSurfaceCacheable(key)).toBe(true);
    }
  });

  it("names auth and identity in the denied set", () => {
    expect(SURFACE_CACHE_DENIED_PREFIXES).toContain("/api/auth");
    expect(SURFACE_CACHE_DENIED_PREFIXES).toContain("/api/identity");
    expect(SURFACE_CACHE_DENIED_PREFIXES).toContain("/api/admin");
    expect(SURFACE_CACHE_DENIED_PREFIXES).toContain("/api/price-impact");
  });
});

describe("the server keeps nothing", () => {
  it("never holds an answer when there is no window to hold it for", () => {
    vi.stubGlobal("window", undefined);
    writeSurfaceSnapshot("/api/profiles/karan", { profile: 1 });
    expect(surfaceCacheSize()).toBe(0);
    expect(readSurfaceSnapshot("/api/profiles/karan")).toBeUndefined();
  });
});

describe("how long an answer stands", () => {
  it("returns a young entry and drops one past its age", () => {
    writeSurfaceSnapshot("/api/whats-on?x", { rows: 3 }, 1_000);
    expect(readSurfaceSnapshot("/api/whats-on?x", 10_000, 5_000)).toEqual({ rows: 3 });
    expect(readSurfaceSnapshot("/api/whats-on?x", 10_000, 20_000)).toBeUndefined();
    // The expired entry is dropped rather than left to be re-read.
    expect(surfaceCacheSize()).toBe(0);
  });

  it("has a default ceiling rather than an open one", () => {
    expect(DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_SURFACE_SNAPSHOT_MAX_AGE_MS)).toBe(true);
  });
});

describe("the account boundary", () => {
  it("drops every held answer when the device identity changes", () => {
    writeSurfaceSnapshot("/api/profiles/karan?viewer=karan", { profile: 1 });
    writeSurfaceSnapshot("/api/pint-drops?author=karan", { drops: [] });
    expect(surfaceCacheSize()).toBe(2);
    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));
    expect(surfaceCacheSize()).toBe(0);
  });
});

describe("stale-while-revalidate", () => {
  it("applies the held answer first, then the network one", async () => {
    writeSurfaceSnapshot("/api/pint-drops?author=karan", { drops: ["held"] });
    const applied: Array<[unknown, string]> = [];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ drops: ["fresh"] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const outcome = await loadSurfaceJson<{ drops: string[] }>(
      "/api/pint-drops?author=karan",
      { fetchImpl },
      (value, source) => {
        applied.push([value, source]);
      },
    );

    expect(applied).toEqual([
      [{ drops: ["held"] }, "snapshot"],
      [{ drops: ["fresh"] }, "network"],
    ]);
    expect(outcome).toBe("network");
  });

  it("reports failure only when nothing was on screen", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    const cold = await loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {});
    expect(cold).toBe("failed");

    writeSurfaceSnapshot("/api/crawls?author=karan", { count: 2 });
    const seeded = await loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {});
    expect(seeded).toBe("snapshot");
  });

  it("never applies an answer after the caller aborted", async () => {
    writeSurfaceSnapshot("/api/crawls?author=karan", { count: 2 });
    const controller = new AbortController();
    controller.abort();
    const applied: unknown[] = [];
    const fetchImpl = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as unknown as typeof fetch;
    await loadSurfaceJson(
      "/api/crawls?author=karan",
      { fetchImpl, signal: controller.signal },
      (value) => {
        applied.push(value);
      },
    );
    expect(applied).toEqual([]);
  });

  it("does not hold a non-ok response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    await loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {});
    expect(surfaceCacheSize()).toBe(0);
  });

  it("retries one transient response and applies only its good answer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [1] }), { status: 200 }),
      );
    const applied: Array<[unknown, string]> = [];

    await expect(
      loadSurfaceJson("/api/whats-on?window=tonight", { fetchImpl }, (value, source) => {
        applied.push([value, source]);
      }),
    ).resolves.toBe("network");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(applied).toEqual([[{ rows: [1] }, "network"]]);
  });

  it("retries one transient network failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2 }), { status: 200 }));

    await expect(
      loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {}),
    ).resolves.toBe("network");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent response", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("no", { status: 404 }),
    );

    await expect(
      loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {}),
    ).resolves.toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the snapshot after both transient attempts fail", async () => {
    writeSurfaceSnapshot("/api/crawls?author=karan", { count: 2 });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("busy", { status: 503 }));

    await expect(
      loadSurfaceJson("/api/crawls?author=karan", { fetchImpl }, () => {}),
    ).resolves.toBe("snapshot");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not remember a response that the caller rejects", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 200 }),
    );

    await expect(
      loadSurfaceJson(
        "/api/whats-on?window=tonight",
        {
          fetchImpl,
          validate: (value: { error?: string }) => value.error === undefined,
        },
        () => {},
      ),
    ).resolves.toBe("failed");
    expect(surfaceCacheSize()).toBe(0);
  });

  it("lets a parsed error stay out of last-good memory", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 200 }),
    );

    await expect(
      loadSurfaceJson(
        "/api/whats-on?window=tonight",
        { fetchImpl },
        () => false,
      ),
    ).resolves.toBe("network");
    expect(surfaceCacheSize()).toBe(0);
  });

  it("does not spend the retry after the caller aborts during backoff", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("busy", { status: 503 }),
    );
    const pending = loadSurfaceJson(
      "/api/whats-on?window=tonight",
      { fetchImpl, signal: controller.signal },
      () => {},
    );
    setTimeout(() => controller.abort(), 5);

    await expect(pending).resolves.toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

type SessionStorageOptions = {
  setItem?: (key: string, value: string) => void;
  getItem?: (key: string) => string | null;
};

function makeSessionStorage(options: SessionStorageOptions = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return options.getItem ? options.getItem(key) : values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      if (options.setItem) {
        options.setItem(key, value);
        return;
      }
      values.set(key, value);
    },
  } as Storage;
}

function stubBrowserWithSessionStorage(sessionStorage: Storage): void {
  const browser = new EventTarget() as EventTarget & { sessionStorage: Storage };
  browser.sessionStorage = sessionStorage;
  vi.stubGlobal("window", browser);
}

async function importFreshSurfaceDataCache() {
  vi.resetModules();
  return import("@/lib/surfaceDataCache");
}

describe("persistent session snapshots", () => {
  it("rehydrates a last-good answer after module state is reset", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/whats-on?window=tonight";

    writeSurfaceSnapshot(key, { rows: ["held"] }, 1_000);
    const reloaded = await importFreshSurfaceDataCache();

    expect(reloaded.surfaceCacheSize()).toBe(0);
    expect(reloaded.readSurfaceSnapshot(key, 10_000, 5_000)).toEqual({
      rows: ["held"],
    });
    expect(reloaded.surfaceCacheSize()).toBe(1);
  });

  it("never persists a denied-prefix answer", () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);

    expect(() => writeSurfaceSnapshot("/api/identity/onboarding", { complete: true })).toThrow(
      /refuses/,
    );
    expect(sessionStorage.length).toBe(0);
  });

  it("wipes persisted answers on an identity change", () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/profiles/karan?viewer=karan";

    writeSurfaceSnapshot(key, { profile: 1 });
    expect(sessionStorage.length).toBe(1);

    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));

    expect(sessionStorage.length).toBe(0);
    expect(surfaceCacheSize()).toBe(0);
  });

  it("wipes persisted answers when identity changes before the first cache read", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const { SURFACE_CACHE_NAMESPACE } = await importFreshSurfaceDataCache();
    const key = "/api/profiles/karan?viewer=karan";
    sessionStorage.setItem(
      `${SURFACE_CACHE_NAMESPACE}${key}`,
      JSON.stringify({ value: { profile: 1 }, storedAt: 1_000 }),
    );

    window.dispatchEvent(new Event(DEVICE_IDENTITY_CHANGED_EVENT));

    expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();
  });

  it("wipes persisted answers when a cross-tab storage event announces identity change", () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/profiles/karan?viewer=karan";

    writeSurfaceSnapshot(key, { profile: 1 });
    window.dispatchEvent(new Event("storage"));

    expect(sessionStorage.length).toBe(0);
    expect(surfaceCacheSize()).toBe(0);
  });

  it("prunes a corrupt persisted answer", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const { SURFACE_CACHE_NAMESPACE } = await importFreshSurfaceDataCache();
    const key = "/api/whats-on?window=tonight";
    sessionStorage.setItem(`${SURFACE_CACHE_NAMESPACE}${key}`, "not-json");

    const reloaded = await importFreshSurfaceDataCache();

    expect(reloaded.readSurfaceSnapshot(key)).toBeUndefined();
    expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();
  });

  it("keeps memory-only behaviour when sessionStorage quota rejects a write", async () => {
    const sessionStorage = makeSessionStorage({
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    });
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/whats-on?window=tonight";

    expect(() => writeSurfaceSnapshot(key, { rows: ["held"] }, 1_000)).not.toThrow();
    const reloaded = await importFreshSurfaceDataCache();

    expect(reloaded.readSurfaceSnapshot(key, 10_000, 5_000)).toBeUndefined();
  });

  it("prunes a persisted answer when maxAgeMs says it is stale", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const { SURFACE_CACHE_NAMESPACE } = await importFreshSurfaceDataCache();
    const key = "/api/whats-on?window=tonight";
    sessionStorage.setItem(
      `${SURFACE_CACHE_NAMESPACE}${key}`,
      JSON.stringify({ value: { rows: ["old"] }, storedAt: 1_000 }),
    );
    const reloaded = await importFreshSurfaceDataCache();

    expect(reloaded.readSurfaceSnapshot(key, 100, 1_101)).toBeUndefined();
    expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toBeNull();
  });

  it("does not apply a persisted answer rejected by the caller validator", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const { SURFACE_CACHE_NAMESPACE, loadSurfaceJson: loadFreshSurfaceJson } =
      await importFreshSurfaceDataCache();
    const key = "/api/whats-on?window=tonight";
    sessionStorage.setItem(
      `${SURFACE_CACHE_NAMESPACE}${key}`,
      JSON.stringify({ value: { unexpected: true }, storedAt: Date.now() }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ rows: ["fresh"] }), { status: 200 }),
    );
    const applied: Array<[unknown, string]> = [];

    await expect(
      loadFreshSurfaceJson(
        key,
        {
          fetchImpl,
          validate: (value: { rows?: unknown }) => Array.isArray(value.rows),
        },
        (value, source) => {
          applied.push([value, source]);
        },
      ),
    ).resolves.toBe("network");

    expect(applied).toEqual([[{ rows: ["fresh"] }, "network"]]);
    expect(sessionStorage.getItem(`${SURFACE_CACHE_NAMESPACE}${key}`)).toContain(
      '"rows":["fresh"]',
    );
  });

  it("prunes entries from older namespace versions", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/whats-on?window=tonight";
    sessionStorage.setItem(
      `pubmax.surface.v0:${key}`,
      JSON.stringify({ value: { rows: ["old"] }, storedAt: 1_000 }),
    );
    const reloaded = await importFreshSurfaceDataCache();

    expect(reloaded.readSurfaceSnapshot(key)).toBeUndefined();
    expect(sessionStorage.getItem(`pubmax.surface.v0:${key}`)).toBeNull();
  });

  it("skips oversized persistence while keeping the memory answer", async () => {
    const sessionStorage = makeSessionStorage();
    stubBrowserWithSessionStorage(sessionStorage);
    const key = "/api/whats-on?window=tonight";
    const value = { rows: ["x".repeat(300_000)] };

    writeSurfaceSnapshot(key, value);
    const reloaded = await importFreshSurfaceDataCache();

    expect(sessionStorage.length).toBe(0);
    expect(reloaded.readSurfaceSnapshot(key)).toBeUndefined();
  });
});
