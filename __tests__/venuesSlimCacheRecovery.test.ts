import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offlineGet = vi.hoisted(() => vi.fn(async () => null as unknown));
const offlineSet = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/offlineCache", () => ({
  offlineCache: {
    get: offlineGet,
    set: offlineSet,
  },
}));

import { loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

const ROW = {
  id: "venue-cache-retry",
  name: "Retry Arms",
  lat: 51.5,
  lng: -0.1,
  cheapestPrice: null,
  borough: "Camden",
};

const FALLBACK_ROW = {
  ...ROW,
  id: "venue-cache-fallback",
  name: "Fallback Arms",
};

const INVALID_ROW = {
  ...ROW,
  id: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

beforeEach(() => {
  offlineGet.mockReset();
  offlineSet.mockReset();
  offlineGet.mockResolvedValue(null);
  offlineSet.mockResolvedValue(true);
});

describe("slim venue cache recovery", () => {
  it("rejects stale old-worker bytes from the revisioned London monolith without mirroring them", async () => {
    vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "target");
    vi.resetModules();
    const staleResponse = {
      ok: true,
      json: async () => ({ revision: "previous", rows: [ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(staleResponse);
    vi.stubGlobal("fetch", fetchSpy);
    const { loadSlimVenues } = await import("@/lib/venuesSlim");

    await expect(loadSlimVenues()).resolves.toEqual([]);

    const path = "/data/venues_slim.json?v=target";
    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(offlineGet).toHaveBeenCalledWith(`venues_slim:v2:${path}`);
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("accepts and mirrors a matching revision from a direct city monolith", async () => {
    vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "target");
    vi.resetModules();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revision: "target", rows: [ROW] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { loadSlimVenuesForCityResult } = await import("@/lib/venuesSlim");

    await expect(loadSlimVenuesForCityResult("manchester")).resolves.toEqual({
      rows: [ROW],
      status: "ready",
    });

    const path = "/data/cities/manchester/venues_slim.json?v=target";
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(path);
    expect(offlineSet).toHaveBeenCalledWith(`venues_slim:v2:${path}`, {
      revision: "target",
      rows: [ROW],
    });
  });

  it("restores a complete matching revision for a direct city monolith while offline", async () => {
    vi.stubEnv("NEXT_PUBLIC_SW_VERSION", "target");
    vi.resetModules();
    offlineGet.mockResolvedValueOnce({
      revision: "target",
      rows: [FALLBACK_ROW],
    });
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);
    const { loadSlimVenuesForCityResult } = await import("@/lib/venuesSlim");

    await expect(loadSlimVenuesForCityResult("manchester")).resolves.toEqual({
      rows: [FALLBACK_ROW],
      status: "ready",
    });

    const path = "/data/cities/manchester/venues_slim.json?v=target";
    expect(fetchSpy).toHaveBeenCalledWith(path);
    expect(offlineGet).toHaveBeenCalledWith(`venues_slim:v2:${path}`);
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("retries a current-revision payload when normalization drops a row", async () => {
    const path = "/data/cache-recovery-incomplete.json";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "target", rows: [ROW, INVALID_ROW] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "target", rows: [ROW] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(offlineSet).toHaveBeenCalledWith(
      `venues_slim:v2:${path}`,
      { revision: "target", rows: [ROW] },
    );
  });

  it("uses a complete current-revision fallback when both network reads are incomplete", async () => {
    const path = "/data/cache-recovery-incomplete-with-fallback.json";
    offlineGet.mockResolvedValueOnce({
      revision: "target",
      rows: [FALLBACK_ROW],
    });
    const incompleteResponse = {
      ok: true,
      json: async () => ({ revision: "target", rows: [ROW, INVALID_ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse)
      .mockResolvedValueOnce(incompleteResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [FALLBACK_ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(offlineGet).toHaveBeenCalledWith(`venues_slim:v2:${path}`);
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("returns no partial rows when every current-revision source is incomplete", async () => {
    const path = "/data/cache-recovery-all-incomplete.json";
    offlineGet.mockResolvedValueOnce({
      revision: "target",
      rows: [FALLBACK_ROW, INVALID_ROW],
    });
    const incompleteResponse = {
      ok: true,
      json: async () => ({ revision: "target", rows: [ROW, INVALID_ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse)
      .mockResolvedValueOnce(incompleteResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });

    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("retries one cache-bypassed read after an expected revision mismatch", async () => {
    const path = "/data/cache-recovery-current.json";
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "previous", rows: [ROW] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ revision: "target", rows: [ROW] }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable after one retry remains stale", async () => {
    const path = "/data/cache-recovery-stale.json";
    const staleResponse = {
      ok: true,
      json: async () => ({ revision: "previous", rows: [ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(staleResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses a current-revision cache after both network reads remain stale", async () => {
    const path = "/data/cache-recovery-stale-with-fallback.json";
    offlineGet.mockResolvedValueOnce({ revision: "target", rows: [ROW] });
    const staleResponse = {
      ok: true,
      json: async () => ({ revision: "previous", rows: [ROW] }),
    };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(staleResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).resolves.toEqual({ rows: [ROW], status: "ready" });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, path);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, path, { cache: "no-store" });
    expect(offlineGet).toHaveBeenCalledWith(
      `venues_slim:v2:${path}`,
    );
    expect(offlineSet).not.toHaveBeenCalled();
  });

  it("does not retry a request abort as cache recovery", async () => {
    const path = "/data/cache-recovery-abort.json";
    const abort = new DOMException("aborted", "AbortError");
    const fetchSpy = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      loadSlimVenuesFromPathResult(path, { expectedRevision: "target" }),
    ).rejects.toBe(abort);
    expect(fetchSpy).toHaveBeenCalledWith(path);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
