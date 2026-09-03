"use client";

// Start with your lot: bundles of real accounts a new drinker can follow in
// one tap, so the feed and the directory have people in them on night one.
//
// The surface is OFFERED, never insisted on. It shows only while the viewer
// follows fewer than `STARTER_PACK_FOLLOW_FLOOR` accounts, and that decision is
// TRI-STATE: `viewerFollowing` comes back null when nobody asked or the read
// could not answer, and `viewerNeedsStarterPacks` renders nothing for null
// rather than pushing packs at somebody who already has a lot.
//
// It stays on screen after a follow-all, because it is the thing reporting what
// the tap did. Hiding it the moment the count crossed the floor would eat the
// answer.
//
// Every pack card prints the pack's own title, up to five faces, the member
// count and one button. The pack's one-line description is not a subtitle: it
// is the accessible description of a button that follows a dozen people at
// once, so somebody using a screen reader knows what they are agreeing to.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";
import { discardBody } from "@/lib/responseBody";
import {
  STARTER_PACK_FOLLOW_LABEL,
  STARTER_PACK_FOLLOW_WORKING_LABEL,
  STARTER_PACK_PREVIEW_FACES,
  STARTER_PACKS_TITLE,
  starterPackFollowAccessibleLabel,
  starterPackMemberCountLabel,
  starterPacksSurfaceVisible,
  starterPacksVisibleToStranger,
  type StarterPack,
  type StarterPackFollowOutcome,
  type StarterPackMember,
} from "@/lib/starterPacks";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

import "./starterPacks.css";

type PackView = StarterPack & {
  members: StarterPackMember[];
  memberCount: number;
};

type PackState = {
  status: "idle" | "working" | "done" | "error";
  results?: { handle: string; outcome: StarterPackFollowOutcome }[];
  summary?: string;
  problem?: string;
};

function avatarInitial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

/**
 * The state a member is IN after the tap, which is what a reader wants to know,
 * plus whether that state is a problem. A member the write REFUSED is neither a
 * follow that happened nor a fault the drinker can retry, so it says so.
 */
export function starterPackOutcomeChip(outcome: StarterPackFollowOutcome): {
  label: string;
  problem: boolean;
} {
  if (outcome === "self") return { label: "You", problem: false };
  if (outcome === "failed") return { label: "Didn't go through", problem: true };
  if (outcome === "unavailable") return { label: "No longer here", problem: true };
  return { label: "Following", problem: false };
}

