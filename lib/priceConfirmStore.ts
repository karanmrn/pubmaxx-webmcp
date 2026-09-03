import "server-only";

// Price-confirm micro-contribution store — the lightweight community
// "still accurate?" signal behind the "Still £4.20?" chip on the venue sheet.
//
// This is NOT a pricing source: it never invents or edits a price. It only
// records that someone vouched an already-displayed price is still right, keyed
// by (venueId, price). The UI reads it as social proof ("N confirms"), never as
// a figure of its own — so provenance can't be laundered through it.
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.price_confirms) — the exact dual-backend seam as ratingsStore /
// notificationsStore: Supabase when env keys exist, process-memory otherwise,
// chosen at the single priceConfirmStore() seam. Before migration 0025 lands
// (or on a schema miss) the Supabase path fails soft to the in-memory store, so
// the chip keeps working and becomes durable the moment the table exists (B1).
//
// Fail-soft by contract: confirmPrice()/readPriceConfirm() NEVER throw — an
// invalid input, an outage, or a missing table yields a best-effort/empty result
// so the optimistic UI can stand on its own. No Supabase and no env are required.
//
// Idempotent by construction: confirmations are de-duplicated per actor, so one
// device re-tapping the chip refreshes the timestamp but never inflates the
// count — `confirms` stays an honest tally of distinct confirmers.

import { DAY_MS } from "@/lib/dayMs";
import { CONFIRM_WINDOW_DAYS } from "@/lib/priceConfidence";
import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type PriceConfirmResult = {
  /** Distinct confirmers who vouched this (venue, price) is still right. */
  confirms: number;
  /** Epoch ms of the most recent confirmation, or null when none on record. */
  lastConfirmedAt: number | null;
  /**
   * Distinct confirmers within the last CONFIRM_WINDOW_DAYS — the honest
   * "×N this week" number (lib/priceConfidence.ts renders it). Windowed on
   * each actor's LATEST confirm, so a re-tap moves a confirmer into the
   * window without ever double-counting them.
   */
  recentConfirms: number;
  /** Set when a durable write hard-failed — the tap was NOT recorded. */
  failed?: true;
};

export type PriceConfirmInput = {
  venueId: string;
  /** The displayed price being vouched for, in GBP (e.g. 4.2 for £4.20). */
  priceGbp: number;
  /**
   * Stable, opaque token for the confirmer (server-derived hashed IP in the
   * route). De-dupes repeat confirms from one device. When omitted a per-call
   * token is used, so the confirm still lands but can't be de-duplicated.
   */
  actor?: string;
};

export type PriceConfirmQuery = {
  venueId: string;
  priceGbp: number;
};

export type PriceConfirmStore = {
  /**
   * Record a confirmation and return the fresh tally. NEVER throws; a durable
   * write that hard-fails resolves with `failed: true` so the route can answer
   * 503 (house rule: degraded dependency, not a fake success).
   */
  confirm(input: PriceConfirmInput, now?: number): Promise<PriceConfirmResult>;
  /** Read the current tally without recording anything. NEVER throws. */
  read(query: PriceConfirmQuery, now?: number): Promise<PriceConfirmResult>;
};

const MAX_VENUE_ID = 64;
// Sane pint-price envelope in pennies: rejects £0 and absurd values so a bad
// body can't create junk keys (1p … £1000).
const MIN_PENNIES = 1;
const MAX_PENNIES = 100_000;
// Bound process memory in a long-lived server — evict the least-recently-
// confirmed key past this many distinct (venue, price) pairs.
const MAX_KEYS = 5_000;
// Cap how many raw confirm rows a durable tally scan pulls — plenty of distinct
// actors at this scale, bounded on purpose.
const CONFIRM_SCAN_ROWS = 2_000;

const CONFIRM_WINDOW_MS = CONFIRM_WINDOW_DAYS * DAY_MS;

