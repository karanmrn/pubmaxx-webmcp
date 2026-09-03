import { describe, expect, it } from "vitest";

// @ts-expect-error Dependency-free Node refresh helper has no declaration file.
import { conditionForCode as scriptConditionForCode } from "@/scripts/refresh_weather_snapshots.mjs";
import { conditionForCode } from "@/lib/weatherProvider";
import {
  conditionsForWeather,
  isWeatherRecommendationCondition,
  matchingWeatherRecommendations,
  validateWeatherRecommendation,
  weatherRecommendationErrorField,
  WEATHER_RECOMMENDATION_CONDITIONS,
  WEATHER_RECOMMENDATION_ERRORS,
  type WeatherRecommendation,
  type WeatherRecommendationCondition,
} from "@/lib/weatherRecommendations";

function recommendation(
  condition: WeatherRecommendationCondition,
): WeatherRecommendation {
  return {
    id: `recommendation-${condition}`,
    venueId: "venue-1",
    condition,
    reason: `${condition} reason worth sharing.`,
    contributorHandle: "night_owl",
    submittedAt: 1_000,
    source: "community",
  };
}

describe("validateWeatherRecommendation", () => {
  it("normalises one authored recommendation", () => {
    expect(
      validateWeatherRecommendation({
        venueId: " venue-1 ",
        condition: "WARM",
        reason: "  The back garden catches   the last of the light. ",
        contributorHandle: "@Night_Owl",
      }),
    ).toEqual({
      ok: true,
      value: {
        venueId: "venue-1",
        condition: "warm",
        reason: "The back garden catches the last of the light.",
        contributorHandle: "night_owl",
      },
    });
  });

  it("rejects an open-ended condition", () => {
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "snowy",
        reason: "Good when snow settles.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({ ok: false, error: "Pick the weather this suits." });
  });

  it("requires a venue, contributor, and short specific reason", () => {
    expect(
      validateWeatherRecommendation({
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({ ok: false, error: "Choose a venue." });
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "",
      }),
    ).toEqual({ ok: false, error: "Add your Pubmaxx handle." });
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "Nice.",
        contributorHandle: "night_owl",
      }),
    ).toEqual({
      ok: false,
      error: "Say why in at least 8 characters.",
    });
  });

  it("counts Unicode code points exactly as the durable database does", () => {
    expect(
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "🍺🍺🍺🍺",
        contributorHandle: "night_owl",
      }),
    ).toEqual({
      ok: false,
      error: "Say why in at least 8 characters.",
    });

    const capped = validateWeatherRecommendation({
      venueId: "venue-1",
      condition: "warm",
      reason: "🍺".repeat(200),
      contributorHandle: "night_owl",
    });
    expect(capped.ok).toBe(true);
    if (capped.ok) {
      expect([...capped.value.reason]).toHaveLength(160);
      expect(capped.value.reason).not.toContain("�");
    }
  });

  it("removes markup and control characters before storing the opinion", () => {
    const result = validateWeatherRecommendation({
      venueId: "venue-1",
      condition: "cold",
      reason: "<b>Fire\u0000 in the snug</b>",
      contributorHandle: "night_owl",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        venueId: "venue-1",
        condition: "cold",
        reason: "bFire in the snug/b",
        contributorHandle: "night_owl",
      },
    });
  });
});

describe("isWeatherRecommendationCondition", () => {
  it("accepts only stored closed-set values, not unnormalised lookalikes", () => {
    expect(isWeatherRecommendationCondition("warm")).toBe(true);
    expect(isWeatherRecommendationCondition("WARM")).toBe(false);
  });
});

