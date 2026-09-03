// Venue operator claims store (Wayfinder 3.5) — the impure seam. ONE store
// interface, TWO implementations (process-memory + Supabase
// public.venue_operators), chosen at the single venueOperatorsStore() seam,
// exactly like visitReportsStore / areaDemandStore.
//
// Supabase when env keys exist, process-memory otherwise. Before migration 0048
// lands (or on a schema-cache miss) local/preview paths fail soft to memory, so
// demos keep working and become durable the moment the table exists. Deployed
// production fails closed: missing-schema and hard write failures THROW so the
// route answers 503 (never a fake success). Reads remain fail-soft.
//
// Idempotent by construction: ONE claim per (accountId, venueId). A re-claim for
// the same pair UPDATES the existing row (refreshes the evidence, resets a
// rejected/revoked claim back to pending for another review) rather than stacking
// a second row.

import "server-only";

import { randomUUID } from "crypto";

import {
  createFailSoftGuard,
  onMissingDurableWrite,
  selectStore,
} from "@/lib/storeBackend";
import { requireSupabaseAdmin } from "@/lib/supabase";
import {
  toOperatorClaimDTO,
  type OperatorClaim,
  type OperatorClaimDTO,
  type OperatorClaimFields,
  type OperatorVerificationState,
} from "@/lib/venueOperators";

const TABLE = "venue_operators";

export type VenueOperatorStore = {
  /**
   * File (or refresh) a claim, upserting on (accountId, venueId). A re-claim for
   * the same pair updates the evidence and returns the state to `pending`.
   * Returns the caller-safe DTO. THROWS on a hard storage failure (route → 503).
   */
  claim(fields: OperatorClaimFields, now?: number): Promise<OperatorClaimDTO>;
  /** The caller's claim for a venue, or null. Fail-soft (null on storage error). */
  getForAccountVenue(accountId: string, venueId: string): Promise<OperatorClaim | null>;
  /** Whether this account is a VERIFIED operator of this venue (the propose gate).
   *  Fail-soft: false on any storage error (no proposal slips through on a wobble). */
  isVerifiedOperator(accountId: string, venueId: string): Promise<boolean>;
  /** Moderator review queue: claims in a state, newest-first. Fail-soft ([]). */
  listForReview(state: OperatorVerificationState): Promise<OperatorClaim[]>;
  /** Moderator decision: set the verification state + stamp the review. False =
   *  unknown id. THROWS on a hard failure. */
  setState(
    id: string,
    state: OperatorVerificationState,
    note?: string,
  ): Promise<boolean>;
};

function pairKey(accountId: string, venueId: string): string {
  return `${accountId}::${venueId}`;
}

// ── In-memory implementation ─────────────────────────────────────────────────
const byId = new Map<string, OperatorClaim>();
const idByPair = new Map<string, string>();

function memoryUpsert(fields: OperatorClaimFields, now: number): OperatorClaim {
  const key = pairKey(fields.accountId, fields.venueId);
  const createdAt = new Date(now).toISOString();
  const existingId = idByPair.get(key);
  if (existingId) {
    const prev = byId.get(existingId)!;
    // Refresh the evidence and re-open for review; keep the id + createdAt.
    const updated: OperatorClaim = {
      ...prev,
      evidenceKind: fields.evidenceKind,
      evidenceNote: fields.evidenceNote,
      verificationState: "pending",
      reviewedAt: undefined,
      reviewerNote: undefined,
    };
    byId.set(existingId, updated);
    return updated;
  }
  const claim: OperatorClaim = {
    id: randomUUID(),
    accountId: fields.accountId,
    venueId: fields.venueId,
    verificationState: "pending",
    evidenceKind: fields.evidenceKind,
    evidenceNote: fields.evidenceNote,
    createdAt,
  };
  byId.set(claim.id, claim);
  idByPair.set(key, claim.id);
  return claim;
}

