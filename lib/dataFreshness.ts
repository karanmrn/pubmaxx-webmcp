// Honest data-freshness helpers (Wave S3, tightened by the SEO integrity
// cleanup). The fact layer must stamp every derived stat with WHEN the
// underlying prices were collected — never a fabricated "live" timestamp and
// never a build artifact dressed up as a collection date.
//
// Two distinct signals, deliberately kept apart:
//   • PINT_DATASET_OBSERVED_AT — the dataset's real collection date. Drives
//     every user-facing "collected" stamp and the JSON-LD dates.
//   • The bundled file's mtime says only "this file was last written" (builds,
//     re-exports), never when prices were collected; app/sitemap.ts derives its
//     `lastModified` from that mtime with its own local helper.
//
// Pure formatters keep no disk access, so they can be unit-tested on fixed
// Dates.

import freshnessRegistry from "@/data/freshness_registry.json";
import { resolveObservedAt, type FreshnessRegistry } from "@/lib/freshness";

/** The bundled London pint-price dataset every borough/index page reads. */
export const PINT_DATASET_FILE = "pint_prices_app_dataset.json";

/** Registry id of the bundled pint-price dataset entry (the stamp we read). */
const PINT_DATASET_REGISTRY_ID = "pint_prices";
const DRINK_PRICE_UPDATE_REGISTRY_ID = "drink_price_updates";

const registry = freshnessRegistry as unknown as FreshnessRegistry;

function stalenessBudgetDays(id: string): number {
  const hours = registry.datasets.find((dataset) => dataset.id === id)?.stalenessBudgetHours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    throw new Error(
      `data/freshness_registry.json: '${id}' is missing a positive staleness budget`,
    );
  }
  return hours / 24;
}

export const PINT_DATASET_STALENESS_BUDGET_DAYS = stalenessBudgetDays(
  PINT_DATASET_REGISTRY_ID,
);
export const DRINK_PRICE_UPDATE_STALENESS_BUDGET_DAYS = stalenessBudgetDays(
  DRINK_PRICE_UPDATE_REGISTRY_ID,
);

/**
 * Resolve the pint dataset's collection stamp from the freshness registry —
 * the single source of truth for WHEN the bundled prices were collected. The
 * registry entry (data/freshness_registry.json → `pint_prices`) carries the
 * literal stamp; this is a build-time import (webpack inlines the JSON), so
 * both server and client bundles get the same value with no disk access at
 * runtime. Fails loud at module load if the entry is missing or unparseable —
 * a broken registry is a build break, never a silently wrong "collected" date.
 *
 * The stamp is stored date-only, anchored at NOON UTC, so no timezone
 * conversion can move the day: the raw 23:10 UTC scrape instant (recorded in
 * data/README.md) is already 4 July in Europe/London, which would make the
 * visible stamp ("4 July 2026") disagree with the JSON-LD ISO date
 * (2026-07-03). Noon UTC renders as 3 July in London (BST or GMT) and slices
 * to 2026-07-03 in ISO — one day, everywhere; a drift test pins the constant
 * to the registry value and a regression test pins the two representations
 * together. The stamp is updated by the export pipeline when the dataset is
 * re-collected (scripts/export_app_dataset_json.py --collected-at), never by
 * hand-editing this file.
 */
function resolvePintDatasetObservedAt(): Date {
  const entry = registry.datasets.find((d) => d.id === PINT_DATASET_REGISTRY_ID);
  const observedAt = entry ? resolveObservedAt(entry.stamp, undefined) : null;
  if (observedAt === null) {
    throw new Error(
      `data/freshness_registry.json: '${PINT_DATASET_REGISTRY_ID}' is missing a resolvable literal stamp — ` +
        "the pint dataset's collection date cannot be sourced. This registry entry is the single source of truth.",
    );
  }
  return new Date(observedAt);
}

/**
 * The calendar day the bundled dataset's prices were collected, derived at
 * build time from the freshness registry (see resolvePintDatasetObservedAt).
 * Drives every user-facing "collected" stamp and the JSON-LD dates. Keep this
 * export name stable — every consumer reads through it.
 */
export const PINT_DATASET_OBSERVED_AT = resolvePintDatasetObservedAt();

// en-GB, London time, so "July 2026" / "16 July 2026" read the same wherever
// the build runs — a US-locale build must not stamp a page "7/2026".
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "July 2026" — the collection month for the "As of {month year}" lead. */
export function formatMonthYear(date: Date): string {
  return MONTH_YEAR.format(date);
}

/** "16 July 2026" — the "Prices last collected {date}" stamp. */
export function formatObservedDate(date: Date): string {
  return FULL_DATE.format(date);
}

/** "as of 16 July 2026" — the bundled pint-price baseline's as-of label. */
export function formatPintDatasetAsOf(): string {
  return `as of ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`;
}

/** ISO date (YYYY-MM-DD) for JSON-LD dateModified / temporalCoverage. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
