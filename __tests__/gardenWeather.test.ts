import { describe, expect, it } from "vitest";

import {
  MAX_PRECIP_PROBABILITY_PCT,
  MIN_FEELS_LIKE_C,
  gardenWeatherHeadline,
  isGardenWeather,
} from "@/lib/gardenWeather";

describe("isGardenWeather", () => {
  it("passes on a warm dry day", () => {
    expect(
      isGardenWeather({ feelsLikeC: 24, precipProbabilityPct: 5, isDay: true }),
    ).toBe(true);
  });

  it("passes when isDay is omitted (warm dry evening)", () => {
    expect(isGardenWeather({ feelsLikeC: 18, precipProbabilityPct: 10 })).toBe(
      true,
    );
  });

  it("passes when precip probability is unknown", () => {
    expect(isGardenWeather({ feelsLikeC: 20, isDay: true })).toBe(true);
  });

  it("passes at exactly the feels-like threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: MIN_FEELS_LIKE_C,
        precipProbabilityPct: 0,
        isDay: true,
      }),
    ).toBe(true);
  });

  it("fails just below the feels-like threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: MIN_FEELS_LIKE_C - 0.5,
        precipProbabilityPct: 0,
        isDay: true,
      }),
    ).toBe(false);
  });

  it("fails at exactly the precip threshold", () => {
    expect(
      isGardenWeather({
        feelsLikeC: 22,
        precipProbabilityPct: MAX_PRECIP_PROBABILITY_PCT,
        isDay: true,
      }),
    ).toBe(false);
  });

  it("fails when it is explicitly night", () => {
    expect(
      isGardenWeather({ feelsLikeC: 22, precipProbabilityPct: 5, isDay: false }),
    ).toBe(false);
  });

  it("fails when feels-like is missing or non-finite", () => {
    expect(isGardenWeather({ precipProbabilityPct: 5, isDay: true })).toBe(false);
    expect(isGardenWeather({ feelsLikeC: Number.NaN, isDay: true })).toBe(false);
    expect(isGardenWeather(null)).toBe(false);
    expect(isGardenWeather(undefined)).toBe(false);
  });
});

describe("gardenWeatherHeadline", () => {
  it("rounds the temperature into the headline", () => {
    expect(
      gardenWeatherHeadline({
        feelsLikeC: 23.6,
        precipProbabilityPct: 10,
        isDay: true,
      }),
    ).toBe("24° and dry. Beer-garden night");
  });

  it("returns null when it is not garden weather", () => {
    expect(
      gardenWeatherHeadline({
        feelsLikeC: 10,
        precipProbabilityPct: 10,
        isDay: true,
      }),
    ).toBeNull();
    expect(gardenWeatherHeadline(null)).toBeNull();
  });
});
