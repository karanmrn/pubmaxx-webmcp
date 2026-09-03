import { describe, expect, it } from "vitest";

import {
  BRIEF_DEFAULT_AREA,
  buildWeatherBrief,
  pickPubOfTheDayFact,
  rankTonightPicks,
  relativeObservedLabel,
  toTonightPickDto,
  type WeatherBrief,
} from "@/lib/todayBrief";
import type { WhatsOnRow } from "@/lib/whatsOn";

// Fixed clock (BST): Saturday 18 July 2026, 09:00 London.
const NOW = new Date("2026-07-18T08:00:00.000Z");
const NOW_MS = NOW.getTime();

// A well-formed weather snapshot with one observation for the default area.
// `ageHours` positions observedAt before NOW; `ttlHours` sets the expiry window.
function snapshot(overrides: {
  feelsLikeC?: number;
  precipitationProbabilityPct?: number;
  condition?: string;
  ageHours?: number;
  ttlHours?: number;
  area?: string;
} = {}) {
  const ageMs = (overrides.ageHours ?? 1) * 3_600_000;
  const observedAt = new Date(NOW_MS - ageMs).toISOString();
  const expiresAt = new Date(NOW_MS - ageMs + (overrides.ttlHours ?? 12) * 3_600_000).toISOString();
  return {
    version: 1,
    generatedAt: observedAt,
    observations: [
      {
        nightArea: overrides.area ?? BRIEF_DEFAULT_AREA,
        observedAt,
        expiresAt,
        condition: overrides.condition ?? "Cloudy",
        feelsLikeC: overrides.feelsLikeC ?? 19.4,
        precipitationProbabilityPct: overrides.precipitationProbabilityPct ?? 0,
        windKph: 13.3,
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?x=1",
          publisher: "Open-Meteo",
          publishedAt: observedAt,
        },
      },
    ],
  };
}

function makeRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "quiz-1",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: "2026-07-18T19:30:00+01:00",
    title: "Pub quiz",
    source: { label: "Question One", url: "https://questionone.com/venues/test-arms/" },
    observedAt: "2026-07-18T06:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

describe("relativeObservedLabel", () => {
  it("floors to the coarser unit and never claims fresher than reality", () => {
    expect(relativeObservedLabel(NOW_MS, NOW_MS)).toBe("just now");
    expect(relativeObservedLabel(NOW_MS - 59_000, NOW_MS)).toBe("just now");
    expect(relativeObservedLabel(NOW_MS - 60_000, NOW_MS)).toBe("1 minute ago");
    expect(relativeObservedLabel(NOW_MS - 45 * 60_000, NOW_MS)).toBe("45 minutes ago");
    expect(relativeObservedLabel(NOW_MS - 2 * 3_600_000, NOW_MS)).toBe("2 hours ago");
    expect(relativeObservedLabel(NOW_MS - 24 * 3_600_000, NOW_MS)).toBe("yesterday");
    expect(relativeObservedLabel(NOW_MS - 3 * 86_400_000, NOW_MS)).toBe("3 days ago");
  });
});

