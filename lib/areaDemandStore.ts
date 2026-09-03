import "server-only";

// Area-demand store — the durable-or-memory backing for the demand capture on
// the honest unsupported-area preview (Wayfinder 3.2). When PUBMAXX cannot serve
// an area, the user can register that they want it; this store records that
// signal so coverage can be prioritised by real demand.
//
// ONE store interface, TWO implementations (process-memory + Supabase
// public.area_demand) — the house dual-backend seam: Supabase when env keys
// exist, process-memory otherwise, chosen at the single areaDemandStore() seam. Before migration 0045
// lands (or on a schema miss), local/preview paths fail soft to memory. Deployed
// production returns a failed write outcome so the route answers 503 instead of
// acknowledging an ephemeral process-memory write.
//
// PRIVACY: `area` is free text as the user said it and `email` is OPTIONAL —
// most rows carry NO contact at all (demand is captured without it). No
// coordinates are ever stored; the taste doctrine forbids raw location in the
// payload. Email, when offered, is PII and API-only (RLS, service-role only).

import {
  coerceAreaDemandSource,
  normaliseArea,
  type AreaDemandSource,
  type NormalisedAreaDemand,
} from "@/lib/areaDemand";
import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";

export type RecordAreaDemandInput = NormalisedAreaDemand;

export type RecordAreaDemandOutcome = {
  /** `recorded` = the demand signal was persisted. */
  status: "recorded";
  /** Set when a durable write hard-failed — the demand was NOT recorded. */
  failed?: true;
};

export type AreaDemandStore = {
  /**
   * Record one demand signal. NEVER throws; a durable write that hard-fails
   * resolves with `failed: true` so the route can answer 503 (no fake success).
   * Not deduped — each expression of demand is a distinct signal (a re-tap is a
   * genuine "still want this"), but table growth is bounded by the route's
   * durable rate limit.
   */
  record(input: RecordAreaDemandInput, now?: number): Promise<RecordAreaDemandOutcome>;
  /** Count of recorded signals for an area (case-insensitive), for prioritising
   *  coverage. NEVER throws; a read failure resolves 0. */
  countForArea(area: string): Promise<number>;
};

// Bound process memory in a long-lived server — evict the oldest rows past this
// many (the durable table has no such cap).
const MAX_ROWS = 50_000;

// ── In-memory implementation ─────────────────────────────────────────────────
type DemandRecord = {
  area: string;
  areaKey: string;
  matchedPatchId: string | null;
  source: AreaDemandSource;
  email: string | null;
  createdAt: number;
};

// Module-level so it persists across requests within a process; never a browser
// global.
const rows: DemandRecord[] = [];

function areaKey(area: string): string {
  return area.toLowerCase();
}

export const memoryAreaDemandStore: AreaDemandStore = {
  async record(input, now = Date.now()) {
    const area = normaliseArea(input.area);
    if (!area) return { status: "recorded", failed: true };
    rows.push({
      area,
      areaKey: areaKey(area),
      matchedPatchId: input.matchedPatchId ?? null,
      source: coerceAreaDemandSource(input.source),
      email: input.email ?? null,
      createdAt: now,
    });
    if (rows.length > MAX_ROWS) rows.splice(0, rows.length - MAX_ROWS);
    return { status: "recorded" };
  },

  async countForArea(area) {
    const key = areaKey(area.trim());
    if (!key) return 0;
    return rows.reduce((count, row) => (row.areaKey === key ? count + 1 : count), 0);
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "area-demand",
  tables: "area_demand",
  migrationHint: "apply migration 0045",
});

export const supabaseAreaDemandStore: AreaDemandStore = {
  async record(input, now = Date.now()) {
    const area = normaliseArea(input.area);
    if (!area) return { status: "recorded", failed: true };
    const iso = new Date(now).toISOString();
    return guard<RecordAreaDemandOutcome>({
      context: "record",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "area-demand",
          migrationHint: "apply migration 0045",
          fallback: () => memoryAreaDemandStore.record(input, now),
          onProduction: async (error) => {
            console.error(error.message);
            return { status: "recorded", failed: true };
          },
        }),
      message: "record failed — flagging degraded write",
      onError: () => ({ status: "recorded", failed: true }),
      run: async () => {
        const { error } = await requireSupabaseAdmin()
          .from("area_demand")
          .insert({
            area,
            area_key: areaKey(area),
            matched_patch_id: input.matchedPatchId ?? null,
            source: coerceAreaDemandSource(input.source),
            email: input.email ?? null,
            created_at: iso,
          });
        if (error) throw new Error(error.message);
        return { status: "recorded" };
      },
    });
  },

  async countForArea(area) {
    const key = areaKey(area.trim());
    if (!key) return 0;
    return guard<number>({
      context: "countForArea",
      onSchemaMiss: () => memoryAreaDemandStore.countForArea(area),
      message: "countForArea failed — returning 0",
      onError: () => 0,
      run: async () => {
        const { count, error } = await requireSupabaseAdmin()
          .from("area_demand")
          .select("*", { count: "exact", head: true })
          .eq("area_key", key);
        if (error) throw new Error(error.message);
        return typeof count === "number" ? count : 0;
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function areaDemandStore(): AreaDemandStore {
  return selectStore(memoryAreaDemandStore, supabaseAreaDemandStore);
}

/** Test-only: clear the in-memory rows and warn dedupe. */
export function __resetAreaDemand(): void {
  rows.length = 0;
  resetSchemaMissWarnings();
}
