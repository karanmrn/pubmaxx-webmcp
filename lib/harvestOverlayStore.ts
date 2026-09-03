import "server-only";

// Dual-backend store for folded UK harvest overlay rows. Identity is OSM id.
// Writes are idempotent upserts. Reads distinguish unknown from unavailable.
// The fold CLI is fail-loud; this store does not invent.

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  isMissingTableSchema,
} from "@/lib/storeBackend";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  canonicalOsmId,
  parseOverlayRow,
  type HarvestOverlayRow,
} from "@/lib/harvestFold";

const TABLE = "harvest_venue_overlays";
const MIGRATION_HINT = "apply migration 0123";
const STORE_TAG = "harvest-overlay";
const UPSERT_BATCH = 500;

export type HarvestOverlayWriteOutcome = {
  written: number;
  failed?: true;
  failure?: string;
};

export type HarvestOverlayRead =
  | { status: "ready"; overlay: HarvestOverlayRow | null }
  | { status: "degraded"; overlay: null };

export type HarvestOverlayStore = {
  upsertMany(rows: HarvestOverlayRow[]): Promise<HarvestOverlayWriteOutcome>;
  getByVenueId(venueId: string): Promise<HarvestOverlayRead>;
};

const memoryRows = new Map<string, HarvestOverlayRow>();

function remember(row: HarvestOverlayRow): void {
  memoryRows.set(row.osmId, row);
}

export function __resetHarvestOverlayStore(): void {
  memoryRows.clear();
}

export const memoryHarvestOverlayStore: HarvestOverlayStore = {
  async upsertMany(rows) {
    for (const row of rows) remember(row);
    return { written: rows.length };
  },
  async getByVenueId(venueId) {
    const osmId = canonicalOsmId(venueId);
    if (!osmId) return { status: "ready", overlay: null };
    return { status: "ready", overlay: memoryRows.get(osmId) ?? null };
  },
};

const { guard } = createFailSoftGuard({
  tag: STORE_TAG,
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

type OverlaySqlRow = {
  osm_id: string;
  osm_ref: string;
  website: string | null;
  menu_url: string | null;
  lore_text: string | null;
  lore_citations: unknown;
  sources: unknown;
  lore_match_name: string | null;
  lore_match_town: string | null;
};

function toSql(row: HarvestOverlayRow, foldedAt: string) {
  return {
    osm_id: row.osmId,
    osm_ref: row.osmRef,
    website: row.website,
    menu_url: row.menuUrl,
    lore_text: row.matchedLore?.text ?? null,
    lore_citations: row.matchedLore?.citations ?? [],
    sources: row.sources,
    lore_match_name: row.loreName ?? null,
    lore_match_town: row.loreTown ?? null,
    folded_at: foldedAt,
  };
}

function fromSql(row: OverlaySqlRow): HarvestOverlayRow | null {
  try {
    return parseOverlayRow({
      osmId: row.osm_id,
      website: row.website,
      menuUrl: row.menu_url,
      matchedLore:
        row.lore_text !== null
          ? { text: row.lore_text, citations: row.lore_citations }
          : null,
      name: row.lore_match_name,
      town: row.lore_match_town,
      sources: row.sources,
    });
  } catch {
    return null;
  }
}

export const supabaseHarvestOverlayStore: HarvestOverlayStore = {
  async upsertMany(rows) {
    if (rows.length === 0) return { written: 0 };
    const foldedAt = new Date().toISOString();
    try {
      const client = admin();
      let written = 0;
      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        const chunk = rows.slice(i, i + UPSERT_BATCH).map((row) => toSql(row, foldedAt));
        const { error } = await client.from(TABLE).upsert(chunk, { onConflict: "osm_id" });
        if (error) throw error;
        written += chunk.length;
      }
      return { written };
    } catch (error) {
      if (isMissingTableSchema(error, TABLE)) {
        return {
          written: 0,
          failed: true,
          failure: `${MIGRATION_HINT}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return {
        written: 0,
        failed: true,
        failure: error instanceof Error ? error.message : String(error),
      };
    }
  },
  async getByVenueId(venueId) {
    const osmId = canonicalOsmId(venueId);
    if (!osmId) return { status: "ready", overlay: null };
    return guard({
      context: "read",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("osm_id, osm_ref, website, menu_url, lore_text, lore_citations, sources, lore_match_name, lore_match_town")
          .eq("osm_id", osmId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return { status: "ready" as const, overlay: null };
        const overlay = fromSql(data as OverlaySqlRow);
        if (!overlay) return { status: "degraded" as const, overlay: null };
        return { status: "ready" as const, overlay };
      },
      onSchemaMiss: async () => ({ status: "degraded" as const, overlay: null }),
      onError: () => ({ status: "degraded" as const, overlay: null }),
    });
  },
};

const getHarvestOverlayStore = createDualBackendStore(
  memoryHarvestOverlayStore,
  supabaseHarvestOverlayStore,
);

export function harvestOverlayStore(options?: { requireDurable?: boolean }): HarvestOverlayStore {
  if (options?.requireDurable && !isSupabaseConfigured()) {
    throw new Error(`${MIGRATION_HINT}: Supabase is required for non-dry harvest folds.`);
  }
  return getHarvestOverlayStore();
}
