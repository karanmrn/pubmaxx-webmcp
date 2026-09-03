import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DealsTonightLane, {
  type DealsTonightLaneProps,
} from "@/components/discovery/DealsTonightLane";
import { FEED_FILTERS } from "@/lib/feed";
import { londonServiceDayBounds, type WhatsOnRow } from "@/lib/whatsOn";

// A closed deal never renders, so this fixture runs on tonight's own window
// rather than a calendar date that goes past and stops testing the copy.
const TONIGHT = londonServiceDayBounds();

// ...and the lane is rendered at a FIXED moment inside that window, through the
// clock it already publishes for exactly this. Reading the wall clock instead
// made the copy assertion below depend on the hour the suite happened to run
// in: after the deal's own closing time it rendered nothing, and a test that
// says "presents deals as deals" went red with no copy having changed.
const RENDERED_AT = Date.parse(TONIGHT.start) + 60 * 60 * 1000;

const expensiveExperience: WhatsOnRow = {
  id: "deal-avora",
  placeName: "Avora",
  kind: "deal",
  startsAt: TONIGHT.start,
  endsAt: new Date(Date.parse(TONIGHT.end) - 60 * 60 * 1000).toISOString(),
  title: "Immersive cocktail experience",
  detail: "From £52.50",
  priceGbp: 52.5,
  source: {
    label: "Avora",
    url: "https://example.com/avora",
  },
  observedAt: new Date(RENDERED_AT - 60 * 60 * 1000).toISOString(),
  confidence: "listed",
};

describe("production QA destination copy", () => {
  it("presents non-pub experiences as deals without claiming a cheap round", () => {
    const html = renderToStaticMarkup(
      createElement(DealsTonightLane as ComponentType<DealsTonightLaneProps>, {
        rows: [expensiveExperience],
        asOf: "2026-07-28T12:00:00.000Z",
        now: RENDERED_AT,
      }),
    );

    expect(html).toContain("Deals tonight");
    expect(html).toContain("From £52.50");
    expect(html).not.toMatch(/cheap round/i);
  });

  it("labels the reranked public lane by ranking behaviour, not ownership", () => {
    expect(FEED_FILTERS.find((filter) => filter.id === "for-you")?.label).toBe(
      "Top picks",
    );
  });
});