export default function StarterPacks({
  compact = false,
  readOnly = false,
}: {
  compact?: boolean;
  /**
   * Show the packs to somebody with no account: who is already here, and
   * nothing offered. Following is an account action, so a card carrying a
   * button that would answer 401 would be a second sign-in door beside the one
   * such a reader is already looking at.
   */
  readOnly?: boolean;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const { accountRevision, user } = useAuth();
  const viewerHandle = useViewerHandle();
  const viewer = user ? viewerHandle : null;
  const [packs, setPacks] = useState<PackView[]>([]);
  const [viewerFollowing, setViewerFollowing] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [packState, setPackState] = useState<Record<string, PackState>>({});
  const [viewerStateKey, setViewerStateKey] = useState("");
  const accountRevisionRef = useRef(accountRevision);
  const viewerKey = `${accountRevision}:${viewer ?? ""}`;

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setViewerStateKey(viewerKey);
      setPacks([]);
      setViewerFollowing(null);
      setLoaded(false);
      setPackState({});
    });
  }, [viewerKey]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    if (!viewer && !readOnly) return;
    let live = true;
    const requestRevision = accountRevision;
    void (async () => {
      try {
        // The pack list itself is public; `viewer` only drops the members that
        // viewer already follows, so a stranger asks for it without one.
        const response = await authedActionFetch(
          viewer
            ? `/api/starter-packs?viewer=${encodeURIComponent(viewer)}`
            : "/api/starter-packs",
          { cache: "no-store" },
        );
        if (!response.ok) {
          discardBody(response);
          if (live) setLoaded(true);
          return;
        }
        const body = (await response.json()) as {
          packs?: PackView[];
          viewerFollowing?: number | null;
        };
        if (!live || accountRevisionRef.current !== requestRevision) return;
        setPacks(Array.isArray(body.packs) ? body.packs : []);
        setViewerFollowing(
          typeof body.viewerFollowing === "number" ? body.viewerFollowing : null,
        );
        setLoaded(true);
      } catch {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [accountRevision, readOnly, socialFriendsLaunchEnabled, viewer]);

  async function followAll(pack: PackView) {
    if (!socialFriendsLaunchEnabled || !viewer) return;
    setPackState((current) => ({ ...current, [pack.slug]: { status: "working" } }));
    const requestRevision = accountRevision;
    try {
        const response = await authedActionFetch(
        `/api/starter-packs/${encodeURIComponent(pack.slug)}/follow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ follower: viewer }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | {
            results?: { handle: string; outcome: StarterPackFollowOutcome }[];
            summary?: string;
            error?: string;
          }
        | null;
      if (!response.ok || !Array.isArray(body?.results)) {
        throw new Error(errorMessageFrom(body, "That didn't go through. Try again."));
      }
      if (accountRevisionRef.current !== requestRevision) return;
      setPackState((current) => ({
        ...current,
        [pack.slug]: {
          status: "done",
          results: body.results,
          ...(body.summary ? { summary: body.summary } : {}),
        },
      }));
    } catch (error) {
      if (accountRevisionRef.current !== requestRevision) return;
      setPackState((current) => ({
        ...current,
        [pack.slug]: {
          status: "error",
          problem:
            error instanceof Error
              ? error.message
              : "That didn't go through. Try again.",
        },
      }));
    }
  }

  // Both render decisions live in the policy module. The signed-in surface
  // asks `starterPacksSurfaceVisible` whether this viewer still needs packs;
  // read-only stranger cards ask `starterPacksVisibleToStranger` only whether
  // public packs exist. Neither rule is restated here.
  const settledLoaded = viewerStateKey === viewerKey && loaded;
  const settledPackCount = viewerStateKey === viewerKey ? packs.length : 0;
  const visible = readOnly
    ? starterPacksVisibleToStranger({
        loaded: settledLoaded,
        packCount: settledPackCount,
      })
    : starterPacksSurfaceVisible({
        viewer,
        loaded: settledLoaded,
        packCount: settledPackCount,
        viewerFollowing: viewerStateKey === viewerKey ? viewerFollowing : null,
        followedAny:
          viewerStateKey === viewerKey &&
          Object.values(packState).some((state) => state.status === "done"),
      });
  if (!socialFriendsLaunchEnabled || !visible) return null;

  return (
    <section
      className={compact ? "starterPacks starterPacks--compact" : "starterPacks"}
      aria-labelledby="starter-packs-title"
    >
      <h2 id="starter-packs-title" className="starterPacks__title">
        {STARTER_PACKS_TITLE}
      </h2>

      <ul className="starterPacks__grid">
        {packs.map((pack) => {
          const state = packState[pack.slug] ?? { status: "idle" };
          const descriptionId = `starter-pack-desc-${pack.slug}`;
          const faces = pack.members.slice(0, STARTER_PACK_PREVIEW_FACES);
          return (
            <li key={pack.slug} className="starterPacks__card">
              <h3 className="starterPacks__packTitle">{pack.title}</h3>
              <p id={descriptionId} className="srOnly">
                {pack.description}
              </p>

              <ul className="starterPacks__faces" aria-hidden="true">
                {faces.map((member) => (
                  <li key={member.handle} className="starterPacks__face">
                    {member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={member.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      avatarInitial(member.handle)
                    )}
                  </li>
                ))}
              </ul>

              <p className="starterPacks__count">
                {starterPackMemberCountLabel(pack.memberCount)}
              </p>

              {readOnly ? null : (
                <button
                  type="button"
                  className="starterPacks__follow"
                  aria-label={starterPackFollowAccessibleLabel(pack)}
                  aria-describedby={descriptionId}
                  disabled={state.status === "working" || state.status === "done"}
                  onClick={() => void followAll(pack)}
                >
                  {state.status === "working"
                    ? STARTER_PACK_FOLLOW_WORKING_LABEL
                    : state.status === "done"
                      ? "Followed"
                      : STARTER_PACK_FOLLOW_LABEL}
                </button>
              )}

              {state.status === "done" && state.summary ? (
                <p className="starterPacks__summary" role="status">
                  {state.summary}
                </p>
              ) : null}

              {state.status === "done" && state.results ? (
                <ul className="starterPacks__results">
                  {state.results.map((result) => (
                    <li key={result.handle} className="starterPacks__result">
                      <Link href={`/u/${encodeURIComponent(result.handle)}`}>
                        {displayHandle(result.handle)}
                      </Link>
                      <span
                        className={
                          starterPackOutcomeChip(result.outcome).problem
                            ? "starterPacks__outcome starterPacks__outcome--problem"
                            : "starterPacks__outcome"
                        }
                      >
                        {starterPackOutcomeChip(result.outcome).label}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {state.status === "error" ? (
                <p className="starterPacks__problem" role="alert">
                  {state.problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
