import { describe, expect, it } from "vitest";

import { composeDailyBriefPush } from "@/lib/dailyBriefPush";
import type { TonightPickDto, WeatherBrief } from "@/lib/todayBrief";

const WEATHER: WeatherBrief = {
  dateLabel: "Monday 20 Jul",
  tempLabel: "19°C",
  conditionLabel: "clear",
  verdictLine: "Beer garden weather. Lager or cider.",
  ruleId: "summer-garden",
  drinkSuggestion: "a cold lager or cider",
  venueLens: "beer-garden",
  stale: false,
  checkedLabel: "Checked 1 hour ago",
  source: { publisher: "Open-Meteo", url: "https://open-meteo.com/" },
};

const PICK: TonightPickDto = {
  id: "quiz-1",
  title: "Pub quiz",
  placeName: "The Anchor",
  kind: "quiz",
  kindLabel: "Quiz",
  sourceLabel: "Question One",
  href: "/map?sel=anchor",
  external: false,
  priceGbp: null,
  lat: null,
  lng: null,
};

describe("daily brief push composition", () => {
  it("uses the same weather verdict and highest-ranked pick as /today", () => {
    expect(composeDailyBriefPush(WEATHER, [PICK])).toEqual({
      weatherLine: WEATHER.verdictLine,
      topPickTitle: PICK.title,
      topPickPlace: PICK.placeName,
    });
  });

  it("refuses stale weather or an empty Tonight shelf", () => {
    expect(composeDailyBriefPush({ ...WEATHER, stale: true }, [PICK])).toBeNull();
    expect(composeDailyBriefPush(WEATHER, [])).toBeNull();
    expect(composeDailyBriefPush(null, [PICK])).toBeNull();
  });
});
