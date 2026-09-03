"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { trackEvent } from "@/lib/analytics";
import { authedActionFetch } from "@/lib/authedFetch";
import { CREW_NAME_MAX, type CrewMemberDTO, type CrewPresenceStatus } from "@/lib/crew";
import { subscribeToPlanCrew } from "@/lib/crewRealtime";
import { isClassicPlanInviteToken } from "@/lib/planCrewInviteUrl";
import { planRouteReady } from "@/lib/planPrivacy";
import { NIGHT_CRAWL_ENGAGE_EVENT } from "@/lib/nightCrawlEngage";
import { isIdentityNudgePending, recordPlanNudgeTrigger } from "@/lib/identityNudge";
import { rememberLastCrew } from "@/lib/lastCrew";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot, restorePlanCapability, writePlanCapability } from "@/lib/planSessionCapability";
import { clearPersistentPlanMutationKey, persistentPlanMutationKey } from "@/lib/planMutationKey";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
import { subscribeToAuthFragmentRestored } from "@/lib/authRedirect";
import { errorMessageFrom } from "@/lib/apiErrorMessage";

function readInviteTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite");
}

const STATUS_LABELS: Record<CrewPresenceStatus, string> = {
  in: "In",
  on_the_way: "On the way",
  here: "Here",
  running_late: "Running late",
  start_without_me: "Start without me",
};

