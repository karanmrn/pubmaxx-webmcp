"use client";

// One crew: who is in it, who you can bring, and the way out.
//
// Three readers land here and the server tells them apart, not this file. The
// crew snapshot answers `member` for somebody already in, `preview` for a
// mutual of the host who is not, and 404 for everybody else. An invited mate is
// a `preview` reader carrying an invitation id in the link, because the crew
// API has no read of invitations addressed to you: the link is the only way the
// id travels, and `accept_social_crew_invitation_atomic` still refuses anybody
// who is not the named target, so the link points, it never authorises.
//
// Inviting is mutuals-only at the database, so the picker offers the viewer's
// own lot and a handle search over claimed profiles, and nothing else.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import SiteNav from "@/components/nav/SiteNav";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import type {
  SocialCrewJoinRequestDTO,
  SocialCrewReadDTO,
} from "@/lib/socialCrew";
import {
  CREW_INVITE_LINK_NOTE,
  CREW_MUTUALS_ONLY_NOTE,
  CREW_OWNER_LEAVE_NOTE,
  CREW_PHASE_LABEL,
  CREW_ROLE_LABEL,
  CREW_VISIBILITY_LABEL,
  canLeaveCrew,
  canManageCrew,
  crewIdempotencyKey,
  crewInviteUrl,
  crewStartsCaption,
  parseCrewMutation,
  parseCrewJoinRequestQueue,
  parseCrewRead,
} from "@/lib/socialCrewsUi";

import "@/components/social/crews.css";

type LoadState = "loading" | "ready" | "missing" | "error";
type JoinRequestLoadState = "idle" | "loading" | "ready" | "error";
type Match = { id: string; handle: string; displayName?: string };
type IdentityMessage = { identityKey: string; text: string } | null;

