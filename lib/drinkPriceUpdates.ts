// Permissible-source DRINK price refresh layer (E2 of docs/PRD_ALL_DRINKS.md).
//
// This mirrors lib/priceUpdates.ts exactly, but targets a per-drink row on the
// E1 drinks menu (drink name + category + price) instead of a single per-venue
// cheapest-pint price. Same governance, same validation discipline, same merge
// precedence:
//
//   - every price carries { source: {label, url, licence}, observedAt };
//   - a refreshed price is presented as "sourced" (attributed), NEVER as a
//     community contribution;
//   - stale is never presented as live — observedAt is always surfaced and a
//     future observedAt is rejected outright;
//   - a fresher COMMUNITY observation always beats a sourced update (the
//     community layer is the live signal; this layer only fills in absent
//     that live signal).
//
// zod-free: hand-rolled guards mirroring lib/priceUpdates.ts isValidPriceUpdate,
// so a malformed hand-authored / machine-written update file drops the bad row
// instead of poisoning the drinks layer.

import type { Provenance } from "@/lib/curation";
import { demoContentEnabled } from "@/lib/demoContent";
import {
  alcoholTypeForDrink,
  isDemoDrinkSource,
  isDrinkCategory,
  type Drink,
  type DrinkCategory,
  type DrinkProvenance,
} from "@/lib/drinks";

// One attributed drink-price observation from a permissible source. `venueKey`
// is the canonical grouping key (lib/venues.ts venueGroupingKey) so an update
// targets exactly the same venue the app groups by — no fuzzy name matching.
// `drinkName` + `category` identify the specific menu row within that venue.
export type DrinkPriceUpdateLane = "publisher" | "demo";

export type DrinkPriceUpdate = {
  venueKey: string;
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
  producer?: string;
  abv?: number;
  style?: string;
  region?: string;
  servingSize?: string;
  source: { label: string; url: string; licence: string };
  observedAt: string; // ISO-8601
  /** Semantic display lane, resolved once when raw overlay data is parsed. */
  lane: DrinkPriceUpdateLane;
};

// The provenance a refreshed drink price is stamped with. A sourced
// (attributed) price is authoritative-but-attributed; it is never
// "contributor"/"demo".
export const DRINK_PRICE_UPDATE_PROVENANCE: Provenance = "sourced";

// The provenance stamp the drinks menu reads to attribute a refreshed price.
export type DrinkPriceProvenance = {
  provenance: Provenance; // always "sourced"
  sourceLabel: string;
  sourceUrl: string;
  licence: string;
  observedAt: string;
};

// A minimal drink-menu row shape this layer can merge sourced prices onto.
// Deliberately narrow (not importing lib/drinks.ts, which is owned by E1) so
// this module has no dependency on E1 landing first; any row shape with these
// fields plus an optional community-freshness stamp works.
export type DrinkMenuRow = {
  venueKey: string;
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number | null;
  // Freshness of the most recent COMMUNITY observation for this exact drink
  // row, if any. Mirrors Venue.latestContributorAt in lib/venues.ts. null when
  // no community observation exists yet.
  latestContributorAt: string | null;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidOptionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isValidOptionalAbv(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0 && value <= 100);
}

// http(s) URL guard — a first-party source must be a real link the UI can
// attribute to. Rejects anything that isn't an absolute http(s) URL.
function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// A valid ISO timestamp that is not in the future (a future observation is a
// data error — you cannot have observed a price that hasn't happened yet).
function isValidObservedAt(value: unknown, now: number): value is string {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}

// Hand-rolled row guard — drop malformed rows rather than throw. `now` is
// injectable for deterministic tests.
export function isValidDrinkPriceUpdate(value: unknown, now: number = Date.now()): boolean {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.drinkName)) return false;
  if (!isDrinkCategory(row.category)) return false;
  // A price must be a finite, non-negative number. 0 is allowed (free-drink
  // promo) but a negative price is nonsense.
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  if (!isValidOptionalString(row.producer)) return false;
  if (!isValidOptionalAbv(row.abv)) return false;
  if (!isValidOptionalString(row.style)) return false;
  if (!isValidOptionalString(row.region)) return false;
  if (!isValidOptionalString(row.servingSize)) return false;
  const source = row.source;
  if (typeof source !== "object" || source === null) return false;
  const src = source as Record<string, unknown>;
  if (!isNonEmptyString(src.label)) return false;
  if (!isHttpUrl(src.url)) return false;
  // A licence string is mandatory — an unlicensed source is not permissible
  // (governance: every fact is {source, licence, observedAt}).
  if (!isNonEmptyString(src.licence)) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
  if (row.lane !== undefined && row.lane !== "publisher" && row.lane !== "demo") {
    return false;
  }
  return true;
}

// The key a drink-price update targets: one venue + one named drink + its
// category. Two rows for the same venue but different drinks are independent;
// two rows for the same venue + drink + category collapse to the newest.
function rowKey(venueKey: string, drinkName: string, category: string): string {
  return `${venueKey}\u0000${drinkName.toLowerCase()}\u0000${category.toLowerCase()}`;
}

function updateProvenance(update: DrinkPriceUpdate): DrinkProvenance {
  return {
    source: update.source.label,
    sourceUrl: update.source.url,
    licence: update.source.licence,
    observedAt: update.observedAt,
    lane: update.lane === "demo" ? "demo" : "drink-price-update",
  };
}

