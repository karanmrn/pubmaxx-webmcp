import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TodayPintsCard from "@/app/today/TodayPintsCard";
import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import { formatObservedDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { CENTRAL_PATCH } from "@/lib/nightPatches";

const ROOT = join(__dirname, "..");

describe("public pint-price clock", () => {
  it("does not call bundled baseline prices collected when a newer drink overlay exists", () => {
    const drinkOverlay = JSON.parse(
      readFileSync(
        join(ROOT, "public", "data", "drink_price_updates", "latest.json"),
        "utf8",
      ),
    ) as { generatedAt: string };
    expect(Date.parse(drinkOverlay.generatedAt)).toBeGreaterThan(
      PINT_DATASET_OBSERVED_AT.getTime(),
    );

    const asOf = `as of ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`;
    const collected = `collected ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`;
    const todayHtml = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        index: {
          [CENTRAL_PATCH.id]: {
            patchId: CENTRAL_PATCH.id,
            areaName: "Piccadilly & Soho",
            rows: [{
              id: "test-pub",
              name: "The Test Arms",
              price: 4.8,
              priceLabel: "£4.80",
              mapHref: "/map?venue=test-pub",
            }],
          },
        },
      }),
    );
    const pintIndexHtml = renderToStaticMarkup(
      createElement(PintIndexArrival, {
        areas: [{
          slug: "camden",
          name: "Camden",
          pricedCount: 12,
          cheapestGbp: 4.5,
          cheapestVenueId: "venue-camden",
        }],
        surface: "index",
      }),
    );

    expect(todayHtml).toContain(asOf);
    expect(pintIndexHtml).toContain(asOf);
    expect(todayHtml).not.toContain(collected);
    expect(pintIndexHtml).not.toContain(collected);
  });
});
