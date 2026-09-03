import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    rows: [],
    asOf: null,
    sourceObservedAt: null,
    sourceFreshnessKind: "unknown",
    // The hook always answers with a per-kind map, so the stub must too: the
    // page reads it to date the music lane from the music source.
    kindObservedAt: {},
    status: "empty",
    retry: () => {},
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));

import TonightClient from "@/app/tonight/TonightClient";
import TonightSoftPlansModule from "@/app/tonight/TonightSoftPlansModule";
import type { QuietPintModule } from "@/lib/quietPint";
import { isQuietPintWindow } from "@/lib/quietPint";
import { TRUSTED_HANDOFF_FLAGS_OFF } from "@/lib/trustedHandoffFlags";
import { venueMapUrl } from "@/lib/venueMapUrl";

const QUIET_PINT: QuietPintModule = {
  weekdayName: "Tuesday",
  rows: [
    {
      id: "venue-quiet",
      name: "The Quiet Bell",
      heritageLine: "A cited manorial snug from 1667.",
      eraLabel: "1667",
      gradeLabel: "Grade II",
      provenanceLabel: "Sourced",
      sourceLabel: "Wikipedia",
      sourceRef: "https://en.wikipedia.org/wiki/Example",
      quietLabel: "Usually quiet on a Tuesday",
      priceLabel: "£4.50",
      mapHref: venueMapUrl("venue-quiet"),
    },
    {
      id: "venue-calm",
      name: "The Calm Arms",
      heritageLine: "Listed for its snug and its porch.",
      eraLabel: "1700",
      gradeLabel: null,
      provenanceLabel: "Sourced",
      sourceLabel: "On record",
      sourceRef: null,
      quietLabel: "Usually quiet on a Tuesday",
      priceLabel: null,
      mapHref: venueMapUrl("venue-calm"),
    },
    {
      id: "venue-soft",
      name: "The Soft Pint",
      heritageLine: "A riverside tavern with a cited ledger.",
      eraLabel: "1800",
      gradeLabel: null,
      provenanceLabel: "Sourced",
      sourceLabel: "Wikipedia",
      sourceRef: "https://en.wikipedia.org/wiki/Example-2",
      quietLabel: "Usually quiet on a Tuesday",
      priceLabel: "£5.00",
      mapHref: venueMapUrl("venue-soft"),
    },
  ],
};

describe("isQuietPintWindow", () => {
  it("reads quiet during a typical-pattern quiet hour", () => {
    // Tuesday 14:00 London — afternoon quiet band in busyness model.
    expect(isQuietPintWindow(new Date("2026-08-04T13:00:00.000Z"))).toBe(true);
  });

  it("reads busy outside the quiet window", () => {
    // Friday 22:00 London — evening rush.
    expect(isQuietPintWindow(new Date("2026-08-07T21:00:00.000Z"))).toBe(false);
  });
});

describe("TonightSoftPlansModule", () => {
  it("lists soft plan chips into /plan occasions", () => {
    const html = renderToStaticMarkup(createElement(TonightSoftPlansModule, { hasQuietPint: false }));
    expect(html).toContain('data-testid="tonight-soft-plans"');
    expect(html).toContain("Soft plans tonight");
    expect(html).toContain("Coffee catch-up");
    expect(html).toContain("Alcohol-free outing");
    expect(html).toContain("Chill afternoon");
    expect(html).toContain('href="/plan?occasion=coffee&amp;src=tonight-soft"');
    expect(html).toContain('href="/plan?occasion=af&amp;src=tonight-soft"');
    expect(html).toContain('href="/plan?occasion=chill&amp;src=tonight-soft"');
    expect(html).not.toContain("#tonight-quiet-pint");
  });

  it("adds a quiet pint anchor when heritage picks are on the page", () => {
    const html = renderToStaticMarkup(createElement(TonightSoftPlansModule, { hasQuietPint: true }));
    expect(html).toContain('href="#tonight-quiet-pint"');
    expect(html).toContain("A quiet pint");
  });
});

describe("Tonight soft plans window", () => {
  it("composes isQuietPintWindow on the server shell", () => {
    const page = readFileSync(join(process.cwd(), "app/tonight/page.tsx"), "utf8");
    expect(page).toContain("isQuietPintWindow");
    expect(page).toContain("softPlansWindow={softPlansWindow}");
  });

  it("renders the soft plans module only when softPlansWindow is true", () => {
    const onHtml = renderToStaticMarkup(
      createElement(TonightClient, {
        flags: TRUSTED_HANDOFF_FLAGS_OFF,
        quietPint: null,
        softPlansWindow: true,
      }),
    );
    expect(onHtml).toContain('data-testid="tonight-soft-plans"');

    const offHtml = renderToStaticMarkup(
      createElement(TonightClient, {
        flags: TRUSTED_HANDOFF_FLAGS_OFF,
        quietPint: null,
        softPlansWindow: false,
      }),
    );
    expect(offHtml).not.toContain('data-testid="tonight-soft-plans"');
  });

  it("anchors the quiet pint module for in-page scroll", () => {
    const html = renderToStaticMarkup(
      createElement(TonightClient, {
        flags: TRUSTED_HANDOFF_FLAGS_OFF,
        quietPint: QUIET_PINT,
        softPlansWindow: true,
      }),
    );
    expect(html).toContain('id="tonight-quiet-pint"');
  });
});
