import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ContributionLanesCard, {
  ContributionLanesCardContent,
  type ContributionLanesCardState,
} from "@/components/profile/ContributionLanesCard";

type CardState = ContributionLanesCardState;

describe("ContributionLanesCard", () => {
  it("exposes one stable impact anchor in loading, degraded, and ready states", () => {
    for (const state of [
      { kind: "loading" },
      { kind: "error" },
      { kind: "ready", stats: { status: "degraded", handle: "night_owl" } },
      {
        kind: "ready",
        stats: { status: "ready", handle: "night_owl", prices: 1 },
      },
    ] satisfies CardState[]) {
      const html = renderToStaticMarkup(createElement(ContributionLanesCardContent, { state }));
      expect(html).toContain('id="contribution-impact"');
      expect(html).toContain("Your contributor record");
    }
  });

  it("renders a price-only ready record instead of the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: {
            status: "ready",
            handle: "night_owl",
            prices: 1,
            reviews: 0,
            recommendations: 0,
          },
        },
      }),
    );

    expect(html).toContain('class="contribStatLabel">visit reports</span>');
    expect(html).not.toContain("No prices, visit reports, or recommendations yet");
  });

  it("counts prices once, through the price-trust measures alone", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: {
            status: "ready",
            handle: "night_owl",
            prices: 12,
            reviews: 0,
            recommendations: 0,
          },
        },
        impact: {
          kind: "ready",
          stats: {
            status: "ready",
            observationsLogged: 16,
            pricesTrustedNow: 2,
            lifetimeTrustUnlocks: 2,
          },
        },
      }),
    );

    expect(html).not.toContain('class="contribStatLabel">prices</span>');
    expect(html).not.toContain(">12<");
    expect(html).toContain("observations logged");
    expect(html).toContain(">16<");
  });

  it("keeps degraded stats honest without showing zero counts", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: { status: "degraded", handle: "night_owl", prices: 1 },
        },
      }),
    );

    expect(html).toContain("load the rest of your record right now.");
    expect(html).not.toContain(">0<");
    expect(html).not.toContain("1 price");
  });

  it("keeps server loading markup anchored and non-numeric", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCard, { handle: "night_owl" }),
    );

    expect(html).toContain('id="contribution-impact"');
    expect(html).toContain("Your contributor record");
    expect(html).not.toMatch(/\b\d+ prices?\b/);
    expect(html).not.toContain("observations logged");
  });

  it("renders the three price-trust measures as separate counts", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: { status: "ready", handle: "night_owl", prices: 2 },
        },
        impact: {
          kind: "ready",
          stats: {
            status: "ready",
            observationsLogged: 2,
            pricesTrustedNow: 1,
            lifetimeTrustUnlocks: 1,
          },
        },
      }),
    );

    expect(html).toContain("data-testid=\"price-trust-impact\"");
    expect(html).toContain("observations logged");
    expect(html).toContain("price trusted now");
    expect(html).toContain("lifetime trust unlock");
  });

  it("does not print zeros when price-trust impact is degraded", () => {
    const html = renderToStaticMarkup(
      createElement(ContributionLanesCardContent, {
        state: {
          kind: "ready",
          stats: { status: "ready", handle: "night_owl", prices: 1 },
        },
        impact: { kind: "degraded" },
      }),
    );

    expect(html).toContain("price trust record right now.");
    expect(html).not.toContain("observations logged");
    expect(html).not.toContain("data-testid=\"price-trust-impact\"");
  });
});
