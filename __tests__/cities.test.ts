import { describe, it, expect } from "vitest";

import {
  CITIES,
  DEFAULT_CITY_ID,
  getCity,
  listEnabledCities,
  parseCityId,
  pointInCityBounds,
  cityMaxBounds,
} from "@/lib/cities";

describe("parseCityId", () => {
  it("accepts known ids case-insensitively and trims whitespace", () => {
    expect(parseCityId("london")).toBe("london");
    expect(parseCityId("Manchester")).toBe("manchester");
    expect(parseCityId("  GLASGOW  ")).toBe("glasgow");
  });

  it("returns null for unknown, empty, or missing input", () => {
    expect(parseCityId(null)).toBeNull();
    expect(parseCityId(undefined)).toBeNull();
    expect(parseCityId("")).toBeNull();
    expect(parseCityId("paris")).toBeNull();
    expect(parseCityId("lon don")).toBeNull();
  });
});

describe("getCity", () => {
  it("returns the matching city config", () => {
    expect(getCity("manchester").id).toBe("manchester");
    expect(getCity("manchester").displayName).toBe("Manchester");
  });

  it("falls back to London for unknown or missing ids", () => {
    expect(getCity(null).id).toBe(DEFAULT_CITY_ID);
    expect(getCity(undefined).id).toBe("london");
    expect(getCity("not-a-city").id).toBe("london");
    expect(getCity("")).toBe(CITIES.london);
  });
});

describe("pointInCityBounds", () => {
  it("accepts points inside London and rejects outside", () => {
    const london = CITIES.london;
    expect(pointInCityBounds(51.52, -0.12, london)).toBe(true);
    expect(pointInCityBounds(51.28, -0.55, london)).toBe(true); // SW corner
    expect(pointInCityBounds(51.72, 0.35, london)).toBe(true); // NE corner
    expect(pointInCityBounds(51.52, -0.56, london)).toBe(false);
    expect(pointInCityBounds(53.48, -2.24, london)).toBe(false); // Manchester
  });

  it("accepts points inside Manchester", () => {
    const manchester = CITIES.manchester;
    expect(pointInCityBounds(53.48, -2.24, manchester)).toBe(true);
    expect(pointInCityBounds(51.52, -0.12, manchester)).toBe(false);
  });
});

describe("listEnabledCities", () => {
  it("includes every city with a shipped OSM slim pack", () => {
    const enabled = listEnabledCities();
    expect(enabled.map((c) => c.id).sort()).toEqual([
      "bath",
      "bristol",
      "cambridge",
      "durham",
      "glasgow",
      "liverpool",
      "llandudno",
      "london",
      "manchester",
      "oxford",
    ]);
    expect(enabled.every((c) => c.enabled)).toBe(true);
  });
});

describe("city config paths and labels", () => {
  it("keeps London on legacy data paths with Last Pint", () => {
    expect(CITIES.london.slimVenuesPath).toBe("/data/venues_slim.json");
    expect(CITIES.london.poisPath).toBe("/data/london_pois.json");
    expect(CITIES.london.transitLinesPath).toBe("/data/tfl_lines.json");
    expect(CITIES.london.lastRideLabel).toBe("Last Pint");
    expect(CITIES.london.mapView.zoom).toBe(12);
    expect(CITIES.london.mapView.pitch).toBe(38);
    expect(CITIES.london.mapView.bearing).toBe(-8);
  });

  it("puts other cities under /data/cities/{id}/ with city-specific last-ride labels", () => {
    expect(CITIES.manchester.slimVenuesPath).toBe(
      "/data/cities/manchester/venues_slim.json",
    );
    expect(CITIES.manchester.poisPath).toBe("/data/cities/manchester/pois.json");
    expect(CITIES.manchester.transitLinesPath).toBeNull();
    expect(CITIES.manchester.lastRideLabel).toBe("Last Tram");
    expect(CITIES.glasgow.lastRideLabel).toBe("Last Subway");
    expect(CITIES.glasgow.country).toBe("scotland");
    expect(CITIES.oxford.lastRideLabel).toBe("Last Train");
  });

  it("converts bounds to MapLibre maxBounds order [SW, NE]", () => {
    expect(cityMaxBounds(CITIES.london)).toEqual([
      [-0.55, 51.28],
      [0.35, 51.72],
    ]);
  });
});
