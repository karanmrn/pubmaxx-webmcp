import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PriceBadge from "@/components/PriceBadge";

describe("PriceBadge", () => {
  it.each(["baseline", "current", "cheap", "increase", "neutral"] as const)(
    "renders the shared price-stamp signature for %s prices",
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(PriceBadge, { variant }, "£5.50"),
      );

      expect(html).toContain("priceBadge");
      expect(html).toContain(`priceBadge--${variant}`);
      expect(html).toContain("price-plaque");
      expect(html).toContain("ink-stamp");
      expect(html).toContain("ink-stamp--tilt");
      expect(html).toContain("£5.50");
      expect(html).not.toContain("priceStamp");
    },
  );

  it("preserves a consumer layout class without replacing the signature", () => {
    const html = renderToStaticMarkup(
      createElement(
        PriceBadge,
        { variant: "current", className: "feedSpillPrice" },
        "£5.50",
      ),
    );

    expect(html).toContain("price-plaque");
    expect(html).toContain("feedSpillPrice");
  });
});