describe("buildWeatherBrief", () => {
  it("builds a fresh verdict with a Checked line and Open-Meteo provenance", () => {
    const brief = buildWeatherBrief(snapshot({ feelsLikeC: 19.4, ageHours: 2 }), NOW) as WeatherBrief;
    expect(brief).not.toBeNull();
    expect(brief.stale).toBe(false);
    expect(brief.tempLabel).toBe("19°C");
    expect(brief.conditionLabel).toBe("cloudy");
    expect(brief.checkedLabel).toBe("Checked 2 hours ago");
    // 19.4C, 0% rain, July -> the warm-dry / summer-garden verdict fires.
    expect(brief.verdictLine.length).toBeGreaterThan(0);
    expect(brief.drinkSuggestion.length).toBeGreaterThan(0);
    expect(brief.source).toEqual({
      publisher: "Open-Meteo",
      url: "https://api.open-meteo.com/v1/forecast?x=1",
    });
  });

  it("preserves the rule that produced a warm displayed reading", () => {
    const brief = buildWeatherBrief(
      snapshot({
        feelsLikeC: 24,
        precipitationProbabilityPct: 70,
        condition: "Cloudy",
      }),
      NOW,
    ) as WeatherBrief;

    expect(brief.tempLabel).toBe("24°C");
    expect(brief.ruleId).toBe("hard-rain");
  });

  it("still shows a stale-but-real observation, marked Last checked", () => {
    // Observed 3 days ago with a 12h ttl: long past expiry at NOW.
    const brief = buildWeatherBrief(snapshot({ ageHours: 72 }), NOW) as WeatherBrief;
    expect(brief).not.toBeNull();
    expect(brief.stale).toBe(true);
    expect(brief.checkedLabel).toBe("Last checked 3 days ago");
  });

  it("returns null for an invalid snapshot", () => {
    expect(buildWeatherBrief(null, NOW)).toBeNull();
    expect(buildWeatherBrief({ version: 1 }, NOW)).toBeNull();
  });

  it("returns null for a future-generated snapshot or future observation", () => {
    const future = snapshot({ ageHours: -2 }); // observedAt after NOW
    expect(buildWeatherBrief(future, NOW)).toBeNull();
  });

  it("returns null on a grey in-between evening the rules table has no verdict for", () => {
    // 12C with 45% rain in July trips the cool-default band (precip < 50): resolves.
    const resolves = buildWeatherBrief(
      snapshot({ feelsLikeC: 12, precipitationProbabilityPct: 45, condition: "Overcast" }),
      NOW,
    );
    // 12C with 55% rain sits in the gap: not hard rain (>= 60), not cool-default
    // (< 50), no seasonal band in July. No verdict.
    const grey = buildWeatherBrief(
      snapshot({ feelsLikeC: 12, precipitationProbabilityPct: 55, condition: "Overcast" }),
      NOW,
    );
    expect(resolves).not.toBeNull();
    expect(grey).toBeNull();
  });

  it("falls back to the first observation when the default area is absent", () => {
    const snap = snapshot({ area: "clapham", feelsLikeC: 19 });
    const brief = buildWeatherBrief(snap, NOW) as WeatherBrief;
    expect(brief).not.toBeNull();
    expect(brief.tempLabel).toBe("19°C");
  });

  it("can require an exact area for personalized weather", () => {
    const snap = snapshot({ area: "clapham", feelsLikeC: 19 });
    expect(
      buildWeatherBrief(snap, NOW, BRIEF_DEFAULT_AREA, { fallbackToFirst: false }),
    ).toBeNull();
  });
});