const EMPTY: PriceConfirmResult = { confirms: 0, lastConfirmedAt: null, recentConfirms: 0 };

function cleanVenueId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, MAX_VENUE_ID);
}

/** Normalise a GBP price to integer pennies, or null when out of envelope. */
function toPennies(priceGbp: unknown): number | null {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp)) return null;
  const pennies = Math.round(priceGbp * 100);
  if (pennies < MIN_PENNIES || pennies > MAX_PENNIES) return null;
  return pennies;
}

/** Normalise (venueId, priceGbp) → validated parts, or null when out of bounds. */
function normalizeKey(
  venueId: unknown,
  priceGbp: unknown,
): { venueId: string; pennies: number } | null {
  const cleanId = cleanVenueId(venueId);
  const pennies = toPennies(priceGbp);
  if (!cleanId || pennies === null) return null;
  return { venueId: cleanId, pennies };
}

function actorToken(actor: string | undefined, now: number): string {
  return typeof actor === "string" && actor.length > 0
    ? actor
    : `anon:${now}:${Math.random().toString(36).slice(2)}`;
}

// ── In-memory implementation ─────────────────────────────────────────────────
type ConfirmRecord = {
  /** actor → epoch ms of that actor's latest confirm (drives the 7d window). */
  actors: Map<string, number>;
  lastConfirmedAt: number;
};

// One row per (venueId, priceInPennies). Module-level so it persists across
// requests within a process; never a browser global.
const records = new Map<string, ConfirmRecord>();

function keyOf(venueId: string, pennies: number): string {
  return `${venueId}::${pennies}`;
}

