"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import InviteMapLink from "@/components/plan/InviteMapLink";
import { discardBody } from "@/lib/responseBody";
import { trackEvent } from "@/lib/analytics";
import { getAnonId } from "@/lib/anonId";
import {
  GUEST_DISPLAY_NAME_MAX,
  isPlanInviteRsvpSummary,
  isRsvpStatus,
  markDeviceRsvpCommitted,
  readDeviceRsvpCommitted,
  type PlanInviteRsvpSummary,
  type RsvpStatus,
} from "@/lib/planInvite";
import {
  clearPlanCapability,
  parsePlanCapabilitySnapshot,
  planCapabilityEvent,
  readPlanCapabilitySnapshot,
  restorePlanCapability,
  writePlanCapability,
} from "@/lib/planSessionCapability";
import { REACTION_KEYS, REACTION_META, type ReactionKey, type ReactionSummary } from "@/lib/reactions";

// Handle-free RSVP + reaction island on a Plan's public invite page. No
// account: name + Going/Maybe. Failed fetches stay inline and never take the
// static invite card down. Identity is the device anon id (hashed server-side).

// Deliberately its own key, not `pubmax_handle` — RSVP is handle-free by
// design (ruling 2), so a guest's typed name here is a per-invite convenience,
// not the site-wide handle identity.
const GUEST_NAME_STORAGE_KEY = "pubmax:inviteGuestName:v1";

const RSVP_SAVED_LINE = "RSVP saved.";

type InviteRsvpCapabilityResponse = {
  memberToken?: unknown;
  role?: unknown;
  collaborationAuthorized?: unknown;
};

type InviteRsvpSubmitCapability = {
  token: string;
  role: "host" | "guest";
};

type InviteRsvpRestore = (
  planId: string,
) => Promise<{ token: string; role: "host" | "guest" | null } | null>;

/** Resolve the HttpOnly-backed role before route choice so a fast host tap stays host-bound. */
export async function resolveInviteRsvpSubmitCapability(
  planId: string,
  currentToken: string,
  currentRole: "host" | "guest" | null,
  restore: InviteRsvpRestore = restorePlanCapability,
): Promise<InviteRsvpSubmitCapability | null> {
  if (currentToken && currentRole) return { token: currentToken, role: currentRole };
  const restored = await restore(planId);
  return restored?.token && restored.role
    ? { token: restored.token, role: restored.role }
    : null;
}

type InviteRsvpPostInput = {
  planId: string;
  inviteToken: string;
  displayName: string;
  status: RsvpStatus;
  submitterId: string;
  capability: InviteRsvpSubmitCapability | null;
};

type InviteRsvpRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Send through the member-bound route, falling back only after confirmed revocation. */
export async function postInviteRsvp(
  input: InviteRsvpPostInput,
  request: InviteRsvpRequest = fetch,
): Promise<{ response: Response; capability: InviteRsvpSubmitCapability | null }> {
  const send = (capability: InviteRsvpSubmitCapability | null) => request(
    capability
      ? `/api/plans/${input.planId}/invite-rsvp`
      : `/api/invite/${encodeURIComponent(input.inviteToken)}/rsvp`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: input.displayName,
        status: input.status,
        submitterId: input.submitterId,
        ...(capability ? { inviteToken: input.inviteToken, memberToken: capability.token } : {}),
      }),
    },
  );

  const response = await send(input.capability);
  if (input.capability?.role !== "guest" || response.status !== 403) {
    return { response, capability: input.capability };
  }
  const error = await response.clone().json().catch(() => null) as { code?: unknown } | null;
  if (error?.code !== "PLAN_MEMBER_SESSION_REVOKED") {
    return { response, capability: input.capability };
  }

  discardBody(response);
  clearPlanCapability(input.planId);
  return { response: await send(null), capability: null };
}

type InviteRsvpMembershipBoundaryInput = Omit<InviteRsvpPostInput, "capability"> & {
  currentToken: string;
  currentRole: "host" | "guest" | null;
};

