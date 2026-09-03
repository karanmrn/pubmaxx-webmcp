import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CitySwitcher from "@/components/map/CitySwitcher";
import { listEnabledCities } from "@/lib/cities";

describe("map city switcher", () => {
  it("renders every enabled shipped city and keeps location first", () => {
    const html = renderToStaticMarkup(
      createElement(CitySwitcher, {
        variant: "list",
        cityId: "london",
        onUseMyLocation: () => undefined,
      }),
    );

    const locationIndex = html.indexOf("Use my location");
    expect(locationIndex).toBeGreaterThanOrEqual(0);
    for (const city of listEnabledCities()) {
      const cityIndex = html.indexOf(city.displayName);
      expect(cityIndex).toBeGreaterThan(locationIndex);
    }
    expect(html).not.toContain("Paris");
  });
});
