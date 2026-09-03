import { afterEach, describe, expect, it, vi } from "vitest";

// Hermetic: the keyless default (ORS_API_KEY stripped in vitest.setup.ts) is the
// documented path; key-present behaviour is proven with an explicit apiKey +
// injected fetch, never a live network call.

import {
  fetchWalkLeg,
  ORS_FOOT_WALKING_URL,
  orsApiKey,
  type WalkRouteFetch,
} from "@/lib/walkRouteProvider";
import type { LngLat } from "@/lib/walkRoute";

const A: LngLat = [-0.1005, 51.5136];
const B: LngLat = [-0.0975, 51.5142];

function orsResponse(coordinates: number[][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates } }],
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("orsApiKey", () => {
  it("is null by default (keyless) and trims a stubbed key", () => {
    expect(orsApiKey()).toBeNull();
    vi.stubEnv("ORS_API_KEY", "  ork_secret  ");
    expect(orsApiKey()).toBe("ork_secret");
    vi.stubEnv("ORS_API_KEY", "   ");
    expect(orsApiKey()).toBeNull();
  });
});

describe("fetchWalkLeg", () => {
  it("returns null WITHOUT fetching when there is no key", async () => {
    const doFetch = vi.fn<WalkRouteFetch>();
    expect(await fetchWalkLeg(A, B, { apiKey: null, doFetch })).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("routes the leg through ORS and returns the pavement geometry", async () => {
    const routed = [
      [-0.1005, 51.5136],
      [-0.099, 51.5139],
      [-0.0975, 51.5142],
    ];
    const doFetch = vi.fn<WalkRouteFetch>().mockResolvedValue(orsResponse(routed));
    const result = await fetchWalkLeg(A, B, { apiKey: "ork_secret", doFetch });
    expect(result).toEqual(routed);
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe(ORS_FOOT_WALKING_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("ork_secret");
    expect(JSON.parse(init.body)).toEqual({ coordinates: [A, B] });
  });

  it("tolerates ORS elevation as a third coordinate element", async () => {
    const doFetch = vi.fn<WalkRouteFetch>().mockResolvedValue(
      orsResponse([
        [-0.1005, 51.5136, 12],
        [-0.0975, 51.5142, 14],
      ]),
    );
    expect(await fetchWalkLeg(A, B, { apiKey: "k", doFetch })).toEqual([A, B]);
  });

  it("falls back to null on a non-200", async () => {
    const doFetch = vi
      .fn<WalkRouteFetch>()
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    expect(await fetchWalkLeg(A, B, { apiKey: "k", doFetch })).toBeNull();
  });

  it("falls back to null on a malformed payload", async () => {
    const doFetch = vi
      .fn<WalkRouteFetch>()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ features: [] }) });
    expect(await fetchWalkLeg(A, B, { apiKey: "k", doFetch })).toBeNull();
  });

  it("falls back to null when the fetch throws (network error / abort)", async () => {
    const doFetch = vi.fn<WalkRouteFetch>().mockRejectedValue(new Error("boom"));
    expect(await fetchWalkLeg(A, B, { apiKey: "k", doFetch })).toBeNull();
  });

  it("degrades to null when the ORS call outruns the per-call timeout", async () => {
    // A fetch that never resolves on its own — it only settles when the
    // deadline aborts its signal. A tiny timeoutMs proves the bound fires
    // without a real 4s wait.
    const doFetch = vi.fn<WalkRouteFetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    expect(await fetchWalkLeg(A, B, { apiKey: "k", doFetch, timeoutMs: 5 })).toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1);
    // The signal handed to fetch is the bounded deadline signal, and it aborted.
    expect(doFetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it("aborts the leg when the caller's own signal is already aborted", async () => {
    const doFetch = vi.fn<WalkRouteFetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        if (init.signal?.aborted) reject(new DOMException("aborted", "AbortError"));
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
    );
    const controller = new AbortController();
    controller.abort();
    expect(
      await fetchWalkLeg(A, B, { apiKey: "k", doFetch, signal: controller.signal }),
    ).toBeNull();
  });
});