describe("rankTonightPicks", () => {
  it("orders by confidence, then soonest start, then input order; caps at limit", () => {
    const rows = [
      makeRow({ id: "listed-late", title: "Late music", confidence: "listed", startsAt: "2026-07-18T21:00:00+01:00" }),
      makeRow({ id: "confirmed", title: "Confirmed quiz", confidence: "confirmed", startsAt: "2026-07-18T20:00:00+01:00" }),
      makeRow({ id: "derived", title: "Early deal", confidence: "derived", startsAt: "2026-07-18T18:00:00+01:00" }),
      makeRow({ id: "listed-early", title: "Listed quiz", confidence: "listed", startsAt: "2026-07-18T19:00:00+01:00" }),
    ];
    expect(rankTonightPicks(rows, 3).map((r) => r.id)).toEqual([
      "confirmed",
      "listed-early",
      "listed-late",
    ]);
  });

  it("returns an empty list for an empty night (no padding)", () => {
    expect(rankTonightPicks([], 3)).toEqual([]);
  });

  it("keeps only the strongest-ranked copy of a title across venues", () => {
    const rows = [
      makeRow({
        id: "small-plates-listed",
        placeName: "The Moon",
        title: "Small Plates Club",
        confidence: "listed",
        startsAt: "2026-07-18T18:00:00+01:00",
      }),
      makeRow({
        id: "small-plates-confirmed",
        placeName: "The Crown",
        title: "Small Plates Club",
        confidence: "confirmed",
        startsAt: "2026-07-18T21:00:00+01:00",
      }),
      makeRow({ id: "quiz", title: "Tuesday quiz", confidence: "listed" }),
    ];

    expect(rankTonightPicks(rows, 3).map((row) => row.id)).toEqual([
      "small-plates-confirmed",
      "quiz",
    ]);
  });

  it("normalizes Unicode compatibility, case, and whitespace without fuzzy matching", () => {
    const rows = [
      makeRow({ id: "full-width", title: "Ｓｍａｌｌ   Ｐｌａｔｅｓ Club" }),
      makeRow({ id: "plain", title: " small plates club " }),
      makeRow({ id: "punctuated", title: "Small Plates Club!" }),
    ];

    expect(rankTonightPicks(rows, 3).map((row) => row.id)).toEqual([
      "full-width",
      "punctuated",
    ]);
  });

  it("continues scanning after duplicates to fill the limit with distinct titles", () => {
    const rows = [
      makeRow({ id: "a1", title: "Same deal", startsAt: "2026-07-18T18:00:00+01:00" }),
      makeRow({ id: "a2", title: "Same deal", startsAt: "2026-07-18T18:30:00+01:00" }),
      makeRow({ id: "b", title: "Live set", startsAt: "2026-07-18T19:00:00+01:00" }),
      makeRow({ id: "c", title: "Pub quiz", startsAt: "2026-07-18T20:00:00+01:00" }),
      makeRow({ id: "d", title: "Late food", startsAt: "2026-07-18T21:00:00+01:00" }),
    ];

    expect(rankTonightPicks(rows, 3).map((row) => row.id)).toEqual(["a1", "b", "c"]);
  });

  it("returns fewer than the limit rather than padding with duplicate titles", () => {
    const rows = [
      makeRow({ id: "a", title: "One recurring deal" }),
      makeRow({ id: "b", title: "ONE RECURRING DEAL" }),
    ];
    expect(rankTonightPicks(rows, 3).map((row) => row.id)).toEqual(["a"]);
  });

  it("preserves the previous unlimited behavior for a positive infinite limit", () => {
    const rows = [
      makeRow({ id: "a", title: "First" }),
      makeRow({ id: "b", title: "Second" }),
    ];
    expect(rankTonightPicks(rows, Number.POSITIVE_INFINITY).map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(rankTonightPicks(rows, Number.NaN)).toEqual([]);
    expect(rankTonightPicks(rows, Number.NEGATIVE_INFINITY)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const rows = [makeRow({ id: "a" }), makeRow({ id: "b", confidence: "confirmed" })];
    const before = rows.map((r) => r.id);
    rankTonightPicks(rows, 2);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("toTonightPickDto", () => {
  it("deep-links a resolved venue to the map (internal)", () => {
    const dto = toTonightPickDto(makeRow({ venueId: "venue-abc", priceGbp: 4.5 }));
    expect(dto.href).toBe("/map?sel=venue-abc");
    expect(dto.external).toBe(false);
    expect(dto.priceGbp).toBe(4.5);
    expect(dto.kindLabel).toBe("Quiz");
  });

  it("links a scraped-by-name row out to its source (external)", () => {
    const dto = toTonightPickDto(makeRow());
    expect(dto.href).toBe("https://questionone.com/venues/test-arms/");
    expect(dto.external).toBe(true);
    expect(dto.sourceLabel).toBe("Question One");
    expect(dto.priceGbp).toBeNull();
  });
});

describe("pickPubOfTheDayFact", () => {
  const cache = {
    "the crown": [
      { source: "seed", fact: "Seeded example only.", sourceRef: "https://x.example/seed" },
    ],
    "the anchor": [
      { source: "wikidata", fact: "historic public house", sourceRef: "https://x.example/wd" },
      {
        source: "wikipedia",
        fact: "The Anchor is a Grade II listed pub dating from the 18th century.",
        sourceRef: "https://en.wikipedia.org/wiki/The_Anchor",
      },
    ],
    "the bell": [
      { source: "nhle", fact: "Listed building, National Heritage List for England.", sourceRef: "https://x.example/nhle" },
    ],
  };

  it("returns one sourced fact carrying its provenance label, never a seed-only pub", () => {
    const fact = pickPubOfTheDayFact(cache, NOW);
    expect(fact).not.toBeNull();
    expect(fact?.provenance).toBe("sourced");
    expect(fact?.provenanceLabel).toBe("Sourced");
    // Never "the crown" (seed only). Display name is cased.
    expect(["The Anchor", "The Bell"]).toContain(fact?.pubName);
    expect(fact?.sourceRef?.startsWith("https://")).toBe(true);
  });

  it("prefers the most readable source (wikipedia over wikidata) within a pub", () => {
    const oneAnchor = { "the anchor": cache["the anchor"] };
    const fact = pickPubOfTheDayFact(oneAnchor, NOW);
    expect(fact?.fact).toBe("The Anchor is a Grade II listed pub dating from the 18th century.");
  });

  it("is deterministic for a given London day and rotates by day", () => {
    const a = pickPubOfTheDayFact(cache, NOW);
    const again = pickPubOfTheDayFact(cache, new Date("2026-07-18T20:00:00.000Z"));
    expect(again?.pubName).toBe(a?.pubName);
    // Two sourced pubs (anchor, bell): consecutive days land on different pubs.
    const nextDay = pickPubOfTheDayFact(cache, new Date("2026-07-19T08:00:00.000Z"));
    expect(nextDay?.pubName).not.toBe(a?.pubName);
  });

  it("returns null when nothing is sourced or the cache is malformed", () => {
    expect(pickPubOfTheDayFact({ "the crown": cache["the crown"] }, NOW)).toBeNull();
    expect(pickPubOfTheDayFact(null, NOW)).toBeNull();
    expect(pickPubOfTheDayFact([], NOW)).toBeNull();
  });

  it("skips a pub the sources describe as closed/former, falling through to the eligible ones", () => {
    const withClosed = {
      // Genuinely gone — the exact honesty bug this guards (a real prod pick).
      "the george": [
        {
          source: "wikipedia",
          fact: "The George is a former pub in Hammersmith, now offices.",
          sourceRef: "https://en.wikipedia.org/wiki/The_George",
        },
      ],
      "the anchor": [
        {
          source: "wikipedia",
          fact: "The Anchor is a Grade II listed pub dating from the 18th century.",
          sourceRef: "https://en.wikipedia.org/wiki/The_Anchor",
        },
      ],
      "the swan": [
        {
          source: "wikipedia",
          fact: "The Swan is a riverside pub rebuilt in 1901.",
          sourceRef: "https://en.wikipedia.org/wiki/The_Swan",
        },
      ],
    };
    // Across a week the closed pub never surfaces; every pick is one that exists,
    // and the day-rotation still spreads across the eligible set (the fallback is
    // deterministic, not one stuck pub).
    const seen = new Set<string>();
    for (let d = 0; d < 7; d += 1) {
      const pick = pickPubOfTheDayFact(withClosed, new Date(NOW_MS + d * 86_400_000));
      expect(pick).not.toBeNull();
      expect(pick?.pubName).not.toBe("The George");
      if (pick?.pubName) seen.add(pick.pubName);
    }
    expect(seen).toEqual(new Set(["The Anchor", "The Swan"]));
  });

  it("returns null when every sourced pub reads as closed — fails soft, never lies", () => {
    const allClosed = {
      "the george": [
        { source: "wikipedia", fact: "The George is a former public house, now flats.", sourceRef: "https://x.example/g" },
      ],
      "the swan": [
        { source: "wikipedia", fact: "The Swan closed down in 1998.", sourceRef: "https://x.example/s" },
      ],
    };
    expect(pickPubOfTheDayFact(allClosed, NOW)).toBeNull();
  });

  it("keeps an open pub whose heritage names a past role ('former coaching inn'), not a closure", () => {
    const openHeritage = {
      "the bell": [
        {
          source: "wikipedia",
          fact: "The Bell is a former coaching inn, now a popular Grade II listed pub.",
          sourceRef: "https://x.example/b",
        },
      ],
    };
    expect(pickPubOfTheDayFact(openHeritage, NOW)?.pubName).toBe("The Bell");
  });
});