/** Evict the oldest key if the map has grown past its cap (rare, defensive). */
function evictIfNeeded(): void {
  if (records.size <= MAX_KEYS) return;
  let oldestKey: string | null = null;
  let oldestAt = Infinity;
  for (const [key, rec] of records) {
    if (rec.lastConfirmedAt < oldestAt) {
      oldestAt = rec.lastConfirmedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) records.delete(oldestKey);
}

function memoryResult(rec: ConfirmRecord, now: number): PriceConfirmResult {
  let recent = 0;
  for (const at of rec.actors.values()) {
    if (now - at <= CONFIRM_WINDOW_MS) recent += 1;
  }
  return { confirms: rec.actors.size, lastConfirmedAt: rec.lastConfirmedAt, recentConfirms: recent };
}

export const memoryPriceConfirmStore: PriceConfirmStore = {
  async confirm(input, now = Date.now()) {
    const key = normalizeKey(input.venueId, input.priceGbp);
    if (!key) return { ...EMPTY };
    const mapKey = keyOf(key.venueId, key.pennies);
    const actor = actorToken(input.actor, now);
    let rec = records.get(mapKey);
    if (!rec) {
      rec = { actors: new Map<string, number>(), lastConfirmedAt: now };
      records.set(mapKey, rec);
      evictIfNeeded();
    }
    rec.actors.set(actor, now);
    rec.lastConfirmedAt = now;
    return memoryResult(rec, now);
  },

  async read(query, now = Date.now()) {
    const key = normalizeKey(query.venueId, query.priceGbp);
    if (!key) return { ...EMPTY };
    const rec = records.get(keyOf(key.venueId, key.pennies));
    if (!rec) return { ...EMPTY };
    return memoryResult(rec, now);
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "price-confirm",
  tables: "price_confirms",
  migrationHint: "apply migration 0025",
});

// Reduce raw confirm rows to a distinct-actor tally + latest timestamp. Guards
// the untyped supabase-js projection: a malformed row is SKIPPED, never coerced.
function tally(rows: unknown, now: number = Date.now()): PriceConfirmResult {
  if (!Array.isArray(rows)) return { ...EMPTY };
  // Latest confirm per actor — a durable row is already one-per-actor, but the
  // map guards against duplicates in a malformed payload.
  const actorAt = new Map<string, number>();
  let lastConfirmedAt: number | null = null;
  for (const r of rows) {
    if (typeof r !== "object" || r === null) continue;
    const row = r as Record<string, unknown>;
    const actor = row.actor;
    const at = row.last_confirmed_at;
    if (typeof actor !== "string" || actor === "") continue;
    let ms: number | null = null;
    if (typeof at === "string" && at !== "") {
      const parsed = Date.parse(at);
      if (Number.isFinite(parsed)) ms = parsed;
    }
    const prev = actorAt.get(actor);
    if (prev === undefined || (ms !== null && ms > prev)) actorAt.set(actor, ms ?? 0);
    if (ms !== null && (lastConfirmedAt === null || ms > lastConfirmedAt)) lastConfirmedAt = ms;
  }
  let recent = 0;
  for (const ms of actorAt.values()) {
    if (ms > 0 && now - ms <= CONFIRM_WINDOW_MS) recent += 1;
  }
  return { confirms: actorAt.size, lastConfirmedAt, recentConfirms: recent };
}

async function selectTally(venueId: string, pennies: number): Promise<PriceConfirmResult> {
  const { data, error } = await requireSupabaseAdmin()
    .from("price_confirms")
    .select("actor, last_confirmed_at")
    .eq("venue_id", venueId)
    .eq("price_pennies", pennies)
    .limit(CONFIRM_SCAN_ROWS);
  if (error) throw new Error(error.message);
  return tally(data);
}

export const supabasePriceConfirmStore: PriceConfirmStore = {
  async confirm(input, now = Date.now()) {
    const key = normalizeKey(input.venueId, input.priceGbp);
    if (!key) return { ...EMPTY };
    const actor = actorToken(input.actor, now);
    return guard({
      context: "confirm",
      onSchemaMiss: () => memoryPriceConfirmStore.confirm(input, now),
      message: "confirm failed — flagging degraded write",
      onError: () => ({ ...EMPTY, failed: true }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("price_confirms")
          .upsert(
            {
              venue_id: key.venueId,
              price_pennies: key.pennies,
              actor,
              // Refresh on re-tap so recency reads see the latest confirm.
              last_confirmed_at: new Date(now).toISOString(),
            },
            { onConflict: "venue_id,price_pennies,actor" },
          );
        if (error) throw new Error(error.message);
        return selectTally(key.venueId, key.pennies);
      },
    });
  },

  async read(query, now = Date.now()) {
    const key = normalizeKey(query.venueId, query.priceGbp);
    if (!key) return { ...EMPTY };
    void now; // Supabase tally windows on wall-clock inside selectTally.
    return guard({
      context: "read",
      onSchemaMiss: () => memoryPriceConfirmStore.read(query),
      message: "read failed — returning empty tally",
      onError: () => ({ ...EMPTY }),
      run: () => selectTally(key.venueId, key.pennies),
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function priceConfirmStore(): PriceConfirmStore {
  return selectStore(memoryPriceConfirmStore, supabasePriceConfirmStore);
}

/**
 * Record a confirmation that the given (venue, price) is still right and return
 * the fresh tally. De-dupes by `actor`, so a repeat tap refreshes the timestamp
 * without inflating the count. NEVER throws — an invalid input yields an empty
 * result so the optimistic UI can stand on its own.
 */
export function confirmPrice(input: PriceConfirmInput, now: number = Date.now()): Promise<PriceConfirmResult> {
  return priceConfirmStore().confirm(input, now);
}

/**
 * Read the current tally for a (venue, price) without recording anything.
 * Fail-soft: any bad input or lookup miss resolves to an empty result.
 */
export function readPriceConfirm(query: PriceConfirmQuery): Promise<PriceConfirmResult> {
  return priceConfirmStore().read(query);
}

/** Test-only: clear the in-memory confirmations between cases. */
export function __resetPriceConfirms(): void {
  records.clear();
  resetSchemaMissWarnings();
}