export async function submitInviteRsvpAtMembershipBoundary(
  input: InviteRsvpMembershipBoundaryInput,
  restore: InviteRsvpRestore = restorePlanCapability,
  request: InviteRsvpRequest = fetch,
): Promise<{ response: Response; capability: InviteRsvpSubmitCapability | null }> {
  const { currentToken, currentRole, ...postInput } = input;
  const capability = await resolveInviteRsvpSubmitCapability(
    input.planId,
    currentToken,
    currentRole,
    restore,
  );
  return postInviteRsvp({ ...postInput, capability }, request);
}

/** Keep the live Plan authority aligned with the RSVP membership transition. */
export function applyInviteRsvpCapability(
  planId: string,
  status: RsvpStatus,
  currentRole: "host" | "guest" | null,
  response: InviteRsvpCapabilityResponse,
): boolean {
  if (status === "maybe") {
    if (currentRole === "guest") clearPlanCapability(planId);
    return true;
  }
  // Host cannot RSVP. A malformed success must never demote host authority or
  // make the surface claim the RSVP saved.
  if (currentRole === "host") return false;
  if (
    typeof response.memberToken !== "string"
    || !/^[0-9a-f]{64}$/.test(response.memberToken)
    || response.role !== "guest"
    || response.collaborationAuthorized !== false
  ) {
    return false;
  }
  writePlanCapability(planId, {
    token: response.memberToken,
    role: "guest",
    collaborationAuthorized: false,
  });
  return true;
}

function readStoredGuestName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function deviceStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribeDeviceRsvp(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function writeStoredGuestName(name: string): void {
  try {
    window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, name);
  } catch {
    // Storage full / denied — the typed name still drives this session.
  }
}

export function InviteMapPrompt({
  committedThisVisit,
  rememberedFromDevice,
  venueIds,
}: {
  committedThisVisit: boolean;
  rememberedFromDevice: boolean;
  venueIds: string[];
}) {
  // The map link is never gated on the RSVP. Gating it meant a guest who
  // answered and reloaded, came back the next day, answered from another
  // device, or was already Going before the deploy could no longer reach the
  // stops the invite is about. "RSVP saved." is emphasis laid on top of a way
  // out that was always there, not the thing that unlocks it.
  //
  // The two reasons the line shows are one announcement apart. A save made in
  // this visit is news, so it lands as a text change inside a live region that
  // was already mounted and empty - a region inserted together with its own
  // first words is the shape screen readers that watch existing regions miss.
  // A line restored from device memory on arrival is not news, so it is printed
  // outside that region and says nothing. One line is visible either way.
  return (
    <div className="inviteRsvp__mapPrompt">
      <p className="inviteRsvp__status" role="status">
        {committedThisVisit ? RSVP_SAVED_LINE : ""}
      </p>
      {!committedThisVisit && rememberedFromDevice ? (
        <p className="inviteRsvp__status">{RSVP_SAVED_LINE}</p>
      ) : null}
      <InviteMapLink venueIds={venueIds} />
    </div>
  );
}

