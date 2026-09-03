// Permissible-source FOOD price refresh layer — mirrors lib/drinkPriceUpdates.ts
// for the food menu. Same governance: every price carries
// { source: {label, url, licence}, observedAt }; never present stale as live.

import type { Provenance } from "@/lib/curation";
import {
  isFoodCategory,
  type FoodCategory,
  type FoodDietary,
  type FoodItem,
  type FoodProvenance,
} from "@/lib/food";

export type FoodPriceUpdate = {
  venueKey: string;
  itemName: string;
  category: FoodCategory;
  priceGbp: number;
  description?: string;
  dietary?: FoodDietary[];
  source: { label: string; url: string; licence: string };
  observedAt: string;
};

export const FOOD_PRICE_UPDATE_PROVENANCE: Provenance = "sourced";

export type FoodPriceProvenance = {
  provenance: Provenance;
  sourceLabel: string;
  sourceUrl: string;
  licence: string;
  observedAt: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidObservedAt(value: unknown, now: number): value is string {
  if (!isNonEmptyString(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= now;
}

const DIETARY_SET = new Set<string>(["vegan", "vegetarian", "gluten-free"]);

function isValidDietary(value: unknown): value is FoodDietary[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((d) => typeof d === "string" && DIETARY_SET.has(d));
}

export function isValidFoodPriceUpdate(
  value: unknown,
  now: number = Date.now(),
): value is FoodPriceUpdate {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.venueKey)) return false;
  if (!isNonEmptyString(row.itemName)) return false;
  if (!isFoodCategory(row.category)) return false;
  if (!isFiniteNumber(row.priceGbp) || row.priceGbp < 0) return false;
  if (row.description !== undefined && !isNonEmptyString(row.description)) return false;
  if (!isValidDietary(row.dietary)) return false;
  const source = row.source;
  if (typeof source !== "object" || source === null) return false;
  const src = source as Record<string, unknown>;
  if (!isNonEmptyString(src.label)) return false;
  if (!isHttpUrl(src.url)) return false;
  if (!isNonEmptyString(src.licence)) return false;
  if (!isValidObservedAt(row.observedAt, now)) return false;
  return true;
}

function rowKey(venueKey: string, itemName: string, category: string): string {
  return `${venueKey}\u0000${itemName.toLowerCase()}\u0000${category.toLowerCase()}`;
}

function updateProvenance(update: FoodPriceUpdate): FoodProvenance {
  return {
    source: update.source.label,
    licence: update.source.licence,
    observedAt: update.observedAt,
  };
}

function stableFoodId(update: FoodPriceUpdate): string {
  const input = `${update.venueKey}\u0000${update.category}\u0000${update.itemName}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `food-${(hash >>> 0).toString(36)}`;
}

export function foodFromPriceUpdate(update: FoodPriceUpdate): FoodItem {
  return {
    id: stableFoodId(update),
    name: update.itemName,
    category: update.category,
    priceGbp: update.priceGbp,
    description: update.description,
    dietary: update.dietary,
    provenance: updateProvenance(update),
    source: update.source.url,
  };
}

export function applyFoodPriceUpdatesToMenu(
  venueKey: string,
  existing: FoodItem[],
  updates: FoodPriceUpdate[],
): FoodItem[] {
  const scoped = updates.filter((update) => update.venueKey === venueKey);
  if (scoped.length === 0) return existing;
  const byKey = new Map(
    scoped.map((update) => [rowKey(update.venueKey, update.itemName, update.category), update] as const),
  );
  const used = new Set<string>();

  const merged = existing.map((item) => {
    const key = rowKey(venueKey, item.name, item.category);
    const update = byKey.get(key);
    if (!update) return item;
    used.add(key);
    return {
      ...item,
      priceGbp: update.priceGbp,
      provenance: updateProvenance(update),
      description: update.description ?? item.description,
      dietary: update.dietary ?? item.dietary,
      source: update.source.url,
    };
  });

  for (const update of scoped) {
    const key = rowKey(update.venueKey, update.itemName, update.category);
    if (!used.has(key)) merged.push(foodFromPriceUpdate(update));
  }
  return merged;
}

export function parseFoodPriceUpdates(raw: unknown, now: number = Date.now()): FoodPriceUpdate[] {
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { updates?: unknown }).updates)
      ? (raw as { updates: unknown[] }).updates
      : [];
  const newestByKey = new Map<string, FoodPriceUpdate>();
  for (const row of rows) {
    if (!isValidFoodPriceUpdate(row, now)) continue;
    const key = rowKey(row.venueKey, row.itemName, row.category);
    const existing = newestByKey.get(key);
    if (!existing || Date.parse(row.observedAt) > Date.parse(existing.observedAt)) {
      newestByKey.set(key, row);
    }
  }
  return Array.from(newestByKey.values());
}
