import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { loadSlimVenuesFromPath, loadSlimVenuesFromPathResult } from "@/lib/venuesSlim";

describe("mapEarlyWarm", () => {
  it("reuses head-start JSON instead of fetching again", async () => {
    const payload = [
      {
        id: "venue-test",
        name: "Test Arms",
        lat: 51.5,
        lng: -0.1,
        cheapestPrice: 500,
        borough: "Camden",
      },
    ];
    vi.stubGlobal("window", {
      __pubmaxMapWarm: {
        json: new Map([["/data/test-slim.json", Promise.resolve(payload)]]),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const rows = await loadSlimVenuesFromPath("/data/test-slim.json");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("venue-test");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("warms granted geolocation cells before the London fallback", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const query = vi.fn(async () => ({ state: "granted" } as PermissionStatus));
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 51.74, longitude: 0.25 } } as GeolocationPosition);
    });
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
    };

    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    const context = {
      window,
      document: { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      navigator: {
        connection: null,
        permissions: { query },
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(query).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain(
      "/data/venues_slim.manifest.json?v=deploy-42",
    );
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/granted.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/london.json");
  });

  it("uses fallback when Permissions API is unavailable", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const getCurrentPosition = vi.fn();
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
    };
    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    const context = {
      window,
      document: { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      navigator: {
        connection: null,
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/granted.json?v=deploy-42");
  });

  it("uses fallback when the permission query fails", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/granted.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    const getCurrentPosition = vi.fn();
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
    };
    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    const context = {
      window,
      document: { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      navigator: {
        connection: null,
        permissions: { query: vi.fn(async () => { throw new Error("unsupported"); }) },
        geolocation: { getCurrentPosition },
      },
      fetch: fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
    };
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      context.document,
      context.navigator,
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/granted.json?v=deploy-42");
  });

  it("uses the fallback when warmup geolocation throws", async () => {
    const manifest = {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/other.json", bbox: [0.1, 51.7, 0.4, 51.75] },
      ],
    };
    const fetchSpy = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => (input === "/data/venues_slim.manifest.json?v=deploy-42" ? manifest : []),
    }));
    let firstPinsListener: (() => void) | undefined;
    const window = {
      innerWidth: 390,
      innerHeight: 844,
      location: { href: "https://pubmaxxing.com/map" },
      localStorage: { getItem: vi.fn(() => null) },
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "pubmax:first-pins") firstPinsListener = listener;
      }),
      dispatchEvent: vi.fn((event: { type: string }) => {
        if (event.type === "pubmax:first-pins") firstPinsListener?.();
        return true;
      }),
    };
    const script = readFileSync(
      new URL("../public/map-first-paint-init.js", import.meta.url),
      "utf8",
    );
    new Function("window", "document", "navigator", "fetch", "Map", "Math", "Number", "Promise", "setTimeout", "URL", script)(
      window,
      { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
      {
        connection: null,
        geolocation: { getCurrentPosition: vi.fn(() => { throw new Error("unsupported"); }) },
      },
      fetchSpy,
      Map,
      Math,
      Number,
      Promise,
      setTimeout,
      URL,
    );
    window.dispatchEvent({ type: "pubmax:first-pins" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchSpy.mock.calls.map(([input]) => input)).toContain("/data/london.json?v=deploy-42");
    expect(fetchSpy.mock.calls.map(([input]) => input)).not.toContain("/data/other.json?v=deploy-42");
  });

  it("rejects a shard payload from another deployment revision", async () => {
    vi.stubGlobal("window", { __pubmaxMapWarm: { json: new Map() } });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: "stale-venue",
          name: "Stale Arms",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: null,
          borough: "Camden",
        },
      ],
    })));

    await expect(
      loadSlimVenuesFromPathResult("/data/venues_slim.cell.stale.json", {
        expectedRevision: "deploy-42",
      }),
    ).resolves.toEqual({ rows: [], status: "unavailable" });

    vi.unstubAllGlobals();
  });
});
