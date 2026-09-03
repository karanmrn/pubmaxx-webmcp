import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/tonight-conditions/route";
import { resolveTonightConditions } from "@/lib/tonightConditionsRoute";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { WeatherSnapshot } from "@/lib/weatherSnapshots";

// Hermetic weather fixtures. These tests must NOT read the shipped
// public/data/weather/latest.json — the live refresh workflow rewrites it (0 or
// 20 observations depending on the day), which would make assertions flap. We
// inject snapshots through the route's `snapshot` seam instead, and drive a
// fixed clock so the rules table is deterministic.

const NOW = new Date("2026-07-18T19:00:00.000Z"); // a July (month 7) evening

function snapshot(observations: WeatherSnapshot["observations"]): WeatherSnapshot {
  return { version: 1, generatedAt: "2026-07-18T18:50:00.000Z", observations };
}

// Warm and dry over Piccadilly & Soho (the default area, and the nearest area to
// the central point used below). On this July clock the summer-garden beer-garden
// rule fires.
const WARM_DRY = snapshot([
  {
    nightArea: "piccadilly-soho",
    observedAt: "2026-07-18T18:45:00.000Z",
    expiresAt: "2026-07-19T06:45:00.000Z",
    condition: "Clear",
    feelsLikeC: 22,
    precipitationProbabilityPct: 0,
    windKph: 12,
    source: {
      sourceUrl: "https://api.open-meteo.com/v1/forecast?piccadilly",
      publisher: "Open-Meteo",
      publishedAt: "2026-07-18T18:45:00.000Z",
    },
  },
]);

const EMPTY = snapshot([]);

// A central point (Piccadilly Circus-ish), [lng, lat] per the app convention.
const CENTRE: [number, number] = [-0.134, 51.511];

function gardenVenue(id: string, cheapestPrice: number | null): ConciergeVenue {
  return {
    id,
    name: `Garden ${id}`,
    area: "Soho",
    lat: 51.512,
    lng: -0.135,
    cheapestPrice,
    amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false,
    hasStory: false,
    canonical: true,
  };
}

describe("resolveTonightConditions (hermetic weather seam)", () => {
  it("empty fixture -> summary null (never invents weather)", async () => {
    const summary = await resolveTonightConditions({ point: null, now: NOW, snapshot: EMPTY });
    expect(summary).toBeNull();
  });

  it("populated fixture with a location -> summary present, rule applied, venue claim from injected venues", async () => {
    const summary = await resolveTonightConditions({
      point: CENTRE,
      now: NOW,
      snapshot: WARM_DRY,
      loadVenues: async () => [gardenVenue("a", 5.2), gardenVenue("b", 5.8), gardenVenue("c", 7.5)],
    });
    expect(summary).toMatchObject({
      dateLabel: "Saturday 18 Jul",
      weatherLabel: "22°C, clear",
      drinkLine: "Beer garden weather. Lager or cider.",
      venueClaim: "2 gardens near you with a pint under 6 quid",
    });
  });

  it("populated fixture with no location -> summary present WITHOUT a venue claim", async () => {
    // Malformed coordinates collapse to point:null (see the GET parse test
    // below); with no location there is no "near you" claim to make, but the
    // date, weather and drink line still stand.
    const summary = await resolveTonightConditions({ point: null, now: NOW, snapshot: WARM_DRY });
    expect(summary).not.toBeNull();
    expect(summary?.drinkLine).toBe("Beer garden weather. Lager or cider.");
    expect(summary?.venueClaim).toBeNull();
  });

  it("does not load venues when there is no location, even with a populated fixture", async () => {
    let loaded = false;
    const summary = await resolveTonightConditions({
      point: null,
      now: NOW,
      snapshot: WARM_DRY,
      loadVenues: async () => {
        loaded = true;
        return [];
      },
    });
    expect(loaded).toBe(false);
    expect(summary?.venueClaim).toBeNull();
  });
});

describe("GET /api/tonight-conditions", () => {
  function call(query = ""): Promise<Response> {
    return GET(new Request(`https://pubmaxxing.com/api/tonight-conditions${query}`));
  }

  // These GET tests exercise the request plumbing only (status, headers, shape)
  // and must stay independent of whatever the shipped snapshot currently holds.
  it("always answers 200 with no-store and a summary field", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { summary: unknown };
    expect(body).toHaveProperty("summary");
  });

  it("accepts an optional rounded location without throwing", async () => {
    const res = await call("?lat=51.511&lng=-0.134");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("summary");
  });

  it("ignores malformed coordinates and still answers cleanly", async () => {
    const res = await call("?lat=not-a-number&lng=999");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("summary");
  });
});
