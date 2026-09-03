"use client";

// Operator rail (Wayfinder 3.5) — a QUIET footer affordance on the Ledger for the
// person who actually runs the pub. Value-first, nothing loud:
//   • signed out            → a plain "Run this pub?" line that explains sign-in.
//   • signed in, no claim    → "Run this pub?" opens a small verify form (how they
//                              can prove it + a note). Submitting files a claim.
//   • claim pending          → a calm "Verification pending" confirmation.
//   • claim rejected/revoked → the verify form again (re-open for review).
//   • verified operator      → a compact propose form (correction / event / offer
//                              / response) whose submissions route through REVIEW.
//
// Trusted data is never touched here: a proposal is a REQUEST an admin reviews.
// All writes use authedActionFetch so the server binds the account to the verified JWT.

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  OPERATOR_EVIDENCE_KINDS,
  type OperatorClaimDTO,
  type OperatorEvidenceKind,
} from "@/lib/venueOperators";
import {
  OPERATOR_PROPOSAL_TYPES,
  type OperatorProposalType,
} from "@/lib/operatorProposals";

import "./operatorRail.css";

export type OperatorRailPanelProps = {
  venueId: string;
  venueName: string;
};

const EVIDENCE_LABELS: Record<OperatorEvidenceKind, string> = {
  "email-domain": "An email on the pub's website domain",
  phone: "A phone answered behind the bar",
  document: "A document (licence, lease, or letterhead)",
};

const TYPE_LABELS: Record<OperatorProposalType, string> = {
  correction: "Correct a detail",
  event: "Add an event",
  offer: "Add an offer",
  response: "Respond to a note",
};

type Feedback = { kind: "ok" | "error"; text: string } | null;

