import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import {
  buildOgMapCardWaveLayers,
  waveColour,
} from "@/lib/cityMapCardWaves";
import { GET } from "@/app/api/city-map-card/route";
import { __resetPintDrops } from "@/lib/pintDrops";

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  __resetPintDrops();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/city-map-card", () => {
  it("renders a non-empty PNG for a known city", async () => {
    const response = await GET(
      new Request("http://localhost/api/city-map-card?city=london", {
        headers: { "x-forwarded-for": "198.51.100.60" },
      }),
    );
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("429s after 30 requests/min from one IP, matching sibling OG card routes", async () => {
    const url = "http://localhost/api/city-map-card?city=london";
    const responses: Response[] = [];
    for (let i = 0; i < 31; i++) {
      responses.push(
        await GET(
          new Request(url, { headers: { "x-forwarded-for": "198.51.100.61" } }),
        ),
      );
    }
    expect(responses.slice(0, 30).every((res) => res.status === 200)).toBe(true);
    expect(responses[30].status).toBe(429);
  });
});

describe("buildOgMapCardWaveLayers", () => {
  it("produces a different composition for a different real band distribution", () => {
    const cheapHeavy = buildOgMapCardWaveLayers([6, 1, 1]);
    const dearHeavy = buildOgMapCardWaveLayers([1, 1, 6]);
    expect(cheapHeavy).not.toEqual(dearHeavy);
    expect(cheapHeavy.map((layer) => layer.path)).not.toEqual(
      dearHeavy.map((layer) => layer.path),
    );
  });

  it("emits nothing for an all-empty city, rather than an invented wave", () => {
    expect(buildOgMapCardWaveLayers([0, 0, 0])).toEqual([]);
  });
});

describe("waveColour", () => {
  it("stays inside the three-colour palette as ink, paper, or coral washes", () => {
    // rgb triples for ink near-black, warm paper, coral accent.
    const paletteRgb = new Set(["25,25,39", "255,244,232", "255,90,95"]);
    for (const band of [0, 1, 2] as const) {
      const match = waveColour(band).match(/rgba\((\d+,\d+,\d+),/);
      expect(match).not.toBeNull();
      expect(paletteRgb.has(match![1])).toBe(true);
    }
  });
});
