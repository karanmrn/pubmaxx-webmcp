// Wanted store — dual backend (process-memory + Supabase public.wanteds).
// Private to the owner actor. Service-role writes; RLS owner-only for JWT.

import "server-only";

import { randomUUID } from "node:crypto";

import {
  admin,
  createDualBackendStore,
  createFailSoftGuard,
  onMissingDurableWrite,
} from "@/lib/storeBackend";
import type { Wanted, WantedDTO, WantedFields, WantedStatus } from "@/lib/wanted";
import { cleanText } from "@/lib/textClean";

const TABLE = "wanteds";
const MIGRATION_HINT = "apply migration 0093";

export type WantedStore = {
  create(fields: WantedFields, now?: number): Promise<WantedDTO>;
  listForOwner(ownerActor: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  listOpenForOwner(ownerActor: string): Promise<{ status: "ready" | "degraded"; wanteds: WantedDTO[] }>;
  /** Mark open Wanteds for this owner+venue fulfilled. Returns fulfilled rows. */
  fulfilForVenue(
    ownerActor: string,
    venueId: string,
    now?: number,
  ): Promise<WantedDTO[]>;
  delete(ownerActor: string, id: string): Promise<boolean>;
  getById(ownerActor: string, id: string): Promise<WantedDTO | null>;
  recordPromotion(
    ownerActor: string,
    id: string,
    listType: string,
    now?: number,
  ): Promise<WantedDTO | null>;
};

function toDTO(row: Wanted): WantedDTO {
  return { ...row };
}

// ── Memory ───────────────────────────────────────────────────────────────────
const byId = new Map<string, Wanted>();

function memoryList(ownerActor: string, openOnly: boolean): WantedDTO[] {
  return Array.from(byId.values())
    .filter((row) => {
      if (row.ownerActor !== ownerActor) return false;
      if (openOnly && row.status !== "open") return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toDTO);
}

export const memoryWantedStore: WantedStore = {
  async create(fields, now = Date.now()) {
    const wanted: Wanted = {
      id: randomUUID(),
      ...fields,
      status: "open",
      createdAt: new Date(now).toISOString(),
      fulfilledAt: null,
      promotedListType: null,
      promotedAt: null,
    };
    byId.set(wanted.id, wanted);
    return toDTO(wanted);
  },

  async listForOwner(ownerActor) {
    return { status: "ready", wanteds: memoryList(ownerActor, false) };
  },

  async listOpenForOwner(ownerActor) {
    return { status: "ready", wanteds: memoryList(ownerActor, true) };
  },

  async fulfilForVenue(ownerActor, venueId, now = Date.now()) {
    if (!venueId) return [];
    const stamp = new Date(now).toISOString();
    const fulfilled: WantedDTO[] = [];
    for (const row of byId.values()) {
      if (row.ownerActor !== ownerActor) continue;
      if (row.status !== "open") continue;
      if (row.venueId !== venueId) continue;
      row.status = "fulfilled";
      row.fulfilledAt = stamp;
      fulfilled.push(toDTO(row));
    }
    return fulfilled;
  },

  async delete(ownerActor, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerActor !== ownerActor) return false;
    byId.delete(id);
    return true;
  },

  async getById(ownerActor, id) {
    const hit = byId.get(id);
    if (!hit || hit.ownerActor !== ownerActor) return null;
    return toDTO(hit);
  },

  async recordPromotion(ownerActor, id, rawListType, now = Date.now()) {
    const hit = byId.get(id);
    const listType = cleanText(rawListType, 60);
    if (
      !hit
      || hit.ownerActor !== ownerActor
      || hit.status !== "open"
      || hit.venueKind !== "curated"
      || !listType
    ) return null;
    if (hit.promotedListType) {
      return hit.promotedListType === listType ? toDTO(hit) : null;
    }
    hit.promotedListType = listType;
    hit.promotedAt = new Date(now).toISOString();
    return toDTO(hit);
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────
const { guard } = createFailSoftGuard({
  tag: "wanteds",
  tables: TABLE,
  migrationHint: MIGRATION_HINT,
});

function toRow(wanted: Wanted) {
  return {
    id: wanted.id,
    owner_actor: wanted.ownerActor,
    venue_kind: wanted.venueKind,
    venue_id: wanted.venueId || null,
    venue_name: wanted.venueName || null,
    source_url: wanted.sourceUrl || null,
    source_platform: wanted.sourcePlatform,
    note: wanted.note,
    raw_paste: wanted.rawPaste,
    status: wanted.status,
    created_at: wanted.createdAt,
    fulfilled_at: wanted.fulfilledAt,
    promoted_list_type: wanted.promotedListType,
    promoted_at: wanted.promotedAt,
  };
}

function fromRow(row: Record<string, unknown>): Wanted | null {
  const id = typeof row.id === "string" ? row.id : "";
  const ownerActor = typeof row.owner_actor === "string" ? row.owner_actor : "";
  if (!id || !ownerActor) return null;
  const venueKind =
    row.venue_kind === "uk_base" || row.venue_kind === "pending" || row.venue_kind === "curated"
      ? row.venue_kind
      : "pending";
  const status: WantedStatus = row.status === "fulfilled" ? "fulfilled" : "open";
  const platform =
    row.source_platform === "instagram" ||
    row.source_platform === "tiktok" ||
    row.source_platform === "youtube" ||
    row.source_platform === "other" ||
    row.source_platform === "none"
      ? row.source_platform
      : "none";
  return {
    id,
    ownerActor,
    venueKind,
    venueId: typeof row.venue_id === "string" ? row.venue_id : "",
    venueName: typeof row.venue_name === "string" ? row.venue_name : "",
    sourceUrl: typeof row.source_url === "string" ? row.source_url : "",
    sourcePlatform: platform,
    note: typeof row.note === "string" ? row.note : "",
    rawPaste: typeof row.raw_paste === "string" ? row.raw_paste : "",
    status,
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    fulfilledAt: typeof row.fulfilled_at === "string" ? row.fulfilled_at : null,
    promotedListType:
      typeof row.promoted_list_type === "string" ? row.promoted_list_type : null,
    promotedAt: typeof row.promoted_at === "string" ? row.promoted_at : null,
  };
}

export const supabaseWantedStore: WantedStore = {
  async create(fields, now = Date.now()) {
    const wanted: Wanted = {
      id: randomUUID(),
      ...fields,
      status: "open",
      createdAt: new Date(now).toISOString(),
      fulfilledAt: null,
      promotedListType: null,
      promotedAt: null,
    };
    return guard({
      context: "create",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.create(fields, now),
        }),
      run: async () => {
        const { error } = await admin().from(TABLE).insert(toRow(wanted));
        if (error) throw new Error(error.message);
        return toDTO(wanted);
      },
    });
  },

  async listForOwner(ownerActor) {
    return guard({
      context: "list",
      onSchemaMiss: async () => memoryWantedStore.listForOwner(ownerActor),
      onError: async () => ({ status: "degraded" as const, wanteds: [] }),
      message: "list failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("owner_actor", ownerActor)
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const wanteds = (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
        return { status: "ready" as const, wanteds };
      },
    });
  },

  async listOpenForOwner(ownerActor) {
    const all = await this.listForOwner(ownerActor);
    return {
      status: all.status,
      wanteds: all.wanteds.filter((row) => row.status === "open"),
    };
  },

  async fulfilForVenue(ownerActor, venueId, now = Date.now()) {
    if (!venueId) return [];
    const stamp = new Date(now).toISOString();
    return guard({
      context: "fulfil",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.fulfilForVenue(ownerActor, venueId, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({ status: "fulfilled", fulfilled_at: stamp })
          .eq("owner_actor", ownerActor)
          .eq("venue_id", venueId)
          .eq("status", "open")
          .select("*");
        if (error) throw new Error(error.message);
        return (data ?? [])
          .map((row) => fromRow(row as Record<string, unknown>))
          .filter((row): row is Wanted => row !== null)
          .map(toDTO);
      },
    });
  },

  async delete(ownerActor, id) {
    return guard({
      context: "delete",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: MIGRATION_HINT,
          fallback: () => memoryWantedStore.delete(ownerActor, id),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .delete()
          .eq("id", id)
          .eq("owner_actor", ownerActor)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },

  async getById(ownerActor, id) {
    return guard({
      context: "get",
      onSchemaMiss: async () => memoryWantedStore.getById(ownerActor, id),
      onError: async () => null,
      message: "get failed",
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("id", id)
          .eq("owner_actor", ownerActor)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const row = fromRow(data as Record<string, unknown>);
        return row ? toDTO(row) : null;
      },
    });
  },

  async recordPromotion(ownerActor, id, rawListType, now = Date.now()) {
    const listType = cleanText(rawListType, 60);
    if (!listType) return null;
    const current = await this.getById(ownerActor, id);
    if (!current) return null;
    if (current.status !== "open" || current.venueKind !== "curated") return null;
    if (current.promotedListType) {
      return current.promotedListType === listType ? current : null;
    }
    const promotedAt = new Date(now).toISOString();
    return guard({
      context: "record-promotion",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "wanteds",
          migrationHint: "apply migration 0121",
          fallback: () =>
            memoryWantedStore.recordPromotion(ownerActor, id, listType, now),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            promoted_list_type: listType,
            promoted_at: promotedAt,
          })
          .eq("owner_actor", ownerActor)
          .eq("id", id)
          .eq("status", "open")
          .eq("venue_kind", "curated")
          .is("promoted_list_type", null)
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          const latest = await this.getById(ownerActor, id);
          return latest?.promotedListType === listType ? latest : null;
        }
        const row = fromRow(data as Record<string, unknown>);
        return row ? toDTO(row) : null;
      },
    });
  },
};

export const wantedStore = createDualBackendStore(memoryWantedStore, supabaseWantedStore);

/** Test-only: clear the in-memory Wanted rows between cases. */
export function __resetWanteds(): void {
  byId.clear();
}
