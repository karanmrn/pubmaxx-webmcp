"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import type { PlanStopDTO } from "@/lib/plan";
import type { PlanConstraint, PlanConstraintKind, PlanInvite, PlanRouteProposal, PlanVote } from "@/lib/planCollaborationStore";
import { discardBody } from "@/lib/responseBody";
import { publishPlanCollaborationChange, subscribePlanCollaborationChange, type PlanCollaborationChangeKind } from "@/lib/planContinuity";
import { trackEvent } from "@/lib/analytics";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
import { formatInviteExpiry, invitePrivacyBlurb } from "@/lib/planInviteUi";
import MatchGroupPrefs from "@/components/plan/MatchGroupPrefs";

type CollaborationState = {
  memberId: string;
  invites: PlanInvite[];
  constraints: PlanConstraint[];
  proposals: PlanRouteProposal[];
  votes: PlanVote[];
};

type Props = {
  planId: string;
  memberToken: string;
  isHost: boolean;
  draftStops: PlanStopDTO[];
  routeRevision: string | number | null;
  canPropose: boolean;
  onProposalCreated(): void;
};

const CONSTRAINT_KINDS: Array<{ value: PlanConstraintKind; label: string }> = [
  { value: "accessibility", label: "Access" },
  { value: "budget", label: "Budget" },
  { value: "zero_proof", label: "Zero-proof" },
  { value: "timing", label: "Timing" },
  { value: "transport", label: "Transport" },
  { value: "other", label: "Other" },
];

function operationKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function PlanCollaborationPanel({ planId, memberToken, isHost, draftStops, routeRevision, canPropose, onProposalCreated }: Props) {
  const [state, setState] = useState<CollaborationState>({ memberId: "", invites: [], constraints: [], proposals: [], votes: [] });
  const [kind, setKind] = useState<PlanConstraintKind>("other");
  const [priority, setPriority] = useState<PlanConstraint["priority"]>("preference");
  const [constraintValue, setConstraintValue] = useState("");
  const [proposalReason, setProposalReason] = useState("");
  const [resolutionConstraintId, setResolutionConstraintId] = useState("");
  const [evidenceProposalId, setEvidenceProposalId] = useState("");
  const [evidenceSources, setEvidenceSources] = useState<Record<string, { sourceUrl: string; publisher: string }>>({});
  const [invite, setInvite] = useState<{ value: PlanInvite; url: string } | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const refreshRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);

  const refresh = useCallback(async () => {
    if (!memberToken) return;
    const generation = (refreshRequestRef.current?.generation ?? 0) + 1;
    refreshRequestRef.current?.controller.abort();
    const controller = new AbortController();
    refreshRequestRef.current = { generation, controller };
    try {
      const response = await fetch(`/api/plans/${planId}/collaboration`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { authorization: `Bearer ${memberToken}` },
      });
      if (!response.ok) {
        discardBody(response);
        return;
      }
      const body = await response.json() as Partial<CollaborationState>;
      if (controller.signal.aborted || refreshRequestRef.current?.generation !== generation) return;
      setState({
        memberId: typeof body.memberId === "string" ? body.memberId : "",
        invites: Array.isArray(body.invites) ? body.invites : [],
        constraints: Array.isArray(body.constraints) ? body.constraints : [],
        proposals: Array.isArray(body.proposals) ? body.proposals : [],
        votes: Array.isArray(body.votes) ? body.votes : [],
      });
    } catch {
      // Keep the last confirmed collaboration state during a transient response failure.
    }
  }, [memberToken, planId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const unsubscribe = subscribePlanCollaborationChange(planId, () => void refresh());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      refreshRequestRef.current?.controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
    };
  }, [planId, refresh]);

  const announce = (kind: PlanCollaborationChangeKind) => publishPlanCollaborationChange(planId, kind);

  async function createInvite() {
    setPending("invite"); setError(""); setStatus("");
    try {
      const response = await fetch(`/api/plans/${planId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify({ expiresInMinutes: 1_440 }),
      });
      const body = await response.json();
      if (!response.ok || !body?.token || !body?.invite) throw new Error(errorMessageFrom(body, "Could not create an invite."));
      const url = `${window.location.origin}/plan/${planId}#invite=${encodeURIComponent(body.token)}`;
      setInvite({ value: body.invite, url });
      // invite.id is the invite's own row id — an opaque, non-secret database
      // identifier, never the raw one-use token/capability in the url above —
      // so it links safely to invite_redeemed for k-factor (docs/METRICS_FUNNEL.md).
      if (typeof body.invite?.id === "string") trackEvent("invite_created", { inviteId: body.invite.id });
      announce("invite");
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(url);
        setStatus("Private one-use invite copied. It expires by plan end (or sooner).");
      } catch {
        setStatus(
          offlineOrMessage("Invite created, but could not copy it. Try again.")
        );
      }
      await refresh();
    } catch (caught) {
      setError(
        offlineOrMessage(caught instanceof Error
            ? caught.message
            : "Could not create an invite.")
      );
    }
    finally { setPending(""); }
  }

  async function revokeInvite(inviteId: string) {
    setPending("invite"); setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/invites/${inviteId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not revoke this invite."));
      if (invite?.value.id === inviteId) setInvite(null);
      setRevokeConfirmId(null);
      announce("invite");
      setStatus("Invite revoked."); await refresh();
    } catch (caught) {
      setError(
        offlineOrMessage(caught instanceof Error
            ? caught.message
            : "Could not revoke this invite.")
      );
    }
    finally { setPending(""); }
  }

  async function addConstraint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!constraintValue.trim()) return;
    setPending("constraint"); setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/constraints`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify({ kind, priority, value: constraintValue }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not add that need."));
      announce("constraint");
      setConstraintValue(""); setStatus("Crew need added to this plan."); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add that need."); }
    finally { setPending(""); }
  }

  async function createProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const revision = Number(routeRevision);
    if (!proposalReason.trim() || !Number.isInteger(revision)) return;
    setPending("proposal"); setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify({ reason: proposalReason, expectedRouteRevision: revision, stops: draftStops, resolvedConstraintIds: [] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not send that route proposal."));
      announce("proposal");
      setProposalReason(""); setStatus("Proposal sent. The host must confirm before the route changes.");
      onProposalCreated(); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not send that route proposal."); }
    finally { setPending(""); }
  }

  async function resolveConstraint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const proposal = state.proposals.find((candidate) => candidate.id === evidenceProposalId && candidate.status === "pending");
    if (!resolutionConstraintId || !proposal) return;
    const sources = proposal.stops.map((stop) => ({ venueId: stop.venueId, sourceUrl: evidenceSources[stop.venueId]?.sourceUrl.trim() ?? "", publisher: evidenceSources[stop.venueId]?.publisher.trim() ?? "", observedAt: new Date().toISOString(), note: `Reviewed for ${stop.venueName}.` }));
    if (sources.some((source) => !source.sourceUrl || !source.publisher)) return;
    setPending("resolution"); setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/constraints/${resolutionConstraintId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify({ evidence: { proposalId: proposal.id, routeRevision: proposal.expectedRouteRevision, sources } }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not check those sources."));
      announce("constraint");
      setResolutionConstraintId(""); setEvidenceProposalId(""); setEvidenceSources({}); setStatus("Sources added to this proposal."); await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not check those sources."); }
    finally { setPending(""); }
  }

  async function mutateProposal(proposalId: string, operation: "approve" | "reject" | "accepted" | "rejected") {
    setPending(`${proposalId}:${operation}`); setError("");
    const decision = operation === "accepted" || operation === "rejected";
    try {
      const response = await fetch(`/api/plans/${planId}/proposals/${proposalId}/${decision ? "decision" : "votes"}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}`, "idempotency-key": operationKey() },
        body: JSON.stringify(decision ? { decision: operation } : { value: operation }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, decision ? "The route was not changed." : "Could not record your vote."));
      announce(decision ? "decision" : "vote");
      setStatus(decision ? `Proposal ${operation}.` : "Your vote is in.");
      await refresh();
      if (operation === "accepted") {
        // Confirming a route proposal is a first meaningful plan action
        // inside the native shell — the contextual push pre-permission
        // explainer's earliest opportunity. No-op on web/SSR.
        recordPlanHighIntentAction();
        window.location.reload();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : decision ? "The route was not changed." : "Could not record your vote."); }
    finally { setPending(""); }
  }

  const pendingProposals = state.proposals.filter((proposal) => proposal.status === "pending");
  const evidenceProposal = pendingProposals.find((proposal) => proposal.id === evidenceProposalId) ?? null;

  return (
    <section className="planCollab" aria-labelledby="plan-collab-title">
      <div className="planCollab__heading">
        <div><p className="planPage__eyebrow">Crew decisions</p><h3 id="plan-collab-title">Plan it together</h3></div>
        <span>{isHost ? "Host" : "Guest"}</span>
      </div>

      {isHost ? (
        <div className="planCollab__invite">
          <button type="button" onClick={() => void createInvite()} disabled={Boolean(pending)}>Create private invite</button>
          <small className="planCollab__status">{invitePrivacyBlurb()}</small>
          {invite ? <output aria-label="Private invite link">{invite.url}</output> : null}
          {state.invites.map((activeInvite) => (
            <div className="planCollab__activeInvite" key={activeInvite.id}>
              <small>
                One-use · {formatInviteExpiry(activeInvite.expiresAt)}
                {" · "}
                {new Date(activeInvite.expiresAt).toLocaleString()}
              </small>
              {revokeConfirmId === activeInvite.id ? (
                <span className="planCollab__actions">
                  <button type="button" onClick={() => void revokeInvite(activeInvite.id)} disabled={Boolean(pending)}>
                    Confirm revoke
                  </button>
                  <button type="button" className="planCollab__quiet" onClick={() => setRevokeConfirmId(null)} disabled={Boolean(pending)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="planCollab__quiet"
                  onClick={() => setRevokeConfirmId(activeInvite.id)}
                  disabled={Boolean(pending)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {state.memberId ? (
        <MatchGroupPrefs planId={planId} memberId={state.memberId} memberToken={memberToken} isHost={isHost} />
      ) : null}

      <form className="planCollab__form" onSubmit={addConstraint}>
        <strong>Add a need</strong>
        <div className="planCollab__fields">
          <select aria-label="Need type" value={kind} onChange={(event) => setKind(event.target.value as PlanConstraintKind)}>{CONSTRAINT_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select aria-label="Need priority" value={priority} onChange={(event) => setPriority(event.target.value as PlanConstraint["priority"])}><option value="preference">Preference</option><option value="required">Must-have</option></select>
        </div>
        <div className="planCollab__inputRow"><input maxLength={180} value={constraintValue} onChange={(event) => setConstraintValue(event.target.value)} placeholder="e.g. step-free entrance" aria-label="Describe this crew need" /><button disabled={pending === "constraint" || !constraintValue.trim()}>Add</button></div>
      </form>

      {state.constraints.length ? <ul className="planCollab__constraints">{state.constraints.map((constraint) => <li key={constraint.id}><span>{constraint.value}{constraint.evidence ? <span className="planCollab__provenance">{constraint.evidence.sources.map((source) => <a key={source.venueId} href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.publisher} · {source.venueId}</a>)}</span> : null}</span><small>{constraint.evidence ? "sources for this proposal" : constraint.priority} · {constraint.kind.replace("_", " ")}</small></li>)}</ul> : null}

      {isHost && pendingProposals.length > 0 && state.constraints.some((constraint) => constraint.priority === "required") ? (
        <form className="planCollab__form" onSubmit={resolveConstraint}>
          <strong>Check each must-have</strong>
          <select aria-label="Must-have need to review" value={resolutionConstraintId} onChange={(event) => setResolutionConstraintId(event.target.value)}><option value="">Choose a must-have need</option>{state.constraints.filter((constraint) => constraint.priority === "required").map((constraint) => <option key={constraint.id} value={constraint.id}>{constraint.value}</option>)}</select>
          <select aria-label="Route proposal to check" value={evidenceProposalId} onChange={(event) => { setEvidenceProposalId(event.target.value); setEvidenceSources({}); }}><option value="">Choose a route proposal</option>{pendingProposals.map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.reason}</option>)}</select>
          {evidenceProposal?.stops.map((stop) => <div className="planCollab__source" key={stop.venueId}><strong>{stop.venueName}</strong><input type="url" value={evidenceSources[stop.venueId]?.sourceUrl ?? ""} onChange={(event) => setEvidenceSources((current) => ({ ...current, [stop.venueId]: { sourceUrl: event.target.value, publisher: current[stop.venueId]?.publisher ?? "" } }))} placeholder="https://source.example/listing" aria-label={`Source URL for ${stop.venueName}`} /><input value={evidenceSources[stop.venueId]?.publisher ?? ""} onChange={(event) => setEvidenceSources((current) => ({ ...current, [stop.venueId]: { sourceUrl: current[stop.venueId]?.sourceUrl ?? "", publisher: event.target.value } }))} placeholder="Publisher or venue" aria-label={`Source publisher for ${stop.venueName}`} /></div>)}
          <p className="planCollab__evidenceNote">Add a source for every proposed stop. It applies only to this version of the route. Anything without a source stays unresolved.</p>
          <button disabled={pending === "resolution" || !resolutionConstraintId || !evidenceProposal || evidenceProposal.stops.some((stop) => !evidenceSources[stop.venueId]?.sourceUrl.trim() || !evidenceSources[stop.venueId]?.publisher.trim())}>Check this proposal</button>
        </form>
      ) : null}

      {canPropose ? (
        <form className="planCollab__form" onSubmit={createProposal}>
          <strong>{isHost ? "Share this route change" : "Propose this swap"}</strong>
          <textarea maxLength={300} value={proposalReason} onChange={(event) => setProposalReason(event.target.value)} placeholder="Why this route works better" aria-label="Explain this route proposal" />
          {state.constraints.some((constraint) => constraint.priority === "required") ? <p className="planCollab__evidenceNote">A must-have need isn&rsquo;t ticked off until the host confirms every stop can actually meet it. A proposal can&rsquo;t promise that on its own.</p> : null}
          <button disabled={pending === "proposal" || !proposalReason.trim()}>Send for crew review</button>
        </form>
      ) : null}

      {pendingProposals.length ? <div className="planCollab__proposals"><strong>Open proposals</strong>{pendingProposals.map((proposal) => {
        const votes = state.votes.filter((vote) => vote.proposalId === proposal.id);
        const approveCount = votes.filter((vote) => vote.value === "approve").length;
        const rejectCount = votes.filter((vote) => vote.value === "reject").length;
        const myVote = votes.find((vote) => vote.memberId === state.memberId)?.value;
        const unresolved = state.constraints.filter((constraint) => proposal.unresolvedConstraintIds.includes(constraint.id));
        return <article key={proposal.id}><p>{proposal.reason}</p><ol>{proposal.stops.map((stop) => <li key={stop.venueId}>{stop.venueName}</li>)}</ol><small>{approveCount} for · {rejectCount} against</small>{unresolved.length ? <div className="planCollab__blocked"><strong>Must-have needs left</strong><ul>{unresolved.map((constraint) => <li key={constraint.id}>{constraint.value}</li>)}</ul></div> : null}<div className="planCollab__actions"><button aria-pressed={myVote === "approve"} onClick={() => void mutateProposal(proposal.id, "approve")} disabled={Boolean(pending)}>Vote for</button><button aria-pressed={myVote === "reject"} className="planCollab__quiet" onClick={() => void mutateProposal(proposal.id, "reject")} disabled={Boolean(pending)}>Vote against</button>{isHost ? <><button onClick={() => void mutateProposal(proposal.id, "accepted")} disabled={Boolean(pending) || unresolved.length > 0}>Accept route</button><button className="planCollab__quiet" onClick={() => void mutateProposal(proposal.id, "rejected")} disabled={Boolean(pending)}>Reject</button></> : null}</div></article>;
      })}</div> : null}
      {status ? <p className="planCollab__status" role="status">{status}</p> : null}
      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
    </section>
  );
}
