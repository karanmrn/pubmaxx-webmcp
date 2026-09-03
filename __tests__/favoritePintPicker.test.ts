import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import FavoritePintPicker from "@/components/map/FavoritePintPicker";
import { MAP_LENS_DRINK_CATEGORIES } from "@/lib/mapExperienceLens";

function renderPicker(drinkBrand = "") {
  return renderToStaticMarkup(
    createElement(FavoritePintPicker, {
      value: null,
      onChange: vi.fn(),
      drinkBrand,
      onDrinkBrandChange: vi.fn(),
    }),
  );
}

describe("FavoritePintPicker", () => {
  it("keeps pint brand choice on the pint path", () => {
    expect(renderPicker()).toContain('aria-label="Favourite pint or beer brand"');
  });

  it("holds no second copy of the drink lane", () => {
    // The lane is a first-class control (DrinkLanePicker) mounted at both
    // sizes. A category select in here too would be two live pickers writing
    // one filter, which drift the moment either one of them is used.
    const html = renderPicker();
    for (const category of MAP_LENS_DRINK_CATEGORIES) {
      expect(html).not.toContain(`value="${category}"`);
    }
    expect(html).not.toContain('aria-label="Drink"');
  });

  it("does not name a brand for a drink whose prices have none", () => {
    // Community category rows never record a brand, so a "Whisky brand" choice
    // would overstate what its pin proves. Brand is beer-only, full stop.
    const html = renderPicker();
    expect(html).not.toMatch(/aria-label="(?!Favourite pint or beer brand)[^"]*brand"/i);
    expect(html).toContain("Cheapest pint (any)");
  });
});
