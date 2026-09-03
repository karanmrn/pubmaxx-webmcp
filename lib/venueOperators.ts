// Venue operator claims (Wayfinder 3.5) — the PURE seam: types, the allowlists,
// and the untrusted-input validator. No IO. The impure dual-backend store lives
// in lib/venueOperatorsStore.ts, exactly like visitReports.ts / visitReportsStore.ts.
//
// An operator claim binds a SIGNED-IN account to a venue and records HOW the
// claimant says they can prove they run the pub (an email on the venue domain, a
// phone answered behind the bar, a document). v1 only RECORDS the claim; the
// OWNER verifies it manually in the admin queue and flips the state. Nothing an
// operator does here touches trusted venue data — verification is the gate a
// proposal must pass before it can even be filed (lib/operatorProposals.ts).
//
// verificationState lifecycle (owner-driven, never automatic):
//   pending → verified   (owner confirms the evidence)
//   pending → rejected   (owner rejects it)
//   verified → revoked   (a previously-verified operator is stood down)
// A rejected/revoked account is NOT a verified operator and cannot propose.

import { cleanText, readString } from "@/lib/textClean";

export type OperatorVerificationState = "pending" | "verified" | "rejected" | "revoked";

export const OPERATOR_VERIFICATION_STATES: readonly OperatorVerificationState[] = [
  "pending",
  "verified",
  "rejected",
  "revoked",
];

// How the claimant says they can prove they run the pub. The evidence itself is
// handled OUT OF BAND (owner checks the domain / rings the bar / reads the doc);
// v1 only records which KIND was offered plus a free-text note.
export type OperatorEvidenceKind = "email-domain" | "phone" | "document";

export const OPERATOR_EVIDENCE_KINDS: readonly OperatorEvidenceKind[] = [
  "email-domain",
  "phone",
  "document",
];

export const MAX_EVIDENCE_NOTE = 500;
export const MAX_OPERATOR_VENUE_ID = 120;

// The stored record. accountId is the VERIFIED Supabase uid (never a body value).
export type OperatorClaim = {
  id: string;
  accountId: string;
  venueId: string;
  verificationState: OperatorVerificationState;
  evidenceKind: OperatorEvidenceKind;
  evidenceNote: string;
  createdAt: string;
  reviewedAt?: string;
  reviewerNote?: string;
};

// Validated create input (the account is bound server-side from the JWT).
export type OperatorClaimFields = {
  accountId: string;
  venueId: string;
  evidenceKind: OperatorEvidenceKind;
  evidenceNote: string;
};

// Caller/admin-safe view. Same shape today (no secrets are stored), but a stable
// DTO keeps the wire contract from drifting if the row later grows internal cols.
export type OperatorClaimDTO = {
  id: string;
  venueId: string;
  verificationState: OperatorVerificationState;
  evidenceKind: OperatorEvidenceKind;
  evidenceNote: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

export function toOperatorClaimDTO(claim: OperatorClaim): OperatorClaimDTO {
  return {
    id: claim.id,
    venueId: claim.venueId,
    verificationState: claim.verificationState,
    evidenceKind: claim.evidenceKind,
    evidenceNote: claim.evidenceNote,
    createdAt: claim.createdAt,
    reviewedAt: claim.reviewedAt ?? null,
    reviewerNote: claim.reviewerNote ?? null,
  };
}

export function isOperatorVerificationState(v: unknown): v is OperatorVerificationState {
  return typeof v === "string" && (OPERATOR_VERIFICATION_STATES as readonly string[]).includes(v);
}

export function isOperatorEvidenceKind(v: unknown): v is OperatorEvidenceKind {
  return typeof v === "string" && (OPERATOR_EVIDENCE_KINDS as readonly string[]).includes(v);
}

export type OperatorClaimValidation =
  | { ok: true; fields: OperatorClaimFields }
  | { ok: false; error: string };

/**
 * Validate an untrusted claim body against a server-verified accountId. venueId
 * and a real evidence note are required; the evidence kind must be on the
 * allowlist. Trust-boundary cleaning (`cleanText`) strips inline HTML / control
 * chars and caps length, same as every other community write path.
 */
export function validateOperatorClaim(
  raw: { venueId?: unknown; evidenceKind?: unknown; evidenceNote?: unknown },
  accountId: string,
): OperatorClaimValidation {
  const account = typeof accountId === "string" ? accountId.trim() : "";
  if (!account) return { ok: false, error: "Sign in to run a pub." };

  const venueId = readString(raw.venueId);
  if (!venueId) return { ok: false, error: "Choose a venue." };
  if (venueId.length > MAX_OPERATOR_VENUE_ID) {
    return { ok: false, error: "That venue reference is too long." };
  }

  if (!isOperatorEvidenceKind(raw.evidenceKind)) {
    return { ok: false, error: "Choose how you can prove you run this pub." };
  }

  const evidenceNote = cleanText(raw.evidenceNote, MAX_EVIDENCE_NOTE);
  if (!evidenceNote) {
    return { ok: false, error: "Add a short note so we can check your claim." };
  }

  return {
    ok: true,
    fields: {
      accountId: account,
      venueId: venueId.slice(0, MAX_OPERATOR_VENUE_ID),
      evidenceKind: raw.evidenceKind,
      evidenceNote,
    },
  };
}
