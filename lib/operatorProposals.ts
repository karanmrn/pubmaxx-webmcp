// Operator proposals (Wayfinder 3.5) — the PURE seam: types, allowlists, and the
// untrusted-payload validator. No IO, and DELIBERATELY no import of any venue
// fact module (factClaims, the pint-drop / visit-report / ratings stores, the
// ledger). That absence is load-bearing and asserted by a fence test
// (__tests__/operatorProposalFence.test.ts): a proposal is INERT with respect to
// trusted data. The ONLY path from a proposal to a served fact runs through the
// admin acceptance seam — a moderator accepts it, then the factClaims bridge
// (authority `operator`, rank 0) turns the accepted payload into additive,
// attributed evidence that can never silently overwrite the observed corpus.
// Nothing in THIS file may reach for or even name that bridge (fence test).
//
// A proposal is filed by a VERIFIED operator (lib/venueOperators.ts) and starts
// `pending`. It is attributed (accountId) and structured (a typed payload). An
// admin accepts or declines it; acceptance is what materialises a claim.
//
// The impure dual-backend store lives in lib/operatorProposalsStore.ts.

import { cleanText, readString } from "@/lib/textClean";

export type OperatorProposalType = "correction" | "event" | "offer" | "response";

export const OPERATOR_PROPOSAL_TYPES: readonly OperatorProposalType[] = [
  "correction",
  "event",
  "offer",
  "response",
];

export type OperatorProposalStatus = "pending" | "accepted" | "declined";

export const OPERATOR_PROPOSAL_STATUSES: readonly OperatorProposalStatus[] = [
  "pending",
  "accepted",
  "declined",
];

export const MAX_PROPOSAL_TITLE = 120;
export const MAX_PROPOSAL_BODY = 500;
export const MAX_PROPOSAL_FIELD = 60;
export const MAX_PROPOSAL_WHEN = 60;
export const MAX_PROPOSAL_VENUE_ID = 120;

// One structured payload shape covers all four types; per-type validation below
// enforces which fields are REQUIRED. Kept flat + optional so the store persists
// it as a single jsonb column without a per-type table.
//   correction: field (what) + body (the corrected value)
//   event:      title + startsAt (+ optional body)
//   offer:      title + body (the details)
//   response:   body (the operator's reply; optional title as a subject)
export type OperatorProposalPayload = {
  title?: string;
  body?: string;
  field?: string;
  startsAt?: string;
};

export type OperatorProposal = {
  id: string;
  venueId: string;
  accountId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
  status: OperatorProposalStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewerNote?: string;
};

export type OperatorProposalFields = {
  venueId: string;
  accountId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
};

export type OperatorProposalDTO = {
  id: string;
  venueId: string;
  type: OperatorProposalType;
  payload: OperatorProposalPayload;
  status: OperatorProposalStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

export function toOperatorProposalDTO(p: OperatorProposal): OperatorProposalDTO {
  return {
    id: p.id,
    venueId: p.venueId,
    type: p.type,
    payload: p.payload,
    status: p.status,
    createdAt: p.createdAt,
    reviewedAt: p.reviewedAt ?? null,
    reviewerNote: p.reviewerNote ?? null,
  };
}

export function isOperatorProposalType(v: unknown): v is OperatorProposalType {
  return typeof v === "string" && (OPERATOR_PROPOSAL_TYPES as readonly string[]).includes(v);
}

export function isOperatorProposalStatus(v: unknown): v is OperatorProposalStatus {
  return typeof v === "string" && (OPERATOR_PROPOSAL_STATUSES as readonly string[]).includes(v);
}

type RawPayload = { title?: unknown; body?: unknown; field?: unknown; startsAt?: unknown };

/** Clean the four optional payload strings; empties collapse to absent. */
function cleanPayload(raw: RawPayload): OperatorProposalPayload {
  const title = cleanText(raw.title, MAX_PROPOSAL_TITLE);
  const body = cleanText(raw.body, MAX_PROPOSAL_BODY);
  const field = cleanText(raw.field, MAX_PROPOSAL_FIELD);
  const startsAt = cleanText(raw.startsAt, MAX_PROPOSAL_WHEN);
  const payload: OperatorProposalPayload = {};
  if (title) payload.title = title;
  if (body) payload.body = body;
  if (field) payload.field = field;
  if (startsAt) payload.startsAt = startsAt;
  return payload;
}

/** Which fields each type must carry to be a meaningful proposal. */
function payloadComplete(type: OperatorProposalType, p: OperatorProposalPayload): boolean {
  switch (type) {
    case "correction":
      return Boolean(p.field && p.body);
    case "event":
      return Boolean(p.title && p.startsAt);
    case "offer":
      return Boolean(p.title && p.body);
    case "response":
      return Boolean(p.body);
  }
}

const INCOMPLETE_MESSAGE: Record<OperatorProposalType, string> = {
  correction: "A correction needs the field and the corrected value.",
  event: "An event needs a title and when it starts.",
  offer: "An offer needs a title and the details.",
  response: "A response needs a message.",
};

export type OperatorProposalValidation =
  | { ok: true; fields: OperatorProposalFields }
  | { ok: false; error: string };

/**
 * Validate an untrusted proposal body against a server-verified accountId. The
 * caller (route) has ALREADY confirmed this account is a VERIFIED operator of the
 * venue before calling — this only shapes the payload. venueId + type required;
 * the payload must carry the type's required fields after cleaning.
 */
export function validateOperatorProposal(
  raw: { venueId?: unknown; type?: unknown; payload?: unknown },
  accountId: string,
): OperatorProposalValidation {
  const account = typeof accountId === "string" ? accountId.trim() : "";
  if (!account) return { ok: false, error: "Sign in to propose an update." };

  const venueId = readString(raw.venueId);
  if (!venueId) return { ok: false, error: "Choose a venue." };
  if (venueId.length > MAX_PROPOSAL_VENUE_ID) {
    return { ok: false, error: "That venue reference is too long." };
  }

  if (!isOperatorProposalType(raw.type)) {
    return { ok: false, error: "Choose a correction, event, offer, or response." };
  }
  const type = raw.type;

  const rawPayload =
    raw.payload && typeof raw.payload === "object" ? (raw.payload as RawPayload) : {};
  const payload = cleanPayload(rawPayload);
  if (!payloadComplete(type, payload)) {
    return { ok: false, error: INCOMPLETE_MESSAGE[type] };
  }

  return {
    ok: true,
    fields: { venueId: venueId.slice(0, MAX_PROPOSAL_VENUE_ID), accountId: account, type, payload },
  };
}

/**
 * The value a served fact should carry when an accepted proposal is folded into
 * fact resolution. A pure string pick with no fact import: the admin acceptance
 * route reads it and hands it to the factClaims bridge (this module deliberately
 * never names or imports that bridge — see the fence test). A correction serves
 * its corrected value; other types serve their headline.
 */
export function proposalServedValue(p: Pick<OperatorProposal, "type" | "payload">): string {
  if (p.type === "correction") return p.payload.body ?? "";
  return p.payload.title ?? p.payload.body ?? "";
}