// §4.10: the server passes only the host display name, never the crew list. The
// full crew (names + presence + size) is fetched on mount from the
// capability-gated /api/plans/[id] and only ever arrives for a valid member.
export default function PlanCrew({ planId, hostName }: { planId: string; hostName: string }) {
  const { identityResolved } = useAuth();
  const [crew, setCrew] = useState<CrewMemberDTO[]>([]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sessionCheckedPlanId, setSessionCheckedPlanId] = useState<string | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [restoredHashVersion, setRestoredHashVersion] = useState(0);
  // Invite in #invite= — bumped by hashchange, auth-fragment restore, and
  // replaceState clears after join/redeem (replaceState does not fire hashchange).
  const [hashInviteToken, setHashInviteToken] = useState<string | null>(null);
  const tokenEvent = planCapabilityEvent(planId);
  const statusKey = `pubmax-plan-status:${planId}`;
  const statusEvent = `pubmax-plan-status-change:${planId}`;

  // Derived from sessionStorage so it survives a reload and stays lint-clean
  // (no setState-in-effect) — same external-store pattern as memberToken below.
  const myStatus = useSyncExternalStore<CrewPresenceStatus | "">(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(statusEvent, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(statusEvent, onChange);
      };
    },
    () => {
      try {
        const stored = sessionStorage.getItem(statusKey);
        return stored && stored in STATUS_LABELS ? (stored as CrewPresenceStatus) : "";
      } catch {
        return "";
      }
    },
    () => "",
  );

  const rememberStatus = useCallback((status: CrewPresenceStatus | "") => {
    try {
      if (status) sessionStorage.setItem(statusKey, status);
      else sessionStorage.removeItem(statusKey);
    } catch {
      // sessionStorage can be unavailable (private mode); presence still works in-session.
    }
    window.dispatchEvent(new Event(statusEvent));
  }, [statusKey, statusEvent]);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => {
      return readPlanCapabilitySnapshot(planId);
    },
    () => "|0|",
  );
  const { token: memberToken, collaborationAuthorized, role } = parsePlanCapabilitySnapshot(capabilitySnapshot);
  const sessionReady = Boolean(memberToken) || sessionCheckedPlanId === planId;
  const restoreAttempt = useRef({ planId, identityResolved, sessionAttempt, attempted: false });

  useEffect(() => {
    const attempt = restoreAttempt.current;
    if (
      attempt.planId !== planId
      || attempt.identityResolved !== identityResolved
      || attempt.sessionAttempt !== sessionAttempt
    ) {
      attempt.planId = planId;
      attempt.identityResolved = identityResolved;
      attempt.sessionAttempt = sessionAttempt;
      attempt.attempted = false;
    }
    if (memberToken || !identityResolved || attempt.attempted) return;
    attempt.attempted = true;
    let active = true;
    void restorePlanCapability(planId)
      .then(() => {
        if (!active) return;
        setSessionUnavailable(false);
        setSessionCheckedPlanId(planId);
      })
      .catch(() => { if (active) setSessionUnavailable(true); });
    return () => { active = false; };
  }, [identityResolved, memberToken, planId, sessionAttempt]);

  useEffect(() => {
    return subscribeToAuthFragmentRestored(() => {
      setRestoredHashVersion((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    const sync = () => setHashInviteToken(readInviteTokenFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [planId, restoredHashVersion]);

  useEffect(() => {
    if (!memberToken) return;
    const inviteToken = hashInviteToken;
    if (!inviteToken) return;
    const clearInviteHash = () => {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setHashInviteToken(null);
    };
    // Classic multi-use tokens authorize crew join only. Collaboration upgrade
    // needs a one-use invite from PlanCollaborationPanel — never POST redeem
    // with the classic token (it is a different capability shape).
    if (isClassicPlanInviteToken(inviteToken)) {
      if (role === "host" || collaborationAuthorized) clearInviteHash();
      return;
    }
    if (collaborationAuthorized || role === "host") {
      clearInviteHash();
      return;
    }
    const controller = new AbortController();
    fetch(`/api/plans/${planId}/invites/redeem`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ inviteToken }),
    })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(errorMessageFrom(body, "Could not load crew decisions."));
        writePlanCapability(planId, { token: memberToken, collaborationAuthorized: true, role: "guest" });
        // body.inviteId is the invite's own row id (see upgradeMemberInvite in
        // lib/planCollaborationStore.ts) — links back to invite_created for
        // k-factor; null on a replayed/already-authorized redemption, so no
        // event fires (an already-counted invite should not double count).
        if (typeof body?.inviteId === "string" && body.inviteId) {
          trackEvent("invite_redeemed", { inviteId: body.inviteId });
        }
        clearInviteHash();
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load crew decisions.");
      });
    return () => controller.abort();
  }, [collaborationAuthorized, hashInviteToken, memberToken, planId, role]);

  const refetchCrew = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const response = await fetch(`/api/plans/${planId}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json();
    if (Array.isArray(body?.crew)) setCrew(body.crew);
  }, [planId]);

  // Mount-upgrade: pull the full crew straight away so a member sees the real
  // roster without waiting for the first poll tick. Anonymous viewers get the
  // preview envelope (no `crew` array), so this leaves the host-only view intact.
  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active && Array.isArray(body?.crew)) setCrew(body.crew);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [planId]);

  useEffect(() => {
    return subscribeToPlanCrew(planId, refetchCrew, { poll: refetchCrew });
  }, [planId, refetchCrew]);

  // Sort My Night P1: remember the usual lot once a real crew forms (2+ names)
  // so the next /plan can one-tap re-invite them via the share link.
  useEffect(() => {
    if (crew.length < 2) return;
    rememberLastCrew(
      crew.map((member) => member.name),
      planId,
    );
  }, [crew, planId]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    const inviteToken = hashInviteToken ?? undefined;
    // Bare /plan/{id} must never POST join (invite-only after the IDOR close).
    if (!inviteToken) {
      setError("Open the invite link your host sent.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const operationScope = `join:${planId}`;
      const operationKey = await persistentPlanMutationKey(operationScope, { name: name.trim(), inviteToken });
      const response = await authedActionFetch(`/api/plans/${planId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": operationKey },
        body: JSON.stringify({ name, inviteToken }),
      });
      const body = await response.json();
      if (!response.ok || !body?.memberToken) throw new Error(errorMessageFrom(body, "Could not join this plan."));
      writePlanCapability(planId, { token: body.memberToken, collaborationAuthorized: body.collaborationAuthorized === true, role: "guest" });
      clearPersistentPlanMutationKey(operationScope, operationKey);
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      setHashInviteToken(null);
      rememberStatus("in");
      const nextCrew = body.plan?.crew ?? crew;
      setCrew(nextCrew);
      const routeReady = body.plan ? planRouteReady(body.plan) : false;
      const deliveryToken = typeof body.crewCommitted === "string" ? body.crewCommitted : undefined;
      trackEvent(
        "crew_committed",
        {
          source: "shared-plan",
          participants: Array.isArray(nextCrew) ? nextCrew.length : 1,
          routeReady,
        },
        deliveryToken ? { deliveryToken } : undefined,
      );
      if (typeof body.friendEdgesFormed === "number" && body.friendEdgesFormed > 0) {
        trackEvent("friend_edge_via_crew", { source: "plan-crew" });
      }
      // Identity-first ordering (docs/PROMPT_ORCHESTRATION.md): the account
      // nudge wins the shared moment; push defers to a pending identity nudge.
      recordPlanNudgeTrigger(planId);
      if (!isIdentityNudgePending()) {
        recordPlanHighIntentAction();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join this plan.");
    } finally {
      setPending(false);
    }
  }

  async function updatePresence(status: CrewPresenceStatus) {
    if (!memberToken || status === myStatus) return;
    const previous = myStatus;
    rememberStatus(status); // optimistic: reflect the tap on the same frame (Apple: respond on press)
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/plans/${planId}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberToken, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not update your status."));
      setCrew(body.crew ?? crew);
      if (status === "here") {
        try {
          sessionStorage.removeItem(`pubmax:night-crawl-collapsed:${planId}`);
        } catch {
          // storage-restricted: Night Crawl still receives the engage event
        }
        try {
          window.dispatchEvent(new CustomEvent(NIGHT_CRAWL_ENGAGE_EVENT, { detail: { planId } }));
        } catch {
          // Event unavailable
        }
      }
    } catch (caught) {
      rememberStatus(previous); // roll back the optimistic state on failure
      setError(caught instanceof Error ? caught.message : "Could not update your status.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="planCrew" aria-labelledby="plan-crew-title">
      <div className="planCrew__heading">
        <div><p className="planPage__eyebrow">The crew</p><h2 id="plan-crew-title">Who&rsquo;s in</h2></div>
        <span>{crew.length || ""}</span>
      </div>

      {!sessionReady && !memberToken ? (
        <p className="planCrew__empty" role="status">
          {sessionUnavailable ? "Your private crew session is temporarily unavailable." : "Restoring your private crew session…"}
          {sessionUnavailable ? <button type="button" onClick={() => { setSessionUnavailable(false); setSessionAttempt((value) => value + 1); }}>Retry</button> : null}
        </p>
      ) : !memberToken && !hashInviteToken ? (
        <p className="planCrew__empty" role="status">
          Open the invite link your host sent to join this crew.
        </p>
      ) : !memberToken ? (
        <form className="planCrew__join" onSubmit={join}>
          <label htmlFor="join-name">Your name is enough.</label>
          <p className="planCrew__joinNote">
            If you&rsquo;re signed in with a claimed handle, joining connects you
            with the host in your lot.
          </p>
          <div><input id="join-name" autoComplete="name" maxLength={CREW_NAME_MAX} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required /><button type="submit" disabled={pending}>I&rsquo;m in</button></div>
        </form>
      ) : (
        <div className="planCrew__presence" role="group" aria-label="Update your status">
          {(Object.keys(STATUS_LABELS) as CrewPresenceStatus[]).map((status) => (
            <button
              type="button"
              key={status}
              disabled={pending}
              aria-pressed={myStatus === status}
              data-active={myStatus === status ? "" : undefined}
              onClick={() => updatePresence(status)}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      )}

      {crew.length ? (
        <ul className="planCrew__list">
          {crew.map((member, index) => (
            <li key={member.id} style={{ "--i": index } as CSSProperties}>
              <span>{member.name}</span>
              <small data-status={member.status}>{STATUS_LABELS[member.status]}</small>
            </li>
          ))}
        </ul>
      ) : (
        // Preview: the host is the only name the server will name to a
        // non-member. The rest of the roster arrives once the fetch above
        // confirms a member capability.
        <ul className="planCrew__list">
          <li style={{ "--i": 0 } as CSSProperties}>
            <span>{hostName}</span>
            <small>Host</small>
          </li>
        </ul>
      )}
      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
    </section>
  );
}
