import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { MIN_PRICED_VENUES, computeZonePintIndex } from "@/lib/zones";

describe("ZonePintIndexStrip", () => {
  it("states the calculation and zone-assignment basis in compact sheets", () => {
    const index = computeZonePintIndex(
      Array.from({ length: MIN_PRICED_VENUES }, (_, offset) => ({
        kind: "pub" as const,
        zone: 1,
        cheapestPrice: 5 + offset / 10,
      })),
    );
    const html = renderToStaticMarkup(
      createElement(ZonePintIndexStrip, { index, compact: true }),
    );

    expect(html).toContain(
      "Each zone figure is the median of the cheapest recorded pint price for pubs assigned to that zone.",
    );
    expect(html).toContain(
      "Assignment uses each pub’s nearest station’s TfL fare zone.",
    );
    expect(html).toContain(
      `A figure appears after ${MIN_PRICED_VENUES} priced pubs.`,
    );
    expect(html).not.toMatch(/\b(current|currently|fresh|recent)\b/i);
  });
});
