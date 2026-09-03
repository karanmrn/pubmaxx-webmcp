import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// public/sw-plan-cache.js is a plain SW module (no imports, attaches to `self`).
// We evaluate it in a sandbox with a fake `self` carrying a mock CacheStorage,
// so the real caching/eviction logic is exercised hermetically — no browser,
// no network. Same file, same code path that ships to the service worker.

type MockResponse = { ok: boolean; body: string; clone(): MockResponse };
function res(body: string, ok = true): MockResponse {
  return { ok, body, clone: () => res(body, ok) };
}

class MockCache {
  // [key, response] in insertion order == Cache semantics (put re-appends).
  private store: Array<[string, MockResponse]> = [];
  async put(key: string, response: MockResponse) {
    this.store = this.store.filter(([k]) => k !== key);
    this.store.push([key, response]);
  }
  async keys() {
    return this.store.map(([k]) => k);
  }
  async delete(key: string) {
    const before = this.store.length;
    this.store = this.store.filter(([k]) => k !== key);
    return before !== this.store.length;
  }
  async match(key: string) {
    const hit = this.store.find(([k]) => k === key);
    return hit ? hit[1] : undefined;
  }
}

type PlanCacheApi = {
  MAX_PLAN_ENTRIES: number;
  isPlanPath(pathname: string): boolean;
  planEvictionKeys(keys: string[], max: number): string[];
  trimPlanCache(name: string, max: number): Promise<void>;
  cachePlanNavigation(
    request: unknown,
    response: MockResponse,
    url: { pathname: string },
    name: string,
  ): Promise<void>;
  matchPlanNavigation(
    url: { pathname: string },
    name: string,
  ): Promise<MockResponse | undefined>;
};

function loadModule() {
  const src = readFileSync(
    join(process.cwd(), "public/sw-plan-cache.js"),
    "utf8",
  );
  const caches = {
    map: new Map<string, MockCache>(),
    open(name: string): Promise<MockCache> {
      let cache = this.map.get(name);
      if (!cache) {
        cache = new MockCache();
        this.map.set(name, cache);
      }
      return Promise.resolve(cache);
    },
  };
  const self: { caches: typeof caches; planCache?: PlanCacheApi } = { caches };
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function("self", "module", "exports", src)(self, mod, mod.exports);
  return { planCache: self.planCache as PlanCacheApi, caches };
}

const NAME = "pubmax-sw-plan-test";

describe("sw-plan-cache: path matching", () => {
  const { planCache } = loadModule();
  it("matches locked-plan permalinks with an id", () => {
    expect(planCache.isPlanPath("/plan/abc123")).toBe(true);
    expect(planCache.isPlanPath("/p/xyz")).toBe(true);
    expect(planCache.isPlanPath("/plan/abc/deep")).toBe(true);
  });
  it("rejects composer roots, other routes, and API paths", () => {
    for (const p of ["/plan", "/plan/", "/p", "/p/", "/", "/map", "/tonight", "/api/plans/abc", "/planner"]) {
      expect(planCache.isPlanPath(p)).toBe(false);
    }
  });
});

describe("sw-plan-cache: eviction rule (pure)", () => {
  const { planCache } = loadModule();
  it("keeps everything when at or under the bound", () => {
    expect(planCache.planEvictionKeys(["/plan/a", "/plan/b"], 10)).toEqual([]);
    expect(planCache.planEvictionKeys(new Array(10).fill(0).map((_, i) => `/plan/${i}`), 10)).toEqual([]);
  });
  it("drops the oldest (front) surplus when over the bound", () => {
    const keys = new Array(12).fill(0).map((_, i) => `/plan/${i}`);
    expect(planCache.planEvictionKeys(keys, 10)).toEqual(["/plan/0", "/plan/1"]);
  });
  it("is defensive about non-array input", () => {
    expect(planCache.planEvictionKeys(undefined as unknown as string[], 10)).toEqual([]);
  });
});

describe("sw-plan-cache: cache + fallback behaviour", () => {
  it("stores a successful plan navigation and reads it back offline", async () => {
    const { planCache } = loadModule();
    await planCache.cachePlanNavigation({}, res("<plan/>"), { pathname: "/plan/night1" }, NAME);
    const hit = await planCache.matchPlanNavigation({ pathname: "/plan/night1" }, NAME);
    expect(hit?.body).toBe("<plan/>");
  });

  it("keys by pathname so a re-open with a different query hits the same entry", async () => {
    const { planCache } = loadModule();
    await planCache.cachePlanNavigation({}, res("<plan/>"), { pathname: "/plan/night1" }, NAME);
    // matchPlanNavigation is called with the pathname; query never reaches it.
    const hit = await planCache.matchPlanNavigation({ pathname: "/plan/night1" }, NAME);
    expect(hit?.body).toBe("<plan/>");
  });

  it("never caches non-ok or non-plan responses", async () => {
    const { planCache } = loadModule();
    await planCache.cachePlanNavigation({}, res("boom", false), { pathname: "/plan/bad" }, NAME);
    await planCache.cachePlanNavigation({}, res("home"), { pathname: "/" }, NAME);
    expect(await planCache.matchPlanNavigation({ pathname: "/plan/bad" }, NAME)).toBeUndefined();
    expect(await planCache.matchPlanNavigation({ pathname: "/" }, NAME)).toBeUndefined();
  });

  it("returns undefined for a plan never cached", async () => {
    const { planCache } = loadModule();
    expect(await planCache.matchPlanNavigation({ pathname: "/plan/ghost" }, NAME)).toBeUndefined();
  });

  it("bounds the cache to the last 10 plans, evicting least-recently-cached", async () => {
    const { planCache, caches } = loadModule();
    for (let i = 0; i < 12; i++) {
      await planCache.cachePlanNavigation({}, res(`p${i}`), { pathname: `/plan/${i}` }, NAME);
    }
    const cache = await caches.open(NAME);
    const keys = await cache.keys();
    expect(keys).toHaveLength(10);
    // 0 and 1 were the oldest → evicted; 2..11 survive.
    expect(await planCache.matchPlanNavigation({ pathname: "/plan/0" }, NAME)).toBeUndefined();
    expect(await planCache.matchPlanNavigation({ pathname: "/plan/1" }, NAME)).toBeUndefined();
    expect((await planCache.matchPlanNavigation({ pathname: "/plan/11" }, NAME))?.body).toBe("p11");
  });

  it("re-opening an older plan refreshes it to the newest slot (LRU, not FIFO)", async () => {
    const { planCache } = loadModule();
    for (let i = 0; i < 10; i++) {
      await planCache.cachePlanNavigation({}, res(`p${i}`), { pathname: `/plan/${i}` }, NAME);
    }
    // Re-open plan 0 → moves to the freshest slot.
    await planCache.cachePlanNavigation({}, res("p0-again"), { pathname: "/plan/0" }, NAME);
    // Now add a fresh plan → the eviction victim is plan 1, not plan 0.
    await planCache.cachePlanNavigation({}, res("p10"), { pathname: "/plan/10" }, NAME);
    expect(await planCache.matchPlanNavigation({ pathname: "/plan/1" }, NAME)).toBeUndefined();
    expect((await planCache.matchPlanNavigation({ pathname: "/plan/0" }, NAME))?.body).toBe("p0-again");
  });
});
