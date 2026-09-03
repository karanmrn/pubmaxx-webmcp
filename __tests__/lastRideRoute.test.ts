import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

import { describe, expect, it } from "vitest";

import { GET as lastMerseyrail } from "@/app/api/last-merseyrail/route";
import { GET as lastSubway } from "@/app/api/last-subway/route";
import { GET as lastTram } from "@/app/api/last-tram/route";
import { LAST_RIDE_CITY_IDS, venuePackIncludesFor } from "@/lib/cityVenuePacks.mjs";
import { RUNTIME_DATA_PACKS } from "@/lib/venueIndexTracing.mjs";

const LAST_RIDE_ROUTES = [
  "app/api/last-subway/route.ts",
  "app/api/last-merseyrail/route.ts",
  "app/api/last-tram/route.ts",
] as const;

/** Same shape as the three thin wrappers; only provider-specific names differ. */
function providerNeutralRouteBody(source: string): string {
  return source
    .replace(/^import[\s\S]*?(?=^export)/m, "")
    .replace(/nearest\w+Station/g, "nearestStation")
    .replace(/compute\w+LastRide/g, "computeLastRide")
    .replace(/\b[A-Z][A-Z0-9_]*_PROVENANCE\b/g, "PROVENANCE")
    .replace(/\/\/.*$/gm, "")
    .replace(/"[^"]*"/g, '"PROVIDER"');
}

// The helper builds its pack path at request time from the city its caller
// names, which Next cannot trace, so lib/venueIndexTracing.mjs declares the
// three packs. These cases run each route against the real files: a route
// pointed at a city the declaration does not cover answers with no pubs.
const LAST_RIDE_CITIES = [
  { city: "manchester", get: lastTram },
  { city: "liverpool", get: lastMerseyrail },
  { city: "glasgow", get: lastSubway },
] as const;

type PackRow = { id: string; lat: number; lng: number };

function cityPack(city: string): PackRow[] {
  const file = join(process.cwd(), "public", "data", "cities", city, "venues_slim.json");
  return (rowsFromSlimPayload(JSON.parse(readFileSync(file, "utf8"))) ?? []) as PackRow[];
}

describe("each last-ride route reads its own city pack", () => {
  it("declares exactly the packs the three routes open", () => {
    const pack = RUNTIME_DATA_PACKS.find((entry) => entry.id === "last-ride-city-venues");
    expect(pack?.modules).toEqual(["lib/lastRideRoute.ts"]);
    expect([...(pack?.files ?? [])].sort()).toEqual(
      venuePackIncludesFor(LAST_RIDE_CITY_IDS).sort(),
    );
    expect([...LAST_RIDE_CITY_IDS].sort()).toEqual(
      LAST_RIDE_CITIES.map((entry) => entry.city).sort(),
    );
  });

  for (const { city, get } of LAST_RIDE_CITIES) {
    it(`answers with pubs from the ${city} pack`, async () => {
      const pack = cityPack(city);
      const seed = pack.find((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
      expect(seed, `${city} pack must carry a located pub`).toBeTruthy();
      const ids = new Set(pack.map((row) => row.id));

      const response = await get(
        new Request(`https://pubmaxxing.com/x?lat=${seed?.lat}&lng=${seed?.lng}`),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { nearestPubs?: { id: string }[] };
      expect(body.nearestPubs?.length, `${city} answered no nearest pubs`).toBeGreaterThan(0);
      for (const pub of body.nearestPubs ?? []) {
        expect(ids.has(pub.id), `${pub.id} is not in the ${city} pack`).toBe(true);
      }
    });
  }

  it("refuses coordinates it cannot read", async () => {
    const response = await lastTram(new Request("https://pubmaxxing.com/x?lat=abc&lng=abc"));
    expect(response.status).toBe(400);
  });
});

describe("lastRide route extraction (#1043 L5)", () => {
  it("each route imports runLastRideRoute from lib/lastRideRoute", () => {
    for (const route of LAST_RIDE_ROUTES) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      expect(source, route).toContain('from "@/lib/lastRideRoute"');
      expect(source, route).toContain("runLastRideRoute");
    }
  });

  it("provider-name-normalised bodies match across the three routes", () => {
    const neutral = LAST_RIDE_ROUTES.map((route) =>
      providerNeutralRouteBody(readFileSync(join(process.cwd(), route), "utf8")),
    );
    expect(neutral[0]).toBe(neutral[1]);
    expect(neutral[1]).toBe(neutral[2]);
  });
});
