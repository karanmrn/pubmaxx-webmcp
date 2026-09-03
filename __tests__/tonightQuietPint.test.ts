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
import type { QuietPintModule } from "@/lib/quietPint";
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

describe("Tonight quiet pint module", () => {
  it("composes buildQuietPint on the server the same way /today does", () => {
    const page = readFileSync(join(process.cwd(), "app/tonight/page.tsx"), "utf8");
    expect(page).toMatch(/import \{ buildQuietPint[^}]*\} from "@\/lib\/quietPint"/);
    expect(page).toContain("loadHistoricPubs()");
    expect(page).toContain("getPricedVenues()");
    expect(page).toContain("quietPint={quietPint}");
    expect(page).toMatch(/buildQuietPint\(\{[\s\S]*candidates:[\s\S]*priceById[\s\S]*now/);
  });

  it("includes the quiet pint module when quietPint is non-null", () => {
    const html = renderToStaticMarkup(
      createElement(TonightClient, {
        flags: TRUSTED_HANDOFF_FLAGS_OFF,
        quietPint: QUIET_PINT,
      }),
    );

    expect(html).toContain('data-testid="today-quiet-pint"');
    expect(html).toContain("The Quiet Bell");
    expect(html).toContain("A quiet pint, and a bit of history.");
    expect(html).toContain(`href="${venueMapUrl("venue-quiet")}"`);
    expect(html).toContain("Usually quiet on a Tuesday");
    expect(html).not.toContain("Quiz, sport, deals, live music and events");
  });

  it("renders no quiet pint module when quietPint is null", () => {
    const html = renderToStaticMarkup(
      createElement(TonightClient, {
        flags: TRUSTED_HANDOFF_FLAGS_OFF,
        quietPint: null,
      }),
    );

    expect(html).not.toContain('data-testid="today-quiet-pint"');
    expect(html).not.toContain("A quiet pint, and a bit of history.");
  });
});
