// Today may not call a night empty on a read that never answered.
//
// The picks card is the surface that names an empty tonight list, and
// before this it said it whether the bundled What's-On read had answered or
// thrown. This renders the real client with each read status and reads the copy
// the card actually prints.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));
vi.mock("@/components/nav/NowSegment", () => ({
  default: () => null,
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

import TodayClient from "@/app/today/TodayClient";
import { TODAY_PINTS_DEFAULT_PATCH_ID } from "@/app/today/todayPints";
import { buildDayGreeting, PICKS_DEGRADED_LINE, PICKS_EMPTY_LINE } from "@/lib/dayGreeting";
import type { PicksListReadStatus } from "@/lib/dayGreeting";

const NOW = new Date("2026-08-16T21:00:00.000Z");

// The apostrophes in the shipped copy are HTML-escaped by the renderer, so the
// markup is decoded before it is read as the sentence a person sees.
function decode(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&amp;/g, "&");
}

function renderToday(picksStatus: PicksListReadStatus): string {
  return decode(renderToStaticMarkup(
    createElement(TodayClient, {
      dateLabel: "Sunday 16 August",
      nowIso: NOW.toISOString(),
      greeting: buildDayGreeting({
        now: NOW,
        weather: null,
        dateLabel: "Sunday 16 August",
        name: null,
      }),
      weather: null,
      weatherByArea: {},
      picks: [],
      picksStatus,
      fact: null,
      // TodayPintsIndex is a map keyed by patch id. This test reads the picks
      // card alone, so the pints module carries no rows and renders nothing.
      pintsIndex: {
        [TODAY_PINTS_DEFAULT_PATCH_ID]: {
          patchId: TODAY_PINTS_DEFAULT_PATCH_ID,
          areaName: "Central London",
          rows: [],
        },
      },
      quietPint: null,
    }),
  ));
}

describe("Today picks card honesty", () => {
  it("says nothing left only when the read answered with nothing", () => {
    const ready = renderToday("ready");
    expect(ready).toContain('data-picks-status="empty"');
    expect(ready).toContain(PICKS_EMPTY_LINE.night);
  });

  it("names a failed read instead of an empty night", () => {
    const degraded = renderToday("degraded");
    expect(degraded).toContain('data-picks-status="degraded"');
    expect(degraded).toContain(PICKS_DEGRADED_LINE);
    expect(degraded).not.toContain("Nothing on tonight");
  });
});