export default function OperatorRailPanel({ venueId, venueName }: OperatorRailPanelProps) {
  const { session, loading, configured } = useAuth();
  const signedIn = Boolean(session);

  const [open, setOpen] = useState(false);
  const [claim, setClaim] = useState<OperatorClaimDTO | null>(null);
  const [checked, setChecked] = useState(false);

  // Claim form.
  const [evidenceKind, setEvidenceKind] = useState<OperatorEvidenceKind>("email-domain");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [savingClaim, setSavingClaim] = useState(false);
  const [claimFeedback, setClaimFeedback] = useState<Feedback>(null);

  // Propose form.
  const [proposalType, setProposalType] = useState<OperatorProposalType>("correction");
  const [field, setField] = useState("");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [pbody, setPbody] = useState("");
  const [savingProposal, setSavingProposal] = useState(false);
  const [proposalFeedback, setProposalFeedback] = useState<Feedback>(null);

  // Load the caller's own claim state when the card opens (signed in only). State
  // is set inside the async .then chain — never synchronously in the effect body —
  // and guarded by `active` so a close/unmount mid-flight is a no-op (the sanctioned
  // pattern, mirroring components/plan/NightCrawlMode.tsx).
  useEffect(() => {
    if (!open || !signedIn) return;
    let active = true;
    authedActionFetch(`/api/venue-operators/claim?venueId=${encodeURIComponent(venueId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { claim: OperatorClaimDTO | null } | null) => {
        if (!active) return;
        if (data) setClaim(data.claim);
        setChecked(true);
      })
      .catch(() => {
        // Leave claim null; the verify affordance still renders.
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [open, signedIn, venueId]);

  const submitClaim = async () => {
    const note = evidenceNote.trim();
    if (!note) {
      setClaimFeedback({ kind: "error", text: "Add a short note so we can check your claim." });
      return;
    }
    setSavingClaim(true);
    setClaimFeedback(null);
    try {
      const res = await authedActionFetch("/api/venue-operators/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, evidenceKind, evidenceNote: note }),
      });
      const data = (await res.json().catch(() => ({}))) as { claim?: OperatorClaimDTO; error?: string };
      if (!res.ok) {
        setClaimFeedback({ kind: "error", text: errorMessageFrom(data, "Could not file your claim just now.") });
        return;
      }
      if (data.claim) setClaim(data.claim);
      setEvidenceNote("");
      setClaimFeedback({ kind: "ok", text: "Claim sent. We'll check it and be in touch." });
    } catch {
      setClaimFeedback({ kind: "error", text: "Could not reach the server." });
    } finally {
      setSavingClaim(false);
    }
  };

  const resetProposalForm = () => {
    setField("");
    setTitle("");
    setStartsAt("");
    setPbody("");
  };

  const submitProposal = async () => {
    const payload: Record<string, string> = {};
    if (field.trim()) payload.field = field.trim();
    if (title.trim()) payload.title = title.trim();
    if (startsAt.trim()) payload.startsAt = startsAt.trim();
    if (pbody.trim()) payload.body = pbody.trim();
    setSavingProposal(true);
    setProposalFeedback(null);
    try {
      const res = await authedActionFetch("/api/operator-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ venueId, type: proposalType, payload }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProposalFeedback({ kind: "error", text: errorMessageFrom(data, "Could not send your proposal.") });
        return;
      }
      resetProposalForm();
      setProposalFeedback({ kind: "ok", text: "Sent for review. We check operator updates before they show." });
    } catch {
      setProposalFeedback({ kind: "error", text: "Could not reach the server." });
    } finally {
      setSavingProposal(false);
    }
  };

  // Nothing to offer when auth is not configured on this deployment.
  if (!configured) return null;

  const state = claim?.verificationState;
  const canReclaim = !claim || state === "rejected" || state === "revoked";

  return (
    <section className="operatorRail" aria-label={`Run ${venueName}`}>
      {!open ? (
        <button type="button" className="operatorRailTrigger" onClick={() => setOpen(true)}>
          Run this pub?
        </button>
      ) : (
        <div className="operatorRailCard">
          <div className="operatorRailHead">
            <span className="operatorRailTitle">Run {venueName}?</span>
            <button
              type="button"
              className="operatorRailClose"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          {loading ? (
            <p className="operatorRailBody">One moment…</p>
          ) : !signedIn ? (
            <p className="operatorRailBody">
              Sign in with the account that runs {venueName}, then send a claim.
              Claims must be approved before proposal tools open.
            </p>
          ) : !checked ? (
            <p className="operatorRailBody">Checking your status…</p>
          ) : state === "pending" ? (
            <p className="operatorRailBody" role="status">
              {`Claim under review. We're checking that you run ${venueName} and will open the proposal tools once it is approved.`}
            </p>
          ) : state === "verified" ? (
            <div className="operatorRailForm">
              <p className="operatorRailBody">
                {`Your claim for ${venueName} is approved. Propose an update and we'll review it before it shows. Your submissions never overwrite existing notes.`}
              </p>
              <label className="operatorRailField">
                <span>What kind</span>
                <select
                  value={proposalType}
                  onChange={(e) => {
                    setProposalType(e.target.value as OperatorProposalType);
                    resetProposalForm();
                  }}
                >
                  {OPERATOR_PROPOSAL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>

              {proposalType === "correction" ? (
                <label className="operatorRailField">
                  <span>Which detail</span>
                  <input
                    type="text"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    placeholder="Opening hours, phone, address…"
                  />
                </label>
              ) : null}

              {proposalType === "event" || proposalType === "offer" ? (
                <label className="operatorRailField">
                  <span>Title</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={proposalType === "event" ? "Quiz night" : "Two-for-one Tuesdays"}
                  />
                </label>
              ) : null}

              {proposalType === "event" ? (
                <label className="operatorRailField">
                  <span>When</span>
                  <input
                    type="text"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    placeholder="Thursdays, 8pm"
                  />
                </label>
              ) : null}

              <label className="operatorRailField">
                <span>
                  {proposalType === "correction"
                    ? "Corrected value"
                    : proposalType === "response"
                      ? "Your message"
                      : "Details"}
                </span>
                <textarea
                  value={pbody}
                  onChange={(e) => setPbody(e.target.value)}
                  rows={3}
                  placeholder="Keep it short and factual."
                />
              </label>

              <button
                type="button"
                className="operatorRailSubmit"
                onClick={() => void submitProposal()}
                disabled={savingProposal}
              >
                {savingProposal ? "Sending…" : "Send for review"}
              </button>
              {proposalFeedback ? (
                <span
                  className={proposalFeedback.kind === "error" ? "operatorRailError" : "operatorRailOk"}
                  role="status"
                >
                  {proposalFeedback.text}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="operatorRailForm">
              {state === "rejected" || state === "revoked" ? (
                <p className="operatorRailBody">
                  Your previous claim was {state}. You can send fresh details for another review.
                </p>
              ) : (
                <p className="operatorRailBody">
                  Tell us how we can check that you run {venueName}. Approval is required before proposal tools open.
                </p>
              )}
              <label className="operatorRailField">
                <span>How should we check</span>
                <select
                  value={evidenceKind}
                  onChange={(e) => setEvidenceKind(e.target.value as OperatorEvidenceKind)}
                >
                  {OPERATOR_EVIDENCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {EVIDENCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="operatorRailField">
                <span>A short note</span>
                <textarea
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. My email is manager@thepub.co.uk, the pub's website domain."
                />
              </label>
              <button
                type="button"
                className="operatorRailSubmit"
                onClick={() => void submitClaim()}
                disabled={savingClaim || !canReclaim}
              >
                {savingClaim ? "Sending…" : "Send claim"}
              </button>
              {claimFeedback ? (
                <span
                  className={claimFeedback.kind === "error" ? "operatorRailError" : "operatorRailOk"}
                  role="status"
                >
                  {claimFeedback.text}
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
