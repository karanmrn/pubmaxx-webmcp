import { describe, expect, it } from "vitest";

import {
  planningWeatherForArea,
  validateWeatherSnapshot,
  type WeatherSnapshot,
} from "@/lib/weatherSnapshots";

const snapshot: WeatherSnapshot = {
  version: 1,
  generatedAt: "2026-07-16T18:00:00.000Z",
  observations: [{
    nightArea: "clapham",
    observedAt: "2026-07-16T17:55:00.000Z",
    expiresAt: "2026-07-16T21:00:00.000Z",
    condition: "Partly cloudy",
    feelsLikeC: 19,
    precipitationProbabilityPct: 10,
    windKph: 9,
    source: {
      sourceUrl: "https://api.open-meteo.com/v1/forecast",
      publisher: "Open-Meteo",
      publishedAt: "2026-07-16T17:55:00.000Z",
    },
  }],
};

describe("cached weather snapshots", () => {
  it("returns an active source-backed observation for planning", () => {
    expect(planningWeatherForArea(snapshot, "clapham", Date.parse("2026-07-16T19:00:00.000Z"))).toMatchObject({
      kind: "warm-dry",
      feelsLikeC: 19,
      source: { publisher: "Open-Meteo" },
    });
  });

  it("never uses expired or future evidence", () => {
    expect(planningWeatherForArea(snapshot, "clapham", Date.parse("2026-07-16T22:00:00.000Z"))).toBeNull();
    expect(planningWeatherForArea(snapshot, "clapham", Date.parse("2026-07-16T17:00:00.000Z"))).toBeNull();
  });

  it("rejects duplicate areas and observations without valid provenance", () => {
    expect(validateWeatherSnapshot({ ...snapshot, observations: [...snapshot.observations, ...snapshot.observations] })).toBeNull();
    expect(validateWeatherSnapshot({
      ...snapshot,
      observations: [{ ...snapshot.observations[0], source: { ...snapshot.observations[0].source, sourceUrl: "javascript:bad" } }],
    })).toBeNull();
  });

  it("classifies wet weather without inventing garden suitability", () => {
    const wet = {
      ...snapshot,
      observations: [{ ...snapshot.observations[0], condition: "Rain showers", precipitationProbabilityPct: 75 }],
    };
    expect(planningWeatherForArea(wet, "clapham", Date.parse("2026-07-16T19:00:00.000Z"))?.kind).toBe("rainy");
  });
});
