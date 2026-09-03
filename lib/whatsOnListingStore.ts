import "server-only";

// Durable-or-memory backing for official-API What's-On rows. The scheduled
// route (app/api/cron/refresh-whats-on) writes refreshed What's-On rows HERE,
// and the read side (lib/whatsOnListings.server.ts) reads them
// store-first, falling back to the committed public/data/whats_on files so
// nothing breaks before migration 0119 lands or when the store is empty.
//
// WHY a store and not the committed file: on Vercel the serverless filesystem
// is read-only, so a cron cannot rewrite the checked-in feeds. Same dual-backend
// seam as lib/weatherSnapshotStore.ts: Supabase when env keys exist,
// process-memory otherwise, chosen at the single whatsOnListingStore() seam.
//
// One row per listing id. replaceKind swaps every row of that kind and leaves
// the others, so an events refresh cannot wipe a quiz harvest.

import {
  createFailSoftGuard,
  errorMessage,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { isDeployedProduction } from "@/lib/deploymentEnv";
import {
  isWhatsOnKind,
  parseWhatsOnRows,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type WhatsOnListingWriteOutcome = {
  written: number;
  failed?: true;
};

export type WhatsOnListingSnapshot = {
  rows: WhatsOnRow[];
  generatedAt: string | null;
  failed?: true;
  failure?: string;
};

export type WhatsOnListingStore = {
  replaceKind(
    kind: WhatsOnKind,
    rows: WhatsOnRow[],
    generatedAt: string,
  ): Promise<WhatsOnListingWriteOutcome>;
  readAll(): Promise<WhatsOnListingSnapshot>;
};

type KindSnap = { rows: WhatsOnRow[]; generatedAt: string };

const memoryKinds = new Map<WhatsOnKind, KindSnap>();

function snapshotFromKinds(kinds: Iterable<KindSnap>): WhatsOnListingSnapshot {
  const snaps = [...kinds];
  const rows = snaps.flatMap((snap) => snap.rows);
  if (snaps.length === 0) return { rows: [], generatedAt: null };
  const generatedAt = snaps
    .map((snap) => snap.generatedAt)
    .reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  return { rows, generatedAt };
}

export const memoryWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind(kind, rows, generatedAt) {
    const existing = memoryKinds.get(kind);
    if (existing && Date.parse(existing.generatedAt) > Date.parse(generatedAt)) {
      return { written: 0, failed: true };
    }
    memoryKinds.set(kind, { rows: [...rows], generatedAt });
    return { written: rows.length };
  },
  async readAll() {
    return snapshotFromKinds(memoryKinds.values());
  },
};

const TABLE = "whats_on_listings";
const GENERATIONS_TABLE = "whats_on_listing_generations";

const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "whats-on-listings",
  tables: TABLE,
  migrationHint: "apply migration 0119",
});

type ListingRow = {
  id: string;
  kind: string;
  city: string;
  payload: unknown;
  observed_at: string;
  generated_at: string;
};

type GenerationRow = {
  kind: string;
  generated_at: string;
};

function toReplaceInput(row: WhatsOnRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    payload: row,
    observed_at: row.observedAt,
    city: "london",
  };
}

function fromRow(row: ListingRow): WhatsOnRow | null {
  const parsed = parseWhatsOnRows([row.payload], Date.now());
  return parsed[0] ?? null;
}

export const supabaseWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind(kind, rows, generatedAt) {
    return guard<WhatsOnListingWriteOutcome>({
      context: "replaceKind",
      onSchemaMiss: () => onMissingDurableWrite({
        storeTag: "whats-on-listings",
        migrationHint: "apply migration 0119",
        fallback: () => memoryWhatsOnListingStore.replaceKind(kind, rows, generatedAt),
        onProduction: async () => ({ written: 0, failed: true }),
      }),
      message: "replaceKind failed - flagging degraded write",
      onError: () => ({ written: 0, failed: true }),
      run: async () => {
        const { data, error } = await requireSupabaseAdmin().rpc("replace_whats_on_listings", {
          p_kind: kind,
          p_rows: rows.map(toReplaceInput),
          p_generated_at: generatedAt,
        });
        if (error) throw new Error(error.message);
        const written = typeof data === "number" ? data : Number(data);
        if (!Number.isInteger(written) || written < 0) {
          throw new Error("replace_whats_on_listings returned an invalid row count");
        }
        return { written };
      },
    });
  },

  async readAll() {
    return guard<WhatsOnListingSnapshot>({
      context: "readAll",
      onSchemaMiss: async () => ({
        ...(await memoryWhatsOnListingStore.readAll()),
        failed: true as const,
        failure: "durable table missing (apply migration 0119)",
      }),
      message: "readAll failed - returning empty",
      onError: (error) => ({
        rows: [],
        generatedAt: null,
        failed: true as const,
        failure: errorMessage(error),
      }),
      run: async () => {
        const admin = requireSupabaseAdmin();
        const [{ data, error }, { data: generationData, error: generationError }] =
          await Promise.all([
            // The refresh pipeline writes only London rows today, but the
            // filter is the contract: a durable answer is a London answer, so
            // a future second city cannot leak into every city's read.
            admin.from(TABLE).select("*").eq("city", "london"),
            admin.from(GENERATIONS_TABLE).select("kind, generated_at"),
          ]);
        if (error) throw new Error(error.message);
        if (generationError) throw new Error(generationError.message);
        const parsed: WhatsOnRow[] = [];
        const stamps: string[] = [];
        for (const row of (data ?? []) as ListingRow[]) {
          if (!isWhatsOnKind(row.kind)) continue;
          const next = fromRow(row);
          if (!next) continue;
          parsed.push(next);
          stamps.push(row.generated_at);
        }
        for (const row of (generationData ?? []) as GenerationRow[]) {
          if (isWhatsOnKind(row.kind) && typeof row.generated_at === "string") {
            stamps.push(row.generated_at);
          }
        }
        if (stamps.length === 0) return { rows: [], generatedAt: null };
        const generatedAt = stamps.reduce((a, b) =>
          Date.parse(a) <= Date.parse(b) ? a : b,
        );
        return { rows: parsed, generatedAt };
      },
    });
  },
};

const unavailableProductionWhatsOnListingStore: WhatsOnListingStore = {
  async replaceKind() {
    return { written: 0, failed: true };
  },
  async readAll() {
    return { rows: [], generatedAt: null, failed: true };
  },
};

export function whatsOnListingStore(): WhatsOnListingStore {
  if (isDeployedProduction() && !isSupabaseConfigured()) {
    return unavailableProductionWhatsOnListingStore;
  }
  return selectStore(memoryWhatsOnListingStore, supabaseWhatsOnListingStore);
}

export function __resetWhatsOnListingStore(): void {
  memoryKinds.clear();
  resetSchemaMissWarnings();
}
