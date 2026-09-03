import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import {
  evaluateRegistry,
  hasBreach,
  type FreshnessRegistry,
} from "@/lib/freshness";
import {
  formatObservedDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";

const ROOT = join(__dirname, "..");
const AS_OF_LABEL = `as of ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`;

describe("price freshness honesty (Grok W5.7)", () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, "data", "freshness_registry.json"), "utf8"),
  ) as FreshnessRegistry;

  it("registers price_updates as episodic with no machine staleness budget", () => {
    const entry = registry.datasets.find((dataset) => dataset.id === "price_updates");
    expect(entry).toMatchObject({
      class: "episodic",
      stalenessBudgetHours: null,
      artifact: "public/data/price_updates/latest.json",
    });
  });

  it("keeps the served price_updates envelope on the pint dataset collection day", () => {
    const latest = JSON.parse(
      readFileSync(join(ROOT, "public/data/price_updates/latest.json"), "utf8"),
    ) as { generatedAt: string; updates: unknown[] };

    expect(latest.updates).toEqual([]);
    expect(new Date(latest.generatedAt).toISOString()).toBe(
      PINT_DATASET_OBSERVED_AT.toISOString(),
    );
  });

  it("does not treat the empty July baseline as a stale cron feed in the audit", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    const results = evaluateRegistry(
      registry,
      (dataset) => {
        if (dataset.id === "price_updates") {
          return {
            observedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
            reason: null,
          };
        }
        return { observedAt: "2026-08-18T00:00:00Z", reason: null };
      },
      now,
    );

    const priceUpdates = results.find((row) => row.id === "price_updates");
    expect(priceUpdates?.status).toBe("untracked");
    expect(hasBreach(results.filter((row) => row.id === "price_updates"))).toBe(
      false,
    );
  });

  it("prints the bundled baseline as-of date on the Pint Index arrival strip", () => {
    const html = renderToStaticMarkup(
      createElement(PintIndexArrival, {
        areas: [
          {
            slug: "camden",
            name: "Camden",
            pricedCount: 12,
            cheapestGbp: 4.5,
            cheapestVenueId: "venue-camden",
          },
        ],
        surface: "index",
      }),
    );

    expect(html).toContain(AS_OF_LABEL);
  });
});
