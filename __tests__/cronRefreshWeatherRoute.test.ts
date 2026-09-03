import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic route test: no Supabase env (so the store is process-memory) and the
// Open-Meteo provider is driven through a stubbed global fetch — no live network.

import { GET } from "@/app/api/cron/refresh-weather/route";
import { memoryWeatherSnapshotStore, __resetWeatherSnapshotStore } from "@/lib/weatherSnapshotStore";
import { NIGHT_AREA_SLUGS } from "@/lib/nightAreas";

// A time ~1h in the past, in Open-Meteo's "YYYY-MM-DDTHH:MM" shape (the provider
// appends "Z"); guarantees observedAt < generatedAt for the contract.
function openMeteoTime(): string {
  return new Date(Date.now() - 3_600_000).toISOString().slice(0, 16);
}

function okPayload() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      current: { time: openMeteoTime(), apparent_temperature: 18, weather_code: 1, wind_speed_10m: 10 },
      hourly: { precipitation_probability: [20] },
    }),
  };
}

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-weather", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetWeatherSnapshotStore();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/cron/refresh-weather", () => {
  it("401s without the cron secret", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("writes fresh observations to the store on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okPayload()));
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.written).toBe(NIGHT_AREA_SLUGS.length);
    const snap = await memoryWeatherSnapshotStore.readSnapshot();
    expect(snap?.observations).toHaveLength(NIGHT_AREA_SLUGS.length);
  });

  it("502s and writes nothing when the provider is down (never fakes data)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(502);
    expect(await memoryWeatherSnapshotStore.readSnapshot()).toBeNull();
  });
});
