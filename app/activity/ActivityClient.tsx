"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerSession } from "@/components/auth/useViewerSession";
import SignInButton from "@/components/auth/SignInButton";
import SiteNav from "@/components/nav/SiteNav";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import { authedActionFetch } from "@/lib/authedFetch";
import type { NotificationDTO, NotificationKind } from "@/lib/notifications";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { relativeTime } from "@/lib/relativeTime";
import { socialBoundaryCopy } from "@/lib/socialLaunch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

import "./activity.css";

// The kind filters offered in the desktop rail, in a stable order. Labels are
// nouns for the event class (the list rows carry the verb copy). Kept in lockstep
// with NotificationKind; a filter only renders when the loaded feed has that kind.
const KIND_FILTERS: ReadonlyArray<{ kind: NotificationKind; label: string }> = [
  { kind: "follow", label: "Follows" },
  { kind: "reaction", label: "Cheers" },
  { kind: "comment", label: "Comments" },
  { kind: "crawl_save", label: "Saves" },
];

// A grounded one-liner per kind. Keeps the vocabulary in lockstep with the four
// notification kinds; an unknown kind (shouldn't happen — the store validates)
// falls back to a neutral verb.
function verb(kind: NotificationKind): string {
  switch (kind) {
    case "follow":
      return "started following you";
    case "reaction":
      return "reacted to your Pint Drop";
    case "comment":
      return "commented on your Pint Drop";
    case "crawl_save":
      return "saved your crawl";
    default:
      return "did something";
  }
}

// The subject link for a notification, or null when there's nothing to link to.
// follow → the actor's profile; reaction/comment → the drop on the map; crawl_save
// → the crawl story permalink.
function subjectHref(n: NotificationDTO): string | null {
  switch (n.kind) {
    case "follow":
      return `/u/${encodeURIComponent(n.actorHandle)}`;
    case "reaction":
    case "comment":
      return n.subjectRef ? `/map?drop=${encodeURIComponent(n.subjectRef)}` : null;
    case "crawl_save":
      return n.subjectRef ? `/crawls/${encodeURIComponent(n.subjectRef)}` : null;
    default:
      return null;
  }
}