function stableDrinkId(update: DrinkPriceUpdate): string {
  const input = `${update.venueKey}\u0000${update.category}\u0000${update.drinkName}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `drink-${(hash >>> 0).toString(36)}`;
}

export function visibleDrinkPriceUpdates(
  updates: readonly DrinkPriceUpdate[],
): DrinkPriceUpdate[] {
  if (demoContentEnabled()) return [...updates];
  return updates.filter((update) => update.lane !== "demo");
}

export function drinkFromPriceUpdate(update: DrinkPriceUpdate): Drink {
  return {
    id: stableDrinkId(update),
    category: update.category,
    name: update.drinkName,
    producer: update.producer,
    abv: update.abv,
    alcoholType: alcoholTypeForDrink({ name: update.drinkName, abv: update.abv }),
    style: update.style,
    region: update.region,
    servingSize: update.servingSize,
    priceGbp: update.priceGbp,
    provenance: updateProvenance(update),
  };
}

export function applyDrinkPriceUpdatesToMenu(
  venueKey: string,
  existingDrinks: Drink[],
  updates: DrinkPriceUpdate[],
): Drink[] {
  const scoped = visibleDrinkPriceUpdates(updates).filter(
    (update) => update.venueKey === venueKey,
  );
  if (scoped.length === 0) return existingDrinks;
  const byKey = new Map(
    scoped.map((update) => [rowKey(update.venueKey, update.drinkName, update.category), update] as const),
  );
  const used = new Set<string>();

  const merged = existingDrinks.map((drink) => {
    const key = rowKey(venueKey, drink.name, drink.category);
    const update = byKey.get(key);
    if (!update) return drink;
    used.add(key);
    return {
      ...drink,
      priceGbp: update.priceGbp,
      provenance: updateProvenance(update),
      producer: update.producer ?? drink.producer,
      abv: update.abv ?? drink.abv,
      alcoholType: alcoholTypeForDrink({
        name: update.drinkName,
        abv: update.abv ?? drink.abv,
      }),
      style: update.style ?? drink.style,
      region: update.region ?? drink.region,
      servingSize: update.servingSize ?? drink.servingSize,
    };
  });

  for (const update of scoped) {
    const key = rowKey(update.venueKey, update.drinkName, update.category);
    if (!used.has(key)) merged.push(drinkFromPriceUpdate(update));
  }
  return merged;
}

// Parse a raw drink_price_updates file body → clean DrinkPriceUpdate[]. Accepts
// either a bare array or a `{ updates: [...] }` envelope. Malformed rows are
// dropped. When more than one update targets the same venue+drink+category, the
// newest observedAt wins (so an append-only file naturally supersedes older
// observations).
export function parseDrinkPriceUpdates(raw: unknown, now: number = Date.now()): DrinkPriceUpdate[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { updates?: unknown }).updates)
      ? (raw as { updates: unknown[] }).updates
      : [];
  const newestByKey = new Map<string, DrinkPriceUpdate>();
  for (const candidate of rows) {
    if (!isValidDrinkPriceUpdate(candidate, now)) continue;
    const rawRow = candidate as Omit<DrinkPriceUpdate, "lane"> & {
      lane?: DrinkPriceUpdateLane;
    };
    const row: DrinkPriceUpdate = {
      ...rawRow,
      lane:
        rawRow.lane ??
        (isDemoDrinkSource(rawRow.source.label) ? "demo" : "publisher"),
    };
    const key = rowKey(row.venueKey, row.drinkName, row.category);
    const existing = newestByKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      newestByKey.set(key, row);
    }
  }
  return Array.from(newestByKey.values());
}

// The extra fields mergeDrinkPriceUpdates folds onto a drink-menu row. Kept as
// its own type so the menu UI can read the sourced-price attribution without
// importing the merge internals.
export type PricedDrinkMenuRow<T extends DrinkMenuRow> = T & {
  // Attribution for a price that came from the refresh file. Present ONLY when
  // the sourced update actually won precedence (no fresher community
  // observation). null otherwise.
  sourcedPrice: DrinkPriceProvenance | null;
};

// Fold the drink-price-update layer into drink-menu rows, with STRICT
// precedence — identical rule to lib/priceUpdates.ts mergePriceUpdates:
//
//   1. a community observation (row.latestContributorAt set) that is at least
//      as fresh as the update ALWAYS wins — the update is ignored, the live
//      community price + freshness stand. This is the "never present stale as
//      live" and "community layer is authoritative-live" guarantee.
//   2. otherwise the sourced update overrides the static/baseline priceGbp and
//      stamps sourcedPrice attribution ({source, licence, observedAt,
//      "sourced"}).
//   3. no update for a row → baseline stands, sourcedPrice null.
//
// `keyFor` maps a menu row to its canonical venueKey (the update file's
// venueKey). Callers pass venueGroupingKey-of-venue or a precomputed map.
export function mergeDrinkPriceUpdates<T extends DrinkMenuRow>(
  existingDrinks: T[],
  updates: DrinkPriceUpdate[],
  keyFor: (row: T) => string,
): PricedDrinkMenuRow<T>[] {
  const byKey = new Map(
    visibleDrinkPriceUpdates(updates).map(
      (u) => [rowKey(u.venueKey, u.drinkName, u.category), u] as const,
    ),
  );
  return existingDrinks.map((row) => {
    const update = byKey.get(rowKey(keyFor(row), row.drinkName, row.category));
    if (!update) {
      return { ...row, sourcedPrice: null };
    }
    // A community observation that is at least as fresh as the sourced
    // observation wins outright — stale sourced data must never beat a live
    // community price.
    if (
      row.latestContributorAt !== null &&
      Date.parse(row.latestContributorAt) >= Date.parse(update.observedAt)
    ) {
      return { ...row, sourcedPrice: null };
    }
    return {
      ...row,
      priceGbp: update.priceGbp,
      sourcedPrice: {
        provenance: DRINK_PRICE_UPDATE_PROVENANCE,
        sourceLabel: update.source.label,
        sourceUrl: update.source.url,
        licence: update.source.licence,
        observedAt: update.observedAt,
      },
    };
  });
}