describe("conditionsForWeather", () => {
  it("uses a five-condition vocabulary that the existing snapshot supports", () => {
    expect(WEATHER_RECOMMENDATION_CONDITIONS).toEqual([
      "warm",
      "clear",
      "raining",
      "cold",
      "windy",
    ]);
  });

  it("derives overlapping warm, clear, and windy conditions", () => {
    expect(
      conditionsForWeather({
        condition: "Clear",
        feelsLikeC: 20,
        precipitationProbabilityPct: 5,
        windKph: 36,
      }),
    ).toEqual(["warm", "clear", "windy"]);
  });

  it("reads rain off the current condition, never a forecast probability", () => {
    expect(
      conditionsForWeather({
        condition: "Drizzle",
        feelsLikeC: 12,
        precipitationProbabilityPct: 20,
        windKph: null,
      }),
    ).toEqual(["raining"]);
    expect(
      conditionsForWeather({
        condition: "Rain",
        feelsLikeC: 12,
        precipitationProbabilityPct: 0,
        windKph: 8,
      }),
    ).toEqual(["raining"]);
    expect(
      conditionsForWeather({
        condition: "Thunderstorm",
        feelsLikeC: 12,
        precipitationProbabilityPct: 0,
        windKph: 8,
      }),
    ).toEqual(["raining"]);
    expect(
      conditionsForWeather({
        condition: "Cloudy",
        feelsLikeC: 12,
        precipitationProbabilityPct: 95,
        windKph: 8,
      }),
    ).toEqual([]);
  });

  it("keeps a clear sky clear whatever the next hour might do", () => {
    expect(
      conditionsForWeather({
        condition: "Clear",
        feelsLikeC: 12,
        precipitationProbabilityPct: 80,
        windKph: 8,
      }),
    ).toEqual(["clear"]);
  });

  it("does not lend rain's recommendations to snow", () => {
    expect(
      conditionsForWeather({
        condition: "Snow",
        feelsLikeC: 1,
        precipitationProbabilityPct: 90,
        windKph: 8,
      }),
    ).toEqual(["cold"]);
  });

  it("keeps cold and windy independent", () => {
    expect(
      conditionsForWeather({
        condition: "Cloudy",
        feelsLikeC: 7.9,
        precipitationProbabilityPct: 10,
        windKph: 30,
      }),
    ).toEqual(["cold", "windy"]);
  });

  it("does not invent a match from malformed weather", () => {
    expect(
      conditionsForWeather({
        condition: "Clear",
        feelsLikeC: Number.NaN,
        precipitationProbabilityPct: 5,
        windKph: 2,
      }),
    ).toEqual([]);
  });
});

describe("the matcher against the shipped condition vocabulary", () => {
  // Every WMO code both producers translate, run through the matcher, so a
  // reworded condition (say WMO 85 becoming "Snow showers") fails here rather
  // than quietly re-entering the raining set.
  const RAIN_CODES = [
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99,
  ];
  const SNOW_CODES = [71, 73, 75, 77, 85, 86];
  const CLEAR_CODES = [0];
  const NEITHER_CODES = [1, 2, 3, 45, 48];

  function conditionsFor(code: number): string[] {
    expect(scriptConditionForCode(code)).toBe(conditionForCode(code));
    return conditionsForWeather({
      condition: conditionForCode(code),
      feelsLikeC: 12,
      precipitationProbabilityPct: 50,
      windKph: 10,
    });
  }

  it("calls every rain, drizzle and storm code raining", () => {
    for (const code of RAIN_CODES) {
      expect(conditionsFor(code), `code ${code}`).toEqual(["raining"]);
    }
  });

  it("never calls a snow code raining", () => {
    for (const code of SNOW_CODES) {
      expect(conditionsFor(code), `code ${code}`).toEqual([]);
    }
  });

  it("matches clear skies and leaves cloud and fog outside the vocabulary", () => {
    for (const code of CLEAR_CODES) {
      expect(conditionsFor(code), `code ${code}`).toEqual(["clear"]);
    }
    for (const code of NEITHER_CODES) {
      expect(conditionsFor(code), `code ${code}`).toEqual([]);
    }
  });

  it("reads an untranslated code as no condition at all", () => {
    expect(conditionsFor(77_777)).toEqual([]);
  });
});

describe("weatherRecommendationErrorField", () => {
  it("routes every refusal the validator can produce to its own field", () => {
    const refusals = [
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "",
      }),
      validateWeatherRecommendation({
        venueId: "venue-1",
        condition: "warm",
        reason: "Nice.",
        contributorHandle: "night_owl",
      }),
      validateWeatherRecommendation({
        venueId: "",
        condition: "warm",
        reason: "The garden stays bright.",
        contributorHandle: "night_owl",
      }),
    ].map((result) => (result.ok ? "" : result.error));

    expect(refusals.map(weatherRecommendationErrorField)).toEqual([
      "handle",
      "reason",
      null,
    ]);
    expect(
      weatherRecommendationErrorField(
        WEATHER_RECOMMENDATION_ERRORS.reasonUnclear,
      ),
    ).toBe("reason");
  });
});

describe("matchingWeatherRecommendations", () => {
  it("filters authored opinions by current conditions without ranking them", () => {
    const rows = [
      recommendation("cold"),
      recommendation("warm"),
      recommendation("clear"),
    ];
    expect(
      matchingWeatherRecommendations(rows, ["warm", "clear"]).map(
        (row) => row.condition,
      ),
    ).toEqual(["warm", "clear"]);
  });
});