export const memoryVenueOperatorStore: VenueOperatorStore = {
  async claim(fields, now = Date.now()) {
    return toOperatorClaimDTO(memoryUpsert(fields, now));
  },

  async getForAccountVenue(accountId, venueId) {
    const id = idByPair.get(pairKey(accountId, venueId));
    return id ? byId.get(id) ?? null : null;
  },

  async isVerifiedOperator(accountId, venueId) {
    const id = idByPair.get(pairKey(accountId, venueId));
    const claim = id ? byId.get(id) : undefined;
    return claim?.verificationState === "verified";
  },

  async listForReview(state) {
    return Array.from(byId.values())
      .filter((c) => c.verificationState === state)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async setState(id, state, note) {
    const hit = byId.get(id);
    if (!hit) return false;
    hit.verificationState = state;
    hit.reviewedAt = new Date().toISOString();
    if (note) hit.reviewerNote = note;
    return true;
  },
};

// ── Supabase implementation ──────────────────────────────────────────────────
const { guard, resetWarnings: resetSchemaMissWarnings } = createFailSoftGuard({
  tag: "venue-operators",
  tables: TABLE,
  migrationHint: "apply migration 0048",
});

function admin() {
  return requireSupabaseAdmin();
}

function toRow(claim: OperatorClaim) {
  return {
    id: claim.id,
    account_id: claim.accountId,
    venue_id: claim.venueId,
    verification_state: claim.verificationState,
    evidence_kind: claim.evidenceKind,
    evidence_note: claim.evidenceNote,
    reviewed_at: claim.reviewedAt ?? null,
    reviewer_note: claim.reviewerNote ?? null,
    created_at: claim.createdAt,
  };
}

function fromRow(row: Record<string, unknown>): OperatorClaim {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    venueId: String(row.venue_id),
    verificationState: String(row.verification_state) as OperatorVerificationState,
    evidenceKind: String(row.evidence_kind) as OperatorClaim["evidenceKind"],
    evidenceNote: typeof row.evidence_note === "string" ? row.evidence_note : "",
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    reviewerNote: row.reviewer_note ? String(row.reviewer_note) : undefined,
  };
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

async function selectByPair(accountId: string, venueId: string): Promise<OperatorClaim | null> {
  const { data, error } = await admin()
    .from(TABLE)
    .select("*")
    .eq("account_id", accountId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as Record<string, unknown>) : null;
}

async function reopenExisting(id: string, fields: OperatorClaimFields): Promise<void> {
  const { error } = await admin()
    .from(TABLE)
    .update({
      evidence_kind: fields.evidenceKind,
      evidence_note: fields.evidenceNote,
      verification_state: "pending",
      reviewed_at: null,
      reviewer_note: null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export const supabaseVenueOperatorStore: VenueOperatorStore = {
  async claim(fields, now = Date.now()) {
    const createdAt = new Date(now).toISOString();
    return guard<OperatorClaimDTO>({
      context: "claim",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-operators",
          migrationHint: "apply migration 0048",
          fallback: () => memoryVenueOperatorStore.claim(fields, now),
        }),
      // No onError: a hard write failure THROWS so the route answers 503.
      run: async () => {
        const existing = await selectByPair(fields.accountId, fields.venueId);
        if (existing) {
          await reopenExisting(existing.id, fields);
          return toOperatorClaimDTO({
            ...existing,
            evidenceKind: fields.evidenceKind,
            evidenceNote: fields.evidenceNote,
            verificationState: "pending",
            reviewedAt: undefined,
            reviewerNote: undefined,
          });
        }
        const claim: OperatorClaim = {
          id: randomUUID(),
          accountId: fields.accountId,
          venueId: fields.venueId,
          verificationState: "pending",
          evidenceKind: fields.evidenceKind,
          evidenceNote: fields.evidenceNote,
          createdAt,
        };
        const { error } = await admin().from(TABLE).insert(toRow(claim));
        if (error) {
          // A race inserted the pair between our select and insert — reopen it.
          if (isUniqueViolation(error)) {
            const raced = await selectByPair(fields.accountId, fields.venueId);
            if (raced) {
              await reopenExisting(raced.id, fields);
              return toOperatorClaimDTO({
                ...raced,
                evidenceKind: fields.evidenceKind,
                evidenceNote: fields.evidenceNote,
                verificationState: "pending",
                reviewedAt: undefined,
                reviewerNote: undefined,
              });
            }
          }
          throw new Error(error.message);
        }
        return toOperatorClaimDTO(claim);
      },
    });
  },

  async getForAccountVenue(accountId, venueId) {
    return guard<OperatorClaim | null>({
      context: "getForAccountVenue",
      onSchemaMiss: () => memoryVenueOperatorStore.getForAccountVenue(accountId, venueId),
      message: "getForAccountVenue failed — returning null",
      onError: () => null,
      run: () => selectByPair(accountId, venueId),
    });
  },

  async isVerifiedOperator(accountId, venueId) {
    return guard<boolean>({
      context: "isVerifiedOperator",
      onSchemaMiss: () => memoryVenueOperatorStore.isVerifiedOperator(accountId, venueId),
      message: "isVerifiedOperator failed — denying (fail closed)",
      onError: () => false,
      run: async () => {
        const claim = await selectByPair(accountId, venueId);
        return claim?.verificationState === "verified";
      },
    });
  },

  async listForReview(state) {
    return guard<OperatorClaim[]>({
      context: "listForReview",
      onSchemaMiss: () => memoryVenueOperatorStore.listForReview(state),
      message: "listForReview failed — returning empty queue",
      onError: () => [],
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .select("*")
          .eq("verification_state", state)
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      },
    });
  },

  async setState(id, state, note) {
    return guard<boolean>({
      context: "setState",
      onSchemaMiss: () =>
        onMissingDurableWrite({
          storeTag: "venue-operators",
          migrationHint: "apply migration 0048",
          fallback: () => memoryVenueOperatorStore.setState(id, state, note),
        }),
      run: async () => {
        const { data, error } = await admin()
          .from(TABLE)
          .update({
            verification_state: state,
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
export function venueOperatorsStore(): VenueOperatorStore {
  return selectStore(memoryVenueOperatorStore, supabaseVenueOperatorStore);
}

/** Test-only: clear the in-memory state + warn dedupe between cases. */
export function __resetVenueOperators(): void {
  byId.clear();
  idByPair.clear();
  resetSchemaMissWarnings();
}
