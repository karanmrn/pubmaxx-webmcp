import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CompactVenuePrice from "@/components/map/CompactVenuePrice";

describe("CompactVenuePrice", () => {
  it("shows non-pub anchor label, price, observed month, and source", () => {
    const html = renderToStaticMarkup(
      createElement(CompactVenuePrice, {
        priceLabel: "£18.00",
        anchor: {
          label: "House cocktail",
          observedLabel: "Jul 2025",
          sourceLabel: "bar.example",
          sourceUrl: "https://www.bar.example/menu",
        },
      }),
    );

    expect(html).toContain("House cocktail");
    expect(html).toContain("£18.00");
    expect(html).toContain("Jul 2025");
    expect(html).toContain("bar.example");
  });

  it("keeps pub price presentation compact", () => {
    const html = renderToStaticMarkup(
      createElement(CompactVenuePrice, {
        priceLabel: "£5.20",
        anchor: null,
      }),
    );

    expect(html).toBe("<span>£5.20</span>");
  });
});