export default function CrewDetailClient({
  crewId,
  invitationId,
}: {
  crewId: string;
  invitationId: string | null;
}) {
  const router = useRouter();
  const { accountRevision, identityResolved } = useAuth();
  const identityKey = String(accountRevision);
  const scopeKey = `${crewId}:${identityKey}:${identityResolved ? "resolved" : "unresolved"}`;
  const [status, setStatus] = useState<LoadState>("loading");
  const [crew, setCrew] = useState<SocialCrewReadDTO | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<IdentityMessage>(null);
  const [notice, setNotice] = useState<IdentityMessage>(null);
  const [viewerHandle, setViewerHandle] = useState("");
  const [lot, setLot] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinRequests, setJoinRequests] = useState<SocialCrewJoinRequestDTO[]>([]);
  const [joinRequestsHaveMore, setJoinRequestsHaveMore] = useState(false);
  const [joinRequestStatus, setJoinRequestStatus] =
    useState<JoinRequestLoadState>("idle");
  const [joinRequestAttempt, setJoinRequestAttempt] = useState(0);
  const [focusJoinRequests, setFocusJoinRequests] = useState(false);
  const [loadedIdentityKey, setLoadedIdentityKey] = useState<string | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinRequestHeading = useRef<HTMLHeadingElement | null>(null);
  const previousScopeKey = useRef(scopeKey);
  const queueRefreshAuthorityRevision = useRef<number | null>(null);

  useEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    void Promise.resolve().then(() => {
      if (previousScopeKey.current !== scopeKey) return;
      setCrew(null);
      setStatus("loading");
      setBusy(false);
      setNotice(null);
      setProblem(null);
      setViewerHandle("");
      setLot([]);
      setQuery("");
      setMatches([]);
      setInviteLink(null);
      setCopied(false);
      setJoinRequests([]);
      setJoinRequestsHaveMore(false);
      setJoinRequestStatus("idle");
      setFocusJoinRequests(false);
      setLoadedIdentityKey(null);
      queueRefreshAuthorityRevision.current = null;
    });
  }, [scopeKey]);

  useEffect(() => {
    if (!identityResolved) return;
    let active = true;
    const controller = new AbortController();
    void Promise.resolve().then(() => setStatus("loading"));
    authedActionFetch(`/api/social/crews/${encodeURIComponent(crewId)}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) {
          discardBody(response);
          return "missing" as const;
        }
        if (!response.ok) {
          discardBody(response);
          throw new Error("Crew unavailable");
        }
        const read = parseCrewRead(await response.json());
        if (!read) throw new Error("Crew malformed");
        return read;
      })
      .then((result) => {
        if (!active) return;
        setLoadedIdentityKey(identityKey);
        if (result === "missing") {
          setCrew(null);
          setNotice(null);
          setProblem(null);
          setJoinRequests([]);
          setJoinRequestsHaveMore(false);
          setJoinRequestStatus("idle");
          setFocusJoinRequests(false);
          setStatus("missing");
          return;
        }
        setCrew(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setLoadedIdentityKey(identityKey);
        setCrew(null);
        setNotice(null);
        setProblem(null);
        setJoinRequests([]);
        setJoinRequestsHaveMore(false);
        setJoinRequestStatus("idle");
        setFocusJoinRequests(false);
        setStatus("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, crewId, identityKey, identityResolved]);

  useEffect(() => {
    if (
      !identityResolved ||
      loadedIdentityKey !== identityKey ||
      crew?.kind !== "member" ||
      crew.visibility !== "open" ||
      !canManageCrew(crew.viewer.role)
    ) {
      return;
    }
    let active = true;
    const controller = new AbortController();
    void Promise.resolve().then(() => setJoinRequestStatus("loading"));
    authedActionFetch(
      `/api/social/crews/${encodeURIComponent(crewId)}/join-requests`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (response.status === 404) {
          discardBody(response);
          return "missing" as const;
        }
        if (!response.ok) {
          discardBody(response);
          throw new Error("Join requests unavailable");
        }
        const queue = parseCrewJoinRequestQueue(await response.json());
        if (!queue) throw new Error("Join requests malformed");
        return queue;
      })
      .then((queue) => {
        if (!active) return;
        if (queue === "missing") {
          setJoinRequests([]);
          setJoinRequestsHaveMore(false);
          setJoinRequestStatus("idle");
          const authorityRevision =
            crew?.kind === "member" ? crew.authorityRevision : null;
          if (
            authorityRevision !== null &&
            queueRefreshAuthorityRevision.current !== authorityRevision
          ) {
            queueRefreshAuthorityRevision.current = authorityRevision;
            setAttempt((value) => value + 1);
          }
          return;
        }
        setJoinRequests(queue.items);
        setJoinRequestsHaveMore(queue.hasMore);
        setJoinRequestStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setJoinRequests([]);
        setJoinRequestsHaveMore(false);
        setJoinRequestStatus("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [crew, crewId, identityKey, identityResolved, joinRequestAttempt, loadedIdentityKey]);

  useEffect(() => {
    if (
      !focusJoinRequests ||
      status !== "ready" ||
      joinRequestStatus !== "ready"
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      joinRequestHeading.current?.focus();
      setFocusJoinRequests(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusJoinRequests, joinRequestStatus, status]);

  useEffect(() => {
    if (!identityResolved) return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authedActionFetch("/api/social/access", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          discardBody(response);
          return;
        }
        const body = (await response.json()) as { viewerHandle?: unknown };
        const handle =
          typeof body.viewerHandle === "string" ? normalizeHandle(body.viewerHandle) : "";
        if (!active || !handle) return;
        setViewerHandle(handle);
        const lotResponse = await fetch(
          `/api/profiles/${encodeURIComponent(handle)}/lot`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!lotResponse.ok) {
          discardBody(lotResponse);
          return;
        }
        const lotBody = (await lotResponse.json()) as { lot?: unknown };
        if (!active) return;
        setLot(Array.isArray(lotBody.lot) ? (lotBody.lot as string[]) : []);
      } catch {
        // The crew still reads without a lot to offer.
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [identityKey, identityResolved]);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const clean = normalizeHandle(query);
    if (clean.length < 2) {
      void Promise.resolve().then(() => setMatches([]));
      return () => {
        if (searchDebounce.current) clearTimeout(searchDebounce.current);
      };
    }
    const controller = new AbortController();
    searchDebounce.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/profiles/search?q=${encodeURIComponent(clean)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!response.ok) {
            discardBody(response);
            setMatches([]);
            return;
          }
          const body = (await response.json()) as { matches?: Match[] };
          setMatches(Array.isArray(body.matches) ? body.matches : []);
        } catch {
          setMatches([]);
        }
      })();
    }, 220);
    return () => {
      controller.abort();
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [query]);

  const write = useCallback(
    async (
      path: string,
      init: { method: string; body?: string; prefix: string },
    ): Promise<Record<string, unknown> | null> => {
      const response = await authedActionFetch(path, {
        method: init.method,
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crewIdempotencyKey(init.prefix),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
      const body = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok) {
        throw new Error(errorMessageFrom(body, "That did not go through."));
      }
      return body;
    },
    [],
  );

  const run = useCallback(
    async (task: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setProblem(null);
      try {
        await task();
      } catch (error) {
        setProblem({
          identityKey,
          text: error instanceof Error ? error.message : "That did not go through.",
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, identityKey],
  );

  const decideInvitation = (action: "accept" | "decline") =>
    run(async () => {
      if (!invitationId) return;
      await write(
        `/api/social/crews/${encodeURIComponent(crewId)}/invitations/${encodeURIComponent(invitationId)}`,
        { method: "PATCH", body: JSON.stringify({ action }), prefix: "crew-invite-decide" },
      );
      if (action === "decline") {
        router.push("/social");
        return;
      }
      setNotice({
        identityKey,
        text: "You are in. Your lot grew by everybody already on this night.",
      });
      setAttempt((value) => value + 1);
    });

  const invite = (targetProfileId: string, handle: string) =>
    run(async () => {
      const body = await write(
        `/api/social/crews/${encodeURIComponent(crewId)}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ targetProfileId }),
          prefix: "crew-invite",
        },
      );
      const outcome = parseCrewMutation(body);
      if (!outcome?.invitationId) throw new Error("Could not invite them.");
      setInviteLink(
        crewInviteUrl(
          crewId,
          outcome.invitationId,
          typeof window === "undefined" ? undefined : window.location.origin,
        ),
      );
      setNotice({ identityKey, text: `Invited @${handle}.` });
      setQuery("");
      setMatches([]);
    });

  const inviteHandle = (handle: string) =>
    run(async () => {
      const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { profile?: { id?: string } | null }
        | null;
      const profileId = body?.profile?.id;
      if (typeof profileId !== "string") throw new Error("Could not find that mate.");
      await invite(profileId, handle);
    });

  const leave = () =>
    run(async () => {
      await write(`/api/social/crews/${encodeURIComponent(crewId)}/leave`, {
        method: "POST",
        body: "{}",
        prefix: "crew-leave",
      });
      router.push("/social");
    });

  const changeJoinRequest = (action: "request" | "cancel") =>
    run(async () => {
      await write(`/api/social/crews/${encodeURIComponent(crewId)}/join-requests`, {
        method: action === "request" ? "POST" : "DELETE",
        body: "{}",
        prefix: "crew-join",
      });
      setAttempt((value) => value + 1);
    });

  const decideJoinRequest = (
    request: SocialCrewJoinRequestDTO,
    decision: "accept" | "decline",
  ) =>
    run(async () => {
      try {
        await write(
          `/api/social/crews/${encodeURIComponent(crewId)}/join-requests/${encodeURIComponent(request.requestId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ decision }),
            prefix: "crew-join-decide",
          },
        );
      } catch (error) {
        setFocusJoinRequests(true);
        setJoinRequestAttempt((value) => value + 1);
        throw error;
      }
      setJoinRequests((current) =>
        current.filter((item) => item.requestId !== request.requestId),
      );
      setNotice({
        identityKey,
        text:
          decision === "accept"
            ? `${displayHandle(request.requesterHandle)} joined the crew.`
            : `Declined ${displayHandle(request.requesterHandle)}.`,
      });
      setFocusJoinRequests(true);
      setJoinRequestAttempt((value) => value + 1);
      if (decision === "accept") setAttempt((value) => value + 1);
    });

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setProblem({ identityKey, text: "Could not copy the link." });
    }
  };

  const body = (() => {
    if (!identityResolved || loadedIdentityKey !== identityKey) {
      return (
        <div className="crews__skeletons" aria-label="Loading crew">
          <span />
          <span />
        </div>
      );
    }
    if (status === "loading") {
      return (
        <div className="crews__skeletons" aria-hidden="true">
          <span />
          <span />
        </div>
      );
    }
    if (status === "missing") {
      return (
        <section className="crews__notice" role="status">
          <h1>This crew is not open to you.</h1>
          <p className="crews__muted">
            A crew is visible to the people on the night and to mates of the
            host. Ask them for a link.
          </p>
          <Link className="crews__button" href="/social">
            Back to Social
          </Link>
        </section>
      );
    }
    if (status === "error" || !crew) {
      return (
        <section className="crews__notice" role="alert">
          <h1>Could not load this crew.</h1>
          <button
            type="button"
            className="crews__button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      );
    }

    const starts = crewStartsCaption(crew.startsAt);

    if (crew.kind === "preview") {
      return (
        <>
          <header className="crewPage__head">
            <h1>{crew.title}</h1>
            <p className="crewPage__meta">
              <span>{CREW_PHASE_LABEL[crew.phase]}</span>
              {crew.nightArea ? <span>{crew.nightArea}</span> : null}
              {starts ? <time dateTime={crew.startsAt}>{starts}</time> : null}
            </p>
          </header>
          {invitationId ? (
            <section className="crews__notice">
              <p>You were invited to this night.</p>
              <div className="crews__formActions">
                <button
                  type="button"
                  className="crews__button crews__button--primary"
                  disabled={busy}
                  onClick={() => void decideInvitation("accept")}
                >
                  {busy ? "Working…" : "Join the crew"}
                </button>
                <button
                  type="button"
                  className="crews__button"
                  disabled={busy}
                  onClick={() => void decideInvitation("decline")}
                >
                  No thanks
                </button>
              </div>
            </section>
          ) : crew.joinRequestState === "pending" ? (
            <section className="crews__notice" role="status">
              <p>You have asked to join. The host decides.</p>
              <button
                type="button"
                className="crews__button"
                disabled={busy}
                onClick={() => void changeJoinRequest("cancel")}
              >
                Take it back
              </button>
            </section>
          ) : crew.joinRequestState === "declined" ? (
            <p className="crews__muted" role="status">
              The host said no to this one.
            </p>
          ) : (
            <section className="crews__notice">
              <button
                type="button"
                className="crews__button crews__button--primary"
                disabled={busy}
                onClick={() => void changeJoinRequest("request")}
              >
                Ask to join
              </button>
            </section>
          )}
        </>
      );
    }

    const manages = canManageCrew(crew.viewer.role);
    const managesOpenCrew = manages && crew.visibility === "open";
    return (
      <>
        <header className="crewPage__head">
          <h1>{crew.title}</h1>
          <p className="crewPage__meta">
            <span>{CREW_PHASE_LABEL[crew.phase]}</span>
            <span>{CREW_ROLE_LABEL[crew.viewer.role]}</span>
            {crew.nightArea ? <span>{crew.nightArea}</span> : null}
            {starts ? <time dateTime={crew.startsAt}>{starts}</time> : null}
            <span>{CREW_VISIBILITY_LABEL[crew.visibility]}</span>
          </p>
        </header>

        <section aria-labelledby="crew-members-title">
          <h2 id="crew-members-title" className="crews__title">
            Who is in
          </h2>
          <ul className="crews__members">
            {crew.members.map((member) => (
              <li key={member.memberId} className="crews__member">
                <Link
                  className="crews__memberHandle"
                  href={`/u/${encodeURIComponent(member.handle)}`}
                >
                  {displayHandle(member.handle)}
                </Link>
                <span className="crews__memberRole">
                  {member.role === "owner"
                    ? "Host"
                    : member.role === "cohost"
                      ? "Co-host"
                      : "In"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {managesOpenCrew ? (
          joinRequestStatus === "ready" ? (
            <section aria-labelledby="crew-join-requests-title">
              <h2
                id="crew-join-requests-title"
                className="crews__title"
                ref={joinRequestHeading}
                tabIndex={-1}
              >
                Requests to join
              </h2>
              {joinRequests.length > 0 ? (
                <ul className="crews__list">
                  {joinRequests.map((request) => (
                    <li key={request.requestId} className="crews__member">
                      <Link
                        className="crews__memberHandle"
                        href={`/u/${encodeURIComponent(request.requesterHandle)}`}
                      >
                        {displayHandle(request.requesterHandle)}
                      </Link>
                      <div className="crews__formActions">
                        <button
                          type="button"
                          className="crews__button crews__button--primary"
                          disabled={busy}
                          aria-label={`Accept ${displayHandle(request.requesterHandle)}`}
                          onClick={() => void decideJoinRequest(request, "accept")}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="crews__button"
                          disabled={busy}
                          aria-label={`Decline ${displayHandle(request.requesterHandle)}`}
                          onClick={() => void decideJoinRequest(request, "decline")}
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="crews__muted">No one has asked to join.</p>
              )}
              {joinRequestsHaveMore ? (
                <p className="crews__note">More requests are waiting.</p>
              ) : null}
            </section>
          ) : joinRequestStatus === "loading" ? (
            <section aria-labelledby="crew-join-requests-loading">
              <h2 id="crew-join-requests-loading" className="crews__title">
                Requests to join
              </h2>
              <div className="crews__skeletons" aria-label="Loading join requests">
                <span />
              </div>
            </section>
          ) : joinRequestStatus === "error" ? (
            <section
              className="crews__notice"
              aria-labelledby="crew-join-requests-error"
              role="alert"
            >
              <h2 id="crew-join-requests-error" className="crews__title">
                Could not load join requests.
              </h2>
              <button
                type="button"
                className="crews__button"
                onClick={() => setJoinRequestAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </section>
          ) : null
        ) : null}

        {manages ? (
          <section aria-labelledby="crew-invite-title">
            <h2 id="crew-invite-title" className="crews__title">
              Bring your lot
            </h2>
            <p className="crews__note">{CREW_MUTUALS_ONLY_NOTE}</p>

            {lot.length > 0 ? (
              <ul className="crews__list">
                {lot
                  .filter(
                    (handle) =>
                      !crew.members.some((member) => member.handle === handle),
                  )
                  .slice(0, 8)
                  .map((handle) => (
                    <li key={handle} className="crews__member">
                      <span className="crews__memberHandle">
                        {displayHandle(handle)}
                      </span>
                      <button
                        type="button"
                        className="crews__button"
                        disabled={busy}
                        onClick={() => void inviteHandle(handle)}
                      >
                        Invite
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}

            <label className="crews__field">
              <span>Search a handle</span>
              <input
                type="search"
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                value={query}
                placeholder="Handle"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {matches.length > 0 ? (
              <ul className="crews__list">
                {matches
                  .filter((match) => normalizeHandle(match.handle) !== viewerHandle)
                  .map((match) => (
                    <li key={match.id} className="crews__member">
                      <span className="crews__memberHandle">
                        {displayHandle(match.handle)}
                      </span>
                      <button
                        type="button"
                        className="crews__button"
                        disabled={busy}
                        onClick={() => void invite(match.id, match.handle)}
                      >
                        Invite
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}

            {inviteLink ? (
              <div className="crews__startBlock">
                <p className="crews__note">{CREW_INVITE_LINK_NOTE}</p>
                <code className="crews__inviteUrl">{inviteLink}</code>
                <button
                  type="button"
                  className="crews__button"
                  onClick={() => void copyInvite()}
                >
                  {copied ? "Copied" : "Copy the link"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="crew-leave-title">
          <h2 id="crew-leave-title" className="crews__title">
            Leaving
          </h2>
          {canLeaveCrew(crew.viewer.role) ? (
            <button
              type="button"
              className="crews__button crews__button--danger"
              disabled={busy}
              onClick={() => void leave()}
            >
              {busy ? "Working…" : "Leave this crew"}
            </button>
          ) : (
            <p className="crews__muted">{CREW_OWNER_LEAVE_NOTE}</p>
          )}
        </section>
      </>
    );
  })();

  return (
    <>
      <SiteNav active="social" />
      <main className="crewPage" id="main-content">
        <Link className="crewPage__back" href="/social">
          Back to Social
        </Link>
        {identityResolved &&
        status === "ready" &&
        loadedIdentityKey === identityKey &&
        notice?.identityKey === identityKey ? (
          <p className="crews__note" role="status" aria-live="polite">
            {notice.text}
          </p>
        ) : null}
        {identityResolved &&
        status === "ready" &&
        loadedIdentityKey === identityKey &&
        problem?.identityKey === identityKey ? (
          <p className="crews__problem" role="alert">
            {problem.text}
          </p>
        ) : null}
        {body}
      </main>
    </>
  );
}
