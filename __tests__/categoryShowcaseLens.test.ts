import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CategoryShowcase } from "@/components/drinks/CategoryShowcase";
import {
  CATEGORY_META,
  DRINK_CATEGORIES,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/drinks";

// The explore grid's cards are promises to open a filtered view. A card for a
// category the map refuses to lens lands the reader on the whole unfiltered
// map with nothing saying the request was dropped, which reads as a broken
// destination rather than one that was never offered.
describe("CategoryShowcase explore mode", () => {
  const exploreHtml = renderToStaticMarkup(
    createElement(CategoryShowcase, {
      title: "",
      hrefFor: (category) => `/map?drink=${category}`,
      cardHint: "Open on map",
    }),
  );

  it("offers no map link for a category the map cannot lens", () => {
    expect(exploreHtml).not.toContain("/map?drink=other");
    expect(exploreHtml).not.toContain('aria-label="Explore Other"');
  });

  it("still offers every lensable category", () => {
    for (const category of MAP_LENS_DRINK_CATEGORIES) {
      expect(exploreHtml).toContain(`/map?drink=${category}`);
      expect(exploreHtml).toContain(
        `aria-label="Explore ${CATEGORY_META[category].label}"`,
      );
    }
  });

  it("keeps the whole palette in legend mode", () => {
    // The legend documents the colour system, it navigates nowhere, so the
    // catch-all category still earns its swatch there.
    const legendHtml = renderToStaticMarkup(
      createElement(CategoryShowcase, { title: "Every drink, every colour" }),
    );
    for (const category of DRINK_CATEGORIES) {
      expect(legendHtml).toContain(CATEGORY_META[category].label);
    }
    expect(legendHtml).not.toContain("/map?drink=");
  });
});
