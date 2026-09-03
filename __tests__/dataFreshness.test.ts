import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatMonthYear,
  formatObservedDate,
  isoDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";

// SEO integrity regression: the visible "collected" stamp (en-GB,
// Europe/London) and the JSON-LD ISO date must name the SAME calendar day.
// The raw scrape instant (2026-07-03T23:10:47Z) is already 4 July in London,
// which is exactly the bug this pins against — the constant is anchored at
// noon UTC so no timezone conversion can move the day.
describe("PINT_DATASET_OBSERVED_AT", () => {
  it("renders the same day to users and to JSON-LD", () => {
    expect(formatObservedDate(PINT_DATASET_OBSERVED_AT)).toBe("3 July 2026");
    expect(isoDate(PINT_DATASET_OBSERVED_AT)).toBe("2026-07-03");
  });

  it("keeps the month stamp on the collection month", () => {
    expect(formatMonthYear(PINT_DATASET_OBSERVED_AT)).toBe("July 2026");
  });

  it("is anchored mid-day so London/UTC agree in both BST and GMT", () => {
    expect(PINT_DATASET_OBSERVED_AT.getUTCHours()).toBe(12);
  });
});

// Drift guard: the constant is DERIVED from the freshness registry (the single
// source of truth), so it must equal the registry stamp exactly. Read the raw
// JSON here via fs — an independent path from the module's build-time import —
// so a hand-authored regression (re-hardcoding the date in lib/dataFreshness.ts,
// or editing the registry without the pipeline) fails loudly instead of leaving
// two silently-diverging copies. This kills the mirror class for good.
describe("PINT_DATASET_OBSERVED_AT ↔ freshness registry (single source of truth)", () => {
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "data", "freshness_registry.json"), "utf8"),
  ) as {
    datasets: { id: string; stamp: { kind: string; value?: string } | null }[];
  };
  const pintEntry = registry.datasets.find((d) => d.id === "pint_prices");

  it("has a literal registry stamp for the pint dataset", () => {
    expect(pintEntry).toBeDefined();
    expect(pintEntry?.stamp?.kind).toBe("literal");
    expect(typeof pintEntry?.stamp?.value).toBe("string");
  });

  it("derives the constant from the registry value with no drift", () => {
    const registryValue = pintEntry?.stamp?.value as string;
    expect(PINT_DATASET_OBSERVED_AT.toISOString()).toBe(
      new Date(registryValue).toISOString(),
    );
  });
});
