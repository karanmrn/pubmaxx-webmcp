import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import TodayClient from "@/app/today/TodayClient";
import TodayGetThereStrip from "@/app/today/TodayGetThereStrip";

describe("contextual Plan and Near entry points", () => {
  it("offers Plan after the reader finishes the Today brief", () => {
    const html = renderToStaticMarkup(
      createElement(TodayClient, {
        dateLabel: "Wednesday 29 Jul",
        nowIso: "2026-07-29T09:00:00.000Z",
        greeting: {
          slot: "morning",
          salutation: "Good morning",
          headline: "Your day out, sorted.",
          support: "Tonight's best, how you'll get home, and one to remember.",
          weatherAware: false,
        },
        weather: null,
        weatherByArea: {},
        picks: [],
        picksStatus: "ready",
        fact: null,
        pintsIndex: {},
        quietPint: null,
      }),
    );

    expect(html).toContain('href="/plan"');
    expect(html).toContain("Plan an outing");
  });

  it("offers Near inside the location-based Getting home card", () => {
    const html = renderToStaticMarkup(createElement(TodayGetThereStrip));

    expect(html).toContain('href="/near"');
    expect(html).toContain("Find pubs near you");
  });
});