export default function PlanInviteRsvp({
  token,
  planId,
  initialRsvp,
  initialReactions,
  venueIds,
}: {
  token: string;
  planId: string;
  initialRsvp: PlanInviteRsvpSummary;
  initialReactions: ReactionSummary;
  venueIds: string[];
}) {
  const [rsvp, setRsvp] = useState(initialRsvp);
  const [reactions, setReactions] = useState(initialReactions);
  const [name, setName] = useState(() => readStoredGuestName());
  const [status, setStatus] = useState<RsvpStatus | null>(null);
  const [submittingRsvp, setSubmittingRsvp] = useState(false);
  const [rsvpError, setRsvpError] = useState<string | null>(null);
  const [rsvpCommitted, setRsvpCommitted] = useState(false);
  const [pendingReaction, setPendingReaction] = useState<ReactionKey | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Host row control only after this browser restores a live host capability
  // for the Plan. Removal hits /api/plans/[id]/invite-rsvp so the path-scoped
  // HttpOnly member cookie authorizes after a hard /invite/[token] open.
  const tokenEvent = planCapabilityEvent(planId);
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => window.removeEventListener(tokenEvent, onChange);
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken, role } = parsePlanCapabilitySnapshot(capabilitySnapshot);
  const isHost = Boolean(memberToken && role === "host");

  // A guest's own device is the only record we hold of their answer, so a
  // return visit restores the saved emphasis from it. The server snapshot is
  // false because the server knows nothing about this device, and the value is
  // a boolean, so it is stable across renders. Another tab's RSVP arrives
  // through `storage`; this tab's own arrives through `rsvpCommitted`.
  const rsvpRemembered = useSyncExternalStore(
    subscribeDeviceRsvp,
    () => readDeviceRsvpCommitted(planId, deviceStorage()),
    () => false,
  );

  useEffect(() => {
    if (memberToken) return;
    void restorePlanCapability(planId).catch(() => undefined);
  }, [memberToken, planId]);

  // SSR ships empty `mine` (no device id). Hydrate once with this device's anon id.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/invite/${encodeURIComponent(token)}/reactions?submitterId=${encodeURIComponent(getAnonId())}`,
          { cache: "no-store" },
        );
        if (!res.ok || cancelled) {
          discardBody(res);
          return;
        }
        const data = (await res.json()) as { summary?: ReactionSummary };
        if (data.summary && !cancelled) setReactions(data.summary);
      } catch {
        // Counts from SSR still render; pressed state stays empty until a toggle.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const removeGuest = useCallback(
    async (rsvpId: string) => {
      if (removingId) return;
      setRemovingId(rsvpId);
      setRemoveError(null);
      try {
        const res = await fetch(`/api/plans/${planId}/invite-rsvp`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rsvpId, memberToken }),
        });
        if (!res.ok) {
          discardBody(res);
          setRemoveError("Couldn't remove that RSVP.");
          return;
        }
        setRsvp((current) => {
          const guest = current.guests.find((candidate) => candidate.id === rsvpId);
          if (!guest) return current;
          return {
            counts: { ...current.counts, [guest.status]: Math.max(0, current.counts[guest.status] - 1) },
            guests: current.guests.filter((candidate) => candidate.id !== rsvpId),
          };
        });
      } catch {
        setRemoveError("Couldn't remove that RSVP.");
      } finally {
        setRemovingId(null);
      }
    },
    [memberToken, planId, removingId],
  );

  const submitRsvp = useCallback(
    async (chosen: RsvpStatus) => {
      const trimmedName = name.trim();
      if (!trimmedName || submittingRsvp) return;

      setStatus(chosen);
      setSubmittingRsvp(true);
      setRsvpError(null);
      writeStoredGuestName(trimmedName);

      try {
        const submitted = await submitInviteRsvpAtMembershipBoundary({
          planId,
          inviteToken: token,
          displayName: trimmedName,
          status: chosen,
          submitterId: getAnonId(),
          currentToken: memberToken,
          currentRole: role,
        });
        const res = submitted.response;
        if (!res.ok) {
          discardBody(res);
          setRsvpError(
            res.status === 429
              ? "That's a lot of RSVPs. Give it a moment."
              : res.status === 404
                ? "This invite link isn't valid."
                : res.status === 409 && submitted.capability?.role === "host"
                  ? "Host is already in this Plan."
                  : res.status === 409
                  ? "This guest list is full."
                  : "Couldn't save that RSVP.",
          );
          return;
        }
        const data = (await res.json()) as {
          summary?: unknown;
          isUpdate?: unknown;
          memberToken?: unknown;
          role?: unknown;
          collaborationAuthorized?: unknown;
        };
        if (isPlanInviteRsvpSummary(data.summary)) {
          if (!applyInviteRsvpCapability(planId, chosen, submitted.capability?.role ?? null, data)) {
            setRsvpError("Couldn't save that RSVP.");
            return;
          }
          setRsvp(data.summary);
          setRsvpCommitted(true);
          markDeviceRsvpCommitted(planId, deviceStorage());
          trackEvent("invite_rsvp_submitted", { status: chosen, isUpdate: data.isUpdate === true });
        } else {
          setRsvpError("Couldn't save that RSVP.");
        }
      } catch {
        setRsvpError("Couldn't save that RSVP.");
      } finally {
        setSubmittingRsvp(false);
      }
    },
    [memberToken, name, planId, role, submittingRsvp, token],
  );

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isRsvpStatus(status)) void submitRsvp(status);
    },
    [status, submitRsvp],
  );

  const toggleReaction = useCallback(
    async (reaction: ReactionKey) => {
      if (pendingReaction) return;
      setPendingReaction(reaction);
      setReactionError(null);

      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}/reactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reaction, submitterId: getAnonId() }),
        });
        if (!res.ok) {
          discardBody(res);
          setReactionError(res.status === 429 ? "Slow down a moment." : "Couldn't save that reaction.");
          return;
        }
        const data = (await res.json()) as { summary?: ReactionSummary };
        if (data.summary) {
          setReactions(data.summary);
          trackEvent("invite_reaction_toggled", { reaction, active: data.summary.mine.includes(reaction) });
        }
      } catch {
        setReactionError("Couldn't save that reaction.");
      } finally {
        setPendingReaction(null);
      }
    },
    [pendingReaction, token],
  );

  return (
    <div className="inviteRsvp">
      <div className="inviteRsvp__summary">
        <span>
          <span className="inviteRsvp__count">{rsvp.counts.going}</span>{" "}
          <span className="inviteRsvp__countLabel">going</span>
        </span>
        <span>
          <span className="inviteRsvp__count">{rsvp.counts.maybe}</span>{" "}
          <span className="inviteRsvp__countLabel">maybe</span>
        </span>
      </div>

      {rsvp.guests.length > 0 ? (
        <ul className="inviteRsvp__guests">
          {rsvp.guests.map((guest) => (
            <li className="inviteRsvp__guest" key={guest.id}>
              <span className="inviteRsvp__guestName">{guest.displayName}</span>
              <span className={`inviteRsvp__guestStatus inviteRsvp__guestStatus--${guest.status}`}>
                {guest.status === "going" ? "Going" : "Maybe"}
              </span>
              {isHost ? (
                <button
                  type="button"
                  className="inviteRsvp__guestRemove"
                  disabled={removingId === guest.id}
                  onClick={() => void removeGuest(guest.id)}
                  aria-label={`Remove ${guest.displayName}`}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {rsvp.counts.going + rsvp.counts.maybe > rsvp.guests.length ? (
        <p className="inviteRsvp__more">
          +{rsvp.counts.going + rsvp.counts.maybe - rsvp.guests.length} more
        </p>
      ) : null}

      {rsvp.guests.length === 0 ? (
        <p className="inviteRsvp__empty">No RSVPs yet. Be the first.</p>
      ) : null}

      {removeError ? (
        <p className="inviteRsvp__error" role="status">
          {removeError}
        </p>
      ) : null}

      <form className="inviteRsvp__form" onSubmit={onSubmit}>
        <input
          className="inviteRsvp__nameInput"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={GUEST_DISPLAY_NAME_MAX}
          autoComplete="name"
        />
        <div className="inviteRsvp__statusRow">
          <button
            type="button"
            className="inviteRsvp__statusButton"
            aria-pressed={status === "going"}
            onClick={() => setStatus("going")}
          >
            Going
          </button>
          <button
            type="button"
            className="inviteRsvp__statusButton"
            aria-pressed={status === "maybe"}
            onClick={() => setStatus("maybe")}
          >
            Maybe
          </button>
        </div>
        <button
          type="submit"
          className="inviteRsvp__submit"
          disabled={submittingRsvp || !name.trim() || !status}
        >
          {submittingRsvp ? "Saving…" : "RSVP"}
        </button>
      </form>

      {rsvpError ? (
        <p className="inviteRsvp__error" role="status">
          {rsvpError}
        </p>
      ) : null}

      <InviteMapPrompt
        committedThisVisit={rsvpCommitted}
        rememberedFromDevice={rsvpRemembered}
        venueIds={venueIds}
      />

      <div className="inviteRsvp__reactions">
        {REACTION_KEYS.map((key) => {
          const meta = REACTION_META[key];
          const count = reactions.counts[key] || 0;
          const mine = reactions.mine.includes(key);
          return (
            <button
              key={key}
              type="button"
              className="inviteRsvp__reaction"
              aria-pressed={mine}
              aria-label={meta.label}
              disabled={pendingReaction !== null}
              onClick={() => void toggleReaction(key)}
            >
              <span aria-hidden="true">{meta.emoji}</span>
              {count > 0 ? <span>{count}</span> : null}
            </button>
          );
        })}
      </div>

      {reactionError ? (
        <p className="inviteRsvp__error" role="status">
          {reactionError}
        </p>
      ) : null}
    </div>
  );
}
