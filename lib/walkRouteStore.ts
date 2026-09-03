import "server-only";

// Durable-or-memory cache for routed walk legs. The walk-route API writes each
// ORS-routed leg HERE keyed by its rounded stop pair (lib/walkRoute legCacheKey),
// and reads legs back before spending an ORS call — a crawl's N-1 legs are shared
// across reversed/edited routes, so the hit rate is high and ORS stays far under
// quota. Pavements don't move, so the TTL is long (~a month).
//
// WHY a store and not process-memory alone: on Vercel each serverless instance
// has its own memory, so a memory-only cache re-fetches on every cold start.
// Same dual-backend seam as lib/weatherSnapshotStore.ts / lib/areaDemandStore.ts:
// Supabase when env keys exist, process-memory otherwise, chosen at the single
// walkRouteStore() seam. Every op is fail-soft — a cache miss/failure just means
// the leg gets routed (or drawn straight), never a broken map.

import { createDualBackendStore, createFailSoftGuard } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { DAY_MS } from "@/lib/dayMs";
import { isValidLngLat, type LngLat } from "@/lib/walkRoute";

// ~1 month. Long because pavement geometry is effectively static; the cache just
// spares ORS quota, so a stale-but-correct leg is fine well past this too.
export const WALK_ROUTE_LEG_TTL_MS = 30 * DAY_MS;

export type WalkRouteStore = {
  /** Cached routed geometry for a leg key, or null on miss/expiry/failure. */
  getLeg(key: string): Promise<LngLat[] | null>;
  /** Persist routed geometry for a leg key. NEVER throws (fail-soft). */
  putLeg(key: string, coordinates: LngLat[]): Promise<void>;
};

/** Coerce a stored JSON coordinate array back to a validated LngLat[]. */
function coordsFromJson(value: unknown): LngLat[] | null {
  if (!Array.isArray(value)) return null;
  const coords: LngLat[] = [];
  for (const point of value) {
    if (!Array.isArray(point)) continue;
    const candidate: [number, number] = [Number(point[0]), Number(point[1])];
    if (isValidLngLat(candidate)) coords.push(candidate);
  }
  return coords.length >= 2 ? coords : null;
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Module-level so it survives across requests within one server process.
const memoryRows = new Map<string, { coordinates: LngLat[]; expiresAtMs: number }>();

export const memoryWalkRouteStore: WalkRouteStore = {
  async getLeg(key) {
    const row = memoryRows.get(key);
    if (!row) return null;
    if (row.expiresAtMs <= Date.now()) {
      memoryRows.delete(key);
      return null;
    }
    return row.coordinates;
  },
  async putLeg(key, coordinates) {
    memoryRows.set(key, { coordinates, expiresAtMs: Date.now() + WALK_ROUTE_LEG_TTL_MS });
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings } = createFailSoftGuard({
  tag: "walk-route",
  tables: "walk_route_legs",
  migrationHint: "apply migration 0049",
});

type WalkLegRow = {
  leg_key: string;
  coordinates: unknown;
  expires_at: string;
};

export const supabaseWalkRouteStore: WalkRouteStore = {
  async getLeg(key) {
    return guard<LngLat[] | null>({
      context: "getLeg",
      onSchemaMiss: () => memoryWalkRouteStore.getLeg(key),
      message: "getLeg failed — treating as cache miss",
      onError: () => null,
      run: async () => {
        const { data, error } = await requireSupabaseAdmin()
          .from("walk_route_legs")
          .select("leg_key, coordinates, expires_at")
          .eq("leg_key", key)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? coordsFromJson((data as WalkLegRow).coordinates) : null;
      },
    });
  },

  async putLeg(key, coordinates) {
    await guard<void>({
      context: "putLeg",
      onSchemaMiss: () => memoryWalkRouteStore.putLeg(key, coordinates),
      message: "putLeg failed — cache write skipped",
      onError: () => undefined,
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("walk_route_legs")
          .upsert(
            {
              leg_key: key,
              coordinates,
              expires_at: new Date(Date.now() + WALK_ROUTE_LEG_TTL_MS).toISOString(),
            },
            { onConflict: "leg_key" },
          );
        if (error) throw new Error(error.message);
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export const walkRouteStore = createDualBackendStore(memoryWalkRouteStore, supabaseWalkRouteStore);

/** Test-only: clear the in-memory rows and warn dedupe. */
export function __resetWalkRouteStore(): void {
  memoryRows.clear();
  resetWarnings();
}
