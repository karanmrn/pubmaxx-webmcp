// Operator proposals store (Wayfinder 3.5) — the impure seam. ONE interface, TWO
// implementations (process-memory + Supabase public.operator_proposals), chosen
// at the single operatorProposalsStore() seam, exactly like visitReportsStore.
//
// This store PERSISTS a proposal and moves it through pending → accepted/declined.
// It NEVER writes a venue fact: accepting a proposal only stamps its status here;
// materialising the accepted payload into served evidence is the caller's job via
// the admin acceptance seam (the factClaims bridge, named only in the route).
// This module therefore imports NO venue fact store — asserted by the fence test.
//
// Fail-soft-to-memory until migration 0047 lands; a HARD durable write failure
// THROWS so the route answers 503. Reads are fail-soft.

import "server-only";

import { randomUUID } from "crypto";

import { createFailSoftGuard, selectStore } from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  toOperatorProposalDTO,
  type OperatorProposal,
  type OperatorProposalDTO,
  type OperatorProposalFields,
  type OperatorProposalPayload,
  type OperatorProposalStatus,
  type OperatorProposalType,
} from "@/lib/operatorProposals";

const TABLE = "operator_proposals";

/** Bounded reads: never return more than this many rows for one query. */
export const MAX_PROPOSAL_ROWS = 500;

export type OperatorProposalStore = {
  /** Persist a new pending proposal. Returns the DTO. THROWS on hard failure. */
  create(fields: OperatorProposalFields, now?: number): Promise<OperatorProposalDTO>;
  /** Moderator review queue: proposals in a status, newest-first. Fail-soft ([]). */
  listForReview(status: OperatorProposalStatus): Promise<OperatorProposal[]>;
  /** Accepted proposals for a venue (what a surface would fold into fact
   *  resolution). Fail-soft ([]). */
  listAcceptedForVenue(venueId: string): Promise<OperatorProposal[]>;
  /** Fetch one proposal by id (the acceptance path needs the payload). Fail-soft
   *  (null). */
  getById(id: string): Promise<OperatorProposal | null>;
  /** Moderator decision: set the status + stamp the review. False = unknown id.
   *  THROWS on a hard failure. */
  setStatus(id: string, status: OperatorProposalStatus, note?: string): Promise<boolean>;
};

// ── In-memory implementation ─────────────────────────────────────────────────
const byId = new Map<string, OperatorProposal>();

function insert(fields: OperatorProposalFields, now: number): OperatorProposal {
  const proposal: OperatorProposal = {
    id: randomUUID(),
    venueId: fields.venueId,
    accountId: fields.accountId,
    type: fields.type,
    payload: fields.payload,
    status: "pending",
    createdAt: new Date(now).toISOString(),
  };
  byId.set(proposal.id, proposal);
  return proposal;
}

export const memoryOperatorProposalStore: OperatorProposalStore = {
  async create(fields, now = Date.now()) {
    return toOperatorProposalDTO(insert(fields, now));
  },

  async listForReview(status) {
    return Array.from(byId.values())
      .filter((p) => p.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_PROPOSAL_ROWS);
  },

  async listAcceptedForVenue(venueId) {
    return Array.from(byId.values())
      .filter((p) => p.venueId === venueId && p.status === "accepted")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_PROPOSAL_ROWS);
  },

  async getById(id) {
    return byId.get(id) ?? null;
  },

  async setStatus(id, status, note) {
    const hit = byId.get(id);
    if (!hit) return false;
    hit.status = status;
    hit.reviewedAt = new Date().toISOString();
    if (note) hit.reviewerNote = note;
    return true;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "operator-proposals",
  tables: TABLE,
  migrationHint: "apply migration 0048",
});

function admin() {
  return requireSupabaseAdmin();
}

function toRow(p: OperatorProposal) {
  return {
    id: p.id,
    venue_id: p.venueId,
    account_id: p.accountId,
    type: p.type,
    payload: p.payload,
    status: p.status,
    reviewed_at: p.reviewedAt ?? null,
    reviewer_note: p.reviewerNote ?? null,
    created_at: p.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): OperatorProposal {
  const rawPayload =
    row.payload && typeof row.payload === "object" ? (row.payload as OperatorProposalPayload) : {};
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    accountId: String(row.account_id),
    type: String(row.type) as OperatorProposalType,
    payload: {
      title: typeof rawPayload.title === "string" ? rawPayload.title : undefined,
      body: typeof rawPayload.body === "string" ? rawPayload.body : undefined,
      field: typeof rawPayload.field === "string" ? rawPayload.field : undefined,
      startsAt: typeof rawPayload.startsAt === "string" ? rawPayload.startsAt : undefined,
    },
    status: String(row.status) as OperatorProposalStatus,
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    reviewerNote: row.reviewer_note ? String(row.reviewer_note) : undefined,
  };
}

export const supabaseOperatorProposalStore: OperatorProposalStore = {
  async create(fields, now = Date.now()) {
    const proposal: OperatorProposal = {
      id: randomUUID(),
      venueId: fields.venueId,
      accountId: fields.accountId,
      type: fields.type,
      payload: fields.payload,
      status: "pending",
      createdAt: new Date(now).toISOString(),
    };
    return guard<OperatorProposalDTO>({
      context: "create",
      onSchemaMiss: () => memoryOperatorProposalStore.create(fields, now),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const { error } = await admin().from(TABLE).insert(toRow(proposal));
        if (error) throw new Error(error.message);
        return toOperatorProposalDTO(proposal);
      },
    });
  },

  async listForReview(status) {
    return guard<OperatorProposal[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryOperatorProposalStore.listForReview(status),
      message: "listForReview failed — returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(MAX_PROPOSAL_ROWS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async listAcceptedForVenue(venueId) {
    return guard<OperatorProposal[]>({
      context: "listAcceptedForVenue",
      onSchemaMiss: () => memoryOperatorProposalStore.listAcceptedForVenue(venueId),
      message: "listAcceptedForVenue failed — returning none",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("venue_id", venueId)
          .eq("status", "accepted")
          .order("created_at", { ascending: false })
          .limit(MAX_PROPOSAL_ROWS);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async getById(id) {
    return guard<OperatorProposal | null>({
      context: "getById",
      onSchemaMiss: () => memoryOperatorProposalStore.getById(id),
      message: "getById failed — returning null",
      onError: () => null,
      run: async () => {
        const { data, error } = await admin().from(TABLE).select("*").eq("id", id).maybeSingle();
        if (error) throw new Error(error.message);
        return data ? fromRow(data as Record<string, unknown>) : null;
      },
    });
  },

  async setStatus(id, status, note) {
    return guard<boolean>({
      context: "setStatus",
      onSchemaMiss: () => memoryOperatorProposalStore.setStatus(id, status, note),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            status,
            reviewed_at: new Date().toISOString(),
            ...(note ? { reviewer_note: note } : {}),
          })
          .eq("id", id)
          .select("id");
        if (error) throw new Error(error.message);
        return (data ?? []).length > 0;
      },
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function operatorProposalsStore(): OperatorProposalStore {
  return selectStore(memoryOperatorProposalStore, supabaseOperatorProposalStore);
}

/** Test-only: clear the in-memory state + warn dedupe between cases. */
export function __resetOperatorProposals(): void {
  byId.clear();
  resetSchemaMissWarnings();
}
