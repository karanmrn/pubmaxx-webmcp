import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceContributionImpact from "@/components/map/PriceContributionImpact";

describe("PriceContributionImpact", () => {
  it("links credited attribution to its encoded anchored public impact", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "credited", handle: "night owl/club" },
    }));

    expect(html).toContain("Counted under");
    expect(html).toContain("@night owl/club");
    expect(html).toContain('href="/u/night%20owl%2Fclub#contribution-impact"');
    expect(html).toContain("See your impact");
  });

  it("renders no profile link for anonymous attribution", () => {
    const html = renderToStaticMarkup(createElement(PriceContributionImpact, {
      attribution: { status: "anonymous" },
    }));

    expect(html).toBe("");
  });
});