export default function ActivityClient(): React.JSX.Element {
  const { accountRevision, handle: authHandle, identityResolved } = useAuth();
  const viewerSession = useViewerSession();
  const identityReadyForSurface = identityResolved && !viewerSession.unresolved;
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [handle, setHandle] = useState("");
  const [handleReady, setHandleReady] = useState(false);
  const [items, setItems] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Desktop-only kind filter. Defaults to "all", and the control that changes it
  // is CSS-hidden below 1024px, so the mobile render is always the full list —
  // unchanged from before this rail existed.
  const [kindFilter, setKindFilter] = useState<NotificationKind | "all">("all");
  const requestControllerRef = useRef<AbortController | null>(null);
  const accountRevisionRef = useRef(accountRevision);
  const [itemsRevision, setItemsRevision] = useState(accountRevision);

  useEffect(() => {
    accountRevisionRef.current = accountRevision;
  }, [accountRevision]);

  useEffect(() => {
    requestControllerRef.current?.abort();
    if (!socialFriendsLaunchEnabled) {
      void Promise.resolve().then(() => {
        setHandle("");
        setHandleReady(true);
        setItemsRevision(accountRevision);
        setItems([]);
        setFailed(false);
        setLoading(false);
      });
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setHandle(
        identityReadyForSurface && viewerSession.signedIn
          ? normalizeHandle(authHandle ?? "")
          : "",
      );
      setHandleReady(identityReadyForSurface);
      setItemsRevision(accountRevision);
      setItems([]);
      setFailed(false);
    });
    return () => {
      active = false;
    };
  }, [
    accountRevision,
    authHandle,
    identityReadyForSurface,
    socialFriendsLaunchEnabled,
    viewerSession.signedIn,
  ]);

  const load = useCallback(async () => {
    if (!socialFriendsLaunchEnabled) {
      setLoading(false);
      return;
    }
    if (!handleReady) return;
    const h =
      identityReadyForSurface && viewerSession.signedIn
        ? normalizeHandle(authHandle ?? "")
        : "";
    if (!h) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    const requestRevision = accountRevision;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    try {
      const res = await authedActionFetch(`/api/notifications?handle=${encodeURIComponent(h)}`, {
        signal: controller.signal,
      });
      if (accountRevisionRef.current !== requestRevision) return;
      if (!res.ok) {
        discardBody(res);
        setFailed(true);
        return;
      }
      const body = (await res.json()) as { notifications?: NotificationDTO[] };
      if (accountRevisionRef.current !== requestRevision) return;
      setItems(Array.isArray(body.notifications) ? body.notifications : []);
      void authedActionFetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: h }),
        signal: controller.signal,
      }).catch(() => {});
    } catch {
      if (controller.signal.aborted || accountRevisionRef.current !== requestRevision) return;
      setFailed(true);
    } finally {
      if (accountRevisionRef.current === requestRevision) setLoading(false);
    }
  }, [
    accountRevision,
    handleReady,
    authHandle,
    identityReadyForSurface,
    socialFriendsLaunchEnabled,
    viewerSession.signedIn,
  ]);

  useEffect(() => {
    // Defer through a promise callback so setState (inside load) never runs
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => load());
  }, [load]);

  // Per-kind tallies drive which filters render and the rail summary; both are
  // derived from the already-loaded feed (no extra fetch). The visible list is
  // the full feed unless a desktop filter narrows it.
  const accountItems = itemsRevision === accountRevision ? items : [];
  const kindCounts = accountItems.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  const unreadCount = accountItems.reduce((n, item) => (item.read ? n : n + 1), 0);
  const visibleItems =
    kindFilter === "all" ? accountItems : accountItems.filter((n) => n.kind === kindFilter);
  const visibleHandle = itemsRevision === accountRevision ? handle : "";

  return (
    // The nav lives OUTSIDE the 640px-capped <main id="main"> (same shape as the other
    // pages' full-width shells) — nesting it inside the narrow column wrapped
    // the link row into three overlapping lines on desktop.
    <div className="activityShell">
      <SiteNav />

      <main id="main" className="activity">
        <header className="activityHead">
          <h1>Activity</h1>
          <p className="activitySub">Who followed you, cheered a pint, left a comment, or saved your crawl.</p>
          {/* Quest chips (IDEAS B2-lite): "next badge" progress for the claimed
              handle. Renders nothing without a handle, so the signed-out empty
              state below stays exactly as it is. */}
          {handleReady && visibleHandle.trim() ? <NextBadgeChips handle={visibleHandle} /> : null}
        </header>

        {!socialFriendsLaunchEnabled ? (
          <EmptyState
            eyebrow="Activity"
            title="Social preview"
            body={socialBoundaryCopy("preview", false)}
          />
        ) : viewerSession.unresolved || !handleReady || loading ? (
          // Skeleton mirrors the ready-state grid so first paint already carries
          // the page's shape — a plain list on phones, rail + two-up timeline at
          // ≥1024 — instead of a jump from one line of text. Same block idiom as
          // the feed; the shimmer is gated behind prefers-reduced-motion in CSS.
          <div className="activityGrid activitySkeleton" role="status" aria-label="Loading your activity">
            <aside className="activityRail" aria-hidden="true">
              <div className="activityFilters">
                {Array.from({ length: 4 }).map((_, i) => (
                  <span key={i} className="activitySkelChip" />
                ))}
              </div>
              <div className="activitySkelSummary">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} className="activitySkelLine activitySkelLineShort" />
                ))}
              </div>
            </aside>
            <ul className="activityList" aria-hidden="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="activityItem activitySkelItem">
                  <span className="activitySkelLine" />
                  <span className="activitySkelLine activitySkelLineShort" />
                </li>
              ))}
            </ul>
          </div>
        ) : !visibleHandle.trim() ? (
          <EmptyState
            eyebrow="Activity"
            title="This corner is yours. Claim it."
            body="Sign in and choose a handle to see follows, cheers, comments and crawl saves here."
            action={<SignInButton />}
          />
        ) : failed ? (
          <EmptyState
            title="Couldn't load your activity."
            body="Couldn't load your activity. Try again."
            role="alert"
          />
        ) : items.length === 0 ? (
          <EmptyState
            eyebrow="Activity"
            title="Nothing's landed yet."
            body="When someone follows you, cheers a Pint Drop, leaves a comment or saves one of your crawls, it turns up here. Go give them a reason to."
            action={
              <Link href="/social" className="activityCta">
                Open Social
              </Link>
            }
          />
        ) : (
          <div className="activityGrid">
            {/* Desktop rail: kind filters + a quick tally. Hidden below 1024px,
                so the phone layout stays the single list it always was. */}
            <aside className="activityRail" aria-label="Filter activity">
              <div className="activityFilters" role="group" aria-label="Filter by kind">
                <button
                  type="button"
                  className="activityFilter"
                  aria-pressed={kindFilter === "all"}
                  onClick={() => setKindFilter("all")}
                >
                  All
                </button>
                {KIND_FILTERS.filter((f) => (kindCounts[f.kind] ?? 0) > 0).map((f) => (
                  <button
                    key={f.kind}
                    type="button"
                    className="activityFilter"
                    aria-pressed={kindFilter === f.kind}
                    onClick={() => setKindFilter(f.kind)}
                  >
                    {f.label} ({kindCounts[f.kind]})
                  </button>
                ))}
              </div>
              <dl className="activitySummary">
                <div className="activitySummaryRow">
                  <dt>Total</dt>
                  <dd>{items.length}</dd>
                </div>
                <div className="activitySummaryRow">
                  <dt>Unread</dt>
                  <dd>{unreadCount}</dd>
                </div>
              </dl>
            </aside>

            <ul className="activityList">
              {visibleItems.map((n) => {
                const href = subjectHref(n);
                return (
                  <li key={n.id} className={n.read ? "activityItem" : "activityItem isUnread"}>
                    <Link href={`/u/${encodeURIComponent(n.actorHandle)}`} className="activityActor">
                      @{n.actorHandle}
                    </Link>{" "}
                    <span className="activityVerb">{verb(n.kind)}</span>
                    {n.subjectLabel ? (
                      <span className="activitySubject">: {n.subjectLabel}</span>
                    ) : null}
                    <span className="activityTime"> · {relativeTime(n.createdAt)}</span>
                    {href ? (
                      <Link href={href} className="activityLink">
                        View
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
