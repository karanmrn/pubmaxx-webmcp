import { describe, expect, it } from "vitest";

import { CITIES } from "@/lib/cities";
import {
  BASE_TABS,
  DEFAULT_TAB,
  tabsForCity,
  tabsForVenue,
} from "@/lib/venueInspectorTabs";

describe("venueInspectorTabs", () => {
  it("opens on the useful venue overview", () => {
    expect(DEFAULT_TAB).toBe("overview");
    expect(BASE_TABS.map((tab) => tab.label)).toEqual([
      "Overview",
      "Photos",
      "Drinks",
      "Stories",
      "Lore",
      "Ask",
    ]);
  });

  it("appends a getting-home tab after the base tabs for London", () => {
    const tabs = tabsForCity("london");
    expect(tabs.slice(0, BASE_TABS.length).map((t) => t.key)).toEqual(
      BASE_TABS.map((t) => t.key),
    );
    const last = tabs[tabs.length - 1];
    expect(last.key).toBe("getting-home");
    expect(last.label).toBe("Last train");
    expect(last.shortLabel).toBe("Train");
  });

  it("uses a city-specific last-ride label for the getting-home tab", () => {
    const london = tabsForCity("london");
    const manchester = tabsForCity("manchester");
    const londonRide = london[london.length - 1];
    const manchesterRide = manchester[manchester.length - 1];
    // Both cities expose a getting-home tab; the label is provider-driven per
    // city, with London's branded "Last Pint" card surfaced as an actionable
    // "Last train" tab so it does not collide with Pint Drops/Pints.
    expect(londonRide.key).toBe("getting-home");
    expect(manchesterRide.key).toBe("getting-home");
    expect(londonRide).toMatchObject({ label: "Last train", shortLabel: "Train" });
    expect(manchesterRide).toMatchObject({ label: "Last Tram", shortLabel: "Tram" });
  });

  it("never renders two tabs with the same short label, for any city", () => {
    for (const cityId of Object.keys(CITIES) as (keyof typeof CITIES)[]) {
      const tabs = tabsForCity(cityId);
      const shortLabels = tabs.map((t) => t.shortLabel);
      const unique = new Set(shortLabels);
      expect(unique.size, `duplicate shortLabel for city "${cityId}": ${shortLabels.join(", ")}`).toBe(
        shortLabels.length,
      );
    }
  });

  it("removes Pint Drop stories from non-pub venue tabs", () => {
    expect(tabsForVenue("london", "bar").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue("london", "food").map((tab) => tab.key)).not.toContain("pints");
    expect(tabsForVenue("london", undefined).map((tab) => tab.key)).toContain("pints");
  });
});
