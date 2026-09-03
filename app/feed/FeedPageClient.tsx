"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import FeedCard from "@/components/feed/FeedCard";
import FeedFilters from "@/components/feed/FeedFilters";
import FeedSightings from "@/components/feed/FeedSightings";
import PresenceStrip from "@/components/feed/PresenceStrip";
import SocialTabs, { type SocialTab } from "@/components/feed/SocialTabs";
import SiteNav from "@/components/nav/SiteNav";
import TonightConditionsStrip from "@/app/tonight/TonightConditionsStrip";
import EmptyState from "@/components/EmptyState";
import { discardBody } from "@/lib/responseBody";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { getAnonId } from "@/lib/anonId";
import type { CheckIn } from "@/lib/checkIn";
import {
  applyFeedFilter,
  normalizeCheckIn,
  normalizePintDrop,
  paginate,
  type FeedFilter,
  type FeedItem,
  type PintDropDTO,
} from "@/lib/feed";
import { sightingPlacement, type SightingDTO } from "@/lib/feedSightings";
import {
  OPTIMISTIC_SPILL_EVENT,
  buildOptimisticSpillRetryFormData,
  emitOptimisticSpillChange,
  failOptimisticSpill,
  markOptimisticSpillRetrying,
  readOptimisticSpills,
  reconcileOptimisticSpill,
  writeOptimisticSpills,
} from "@/lib/optimisticSpillPost";
import { postReactionToggle } from "@/lib/optimisticToggle";
import { followListHandleSet } from "@/lib/followList";
import { normalizeHandle } from "@/lib/profiles";
import {
  loadReactionSummaries,
  localReactionSummary,
  toggleReactionMine,
  writeLocalReactions,
  type ReactionSummaryMap,
} from "@/lib/reactionClient";
import { currentMode, MODE_DEFAULT_LANE } from "@/lib/viewMode";
import { countSpillingNow, subscribeToNewDrops } from "@/lib/realtime";
import { type ReactionKey, type ReactionSummary } from "@/lib/reactions";
import { venueMapUrl } from "@/lib/venueMapUrl";
import "./feed.css";
import { authedActionFetch } from "@/lib/authedFetch";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

const PAGE_SIZE = 12;

type LoadState = "loading" | "ready" | "error";

// A per-drop reaction summary map (counts + which the viewer used), keyed by
// drop id. Missing keys render as "no reactions yet" — the card treats absence
// and an empty summary identically.
const EMPTY_SUMMARY: ReactionSummary = { counts: {}, mine: [] };

function mergeLocalOptimisticItems(current: FeedItem[]): FeedItem[] {
  if (typeof window === "undefined") return current;
  const localItems = readOptimisticSpills(window.localStorage).map((entry) =>
    normalizePintDrop(entry.drop),
  );
  if (localItems.length === 0) return current.filter((item) => !item.id.startsWith("optimistic-"));
  const localIds = new Set(localItems.map((item) => item.id));
  const localClientIds = new Set(
    localItems
      .map((item) => item.optimistic?.clientRequestId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  return [
    ...localItems,
    ...current.filter(
      (item) =>
        !localIds.has(item.id) &&
        !(item.optimistic?.clientRequestId && localClientIds.has(item.optimistic.clientRequestId)),
    ),
  ];
}

export default function FeedPageClient({
  // Ambient price sightings (lib/feedSightings.ts), resolved server-side and
  // rendered ONLY on the London tab: as the whole surface when no drinker has
  // logged (replacing the dead empty state honestly), else a compact strip below
  // real user drops. Defaults to [] so the client still stands alone in tests.
  sightings = [],
}: {
  sightings?: SightingDTO[];
} = {}) {
  // Raw normalized items from the API (the full fetched set); filtering and
  // pagination are derived client-side from this. Fetch happens in an effect,
  // but setState only fires inside the async resolution / catch — never in the
  // effect body (react-hooks/set-state-in-effect).
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  // Bump this to retrigger the main feed fetch (used by the error-state retry
  // button). Incrementing the counter re-runs the fetch effect below.
  const [fetchTick, setFetchTick] = useState(0);
  // The active lane. Server-renders the SSR-stable public "latest" lane so a
  // signed-out arrival never lands in a reranked empty state. The mount effect
  // applies the same view-mode default only until the viewer picks a lane.
  const [filter, setFilter] = useState<FeedFilter>("latest");
  const laneTouched = useRef(false);
  // The Social Loop top-level tab (Cycle 15 Lane C). "london" is the SSR-stable
  // default (the existing public feed); "lot" (mutual friends) and "nearby"
  // (area-level) layer their own data source in on top. The chip filters below
  // stay available on the London tab; the tab IS the lane on Your lot / Nearby.
  const [tab, setTab] = useState<SocialTab>("london");
  // The viewer's "lot" — their mutual-follow handles (each side follows the
  // other). null = not yet loaded; drives the Your lot drop filter + empty state.
  const [lotHandles, setLotHandles] = useState<Set<string> | null>(null);
  // Check-in FeedItems merged into the chronological feed for the active tab:
  // friends-only "we're out" posts on Your lot, area-public ones on Nearby.
  const [checkInItems, setCheckInItems] = useState<FeedItem[]>([]);
  // How many pages the user has revealed. "Load more" bumps this; changing the
  // filter resets it to 1. Cursor pagination is still the engine (below) — this
  // counter just says how many cursor-steps to walk from the top.
  const [pagesLoaded, setPagesLoaded] = useState(1);

  // Durable reactions: one summary map for every drop the viewer has seen. The
  // batch-GET fills it for a freshly-revealed page; a toggle reconciles a single
  // entry from the POST response (or from the local fallback for demo seeds).
  const [summaries, setSummaries] = useState<ReactionSummaryMap>({});
  // Drop ids the backend rejected as unknown (demo seeds) — their toggles stay
  // local-only from then on, so we don't re-hit the network for a known 404.
  const localOnly = useRef<Set<string>>(new Set());
  // Which ids we've already asked the summary endpoint for, so revealing another
  // page only requests the newly-visible ids.
  const summarizedIds = useRef<Set<string>>(new Set());
  // The viewer's stable anon id, read once (lazy init, never in an effect).
  const [actorId] = useState<string>(() => getAnonId());

  // The viewer's own handle (localStorage `pubmax_handle`), read after mount so
  // the server render and hydration agree, and the normalized set of handles
  // they follow (fetched once from /api/profiles/<handle>/following). Together
  // they power the Friends lane: null handle or an empty set ⇒ the lane is empty
  // and the page shows a "follow people" prompt. `null` following = not yet
  // loaded (so we don't flash the empty state before the fetch resolves).
  // Wave I1: prefer the signed-in auth handle when present so Friends/For You
  // match the signed-in identity instead of a stale localStorage claim.
  const { handle: authHandle } = useAuth();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [myHandle, setMyHandle] = useState("");
  const [followingHandles, setFollowingHandles] = useState<Set<string> | null>(null);

  // Mobile (<=640px) turns the "Load more" button into IntersectionObserver-driven
  // infinite scroll (PRD §2.5); desktop keeps the explicit button. Read once with a
  // lazy initializer (SSR-safe: no window on the server) and kept in sync via the
  // media query's change event. `false` on the server means the button-only path
  // renders first, then hydration flips it on phones — never a mismatch mid-frame.
  const [isMobile, setIsMobile] = useState(false);
  // The end-of-list sentinel the observer watches. Rendered only when there's more
  // to reveal, so once we hit the bottom the observer has nothing to trip on.
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // ── Live-ness (issue #37) ───────────────────────────────────────────────────
  // New drops that landed since the last view, BUFFERED rather than injected, so
  // a live update never yanks the reader's scroll. A subtle "N new pints" pill
  // reveals them on tap. The realtime subscription is a SIGNAL ONLY: on an event
  // we refetch page-1 through the SAME filtered GET /api/pint-drops (so #29
  // visibility/anonymity re-applies) and diff for genuinely-new visible items.
  const [pendingItems, setPendingItems] = useState<FeedItem[]>([]);
  // Every drop id we've already placed on screen OR buffered — the dedupe set the
  // diff checks against, so a refetch never double-counts. Seeded from the
  // initial load and each reveal.
  const knownIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    // Re-arm the loading state in a microtask so setState never fires
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => setStatus("loading"));
    fetch("/api/pint-drops", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
        const data = (await res.json()) as { drops?: PintDropDTO[] };
        const normalized = Array.isArray(data.drops) ? data.drops.map(normalizePintDrop) : [];
        return mergeLocalOptimisticItems(normalized);
      })
      .then((normalized) => {
        // Seed the live dedupe set with everything we loaded, so the first live
        // refetch only surfaces drops that arrived AFTER this load.
        for (const it of normalized) knownIds.current.add(it.id);
        setItems(normalized);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        // Abort is expected on unmount — not an error surface.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any real failure degrades to the error state (distinct from empty).
        setStatus("error");
      });
    return () => controller.abort();
  }, [fetchTick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyLocal = () => {
      const hasLocal = readOptimisticSpills(window.localStorage).length > 0;
      setItems((current) => {
        const merged = mergeLocalOptimisticItems(current);
        for (const item of merged) knownIds.current.add(item.id);
        return merged;
      });
      if (hasLocal) setStatus((state) => (state === "loading" ? "ready" : state));
    };
    void Promise.resolve().then(applyLocal);
    window.addEventListener(OPTIMISTIC_SPILL_EVENT, applyLocal);
    window.addEventListener("storage", applyLocal);
    return () => {
      window.removeEventListener(OPTIMISTIC_SPILL_EVENT, applyLocal);
      window.removeEventListener("storage", applyLocal);
    };
  }, []);

  // Live subscription (issue #37). A new-drop event is a SIGNAL ONLY — we never
  // read the realtime payload (it carries the raw row, which could leak a
  // hidden/anonymous drop). Instead we refetch page-1 through the same filtered
  // GET /api/pint-drops the initial load uses (so #29 visibility re-applies) and
  // BUFFER any genuinely-new visible items into `pendingItems` (dedup via
  // knownIds), showing a "N new pints" pill rather than jumping the scroll. With
  // no Supabase env the helper drives this same refetch on a 30s poll instead;
  // a dropped channel likewise falls back to polling. Never throws.
  useEffect(() => {
    const refetchAndBuffer = () => {
      const controller = new AbortController();
      fetch("/api/pint-drops", { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { drops?: PintDropDTO[] }) => {
          const fresh = (Array.isArray(data.drops) ? data.drops : [])
            .map(normalizePintDrop)
            .filter((it) => !knownIds.current.has(it.id));
          if (fresh.length === 0) return;
          for (const it of fresh) knownIds.current.add(it.id);
          // Prepend newest-first; the pill count is the buffer length.
          setPendingItems((prev) => [...fresh, ...prev]);
        })
        .catch(() => {
          // Best-effort: a failed live refetch just means no new pill this time.
        });
    };
    // Signal-only + poll fallback are the SAME action here.
    const unsubscribe = subscribeToNewDrops(refetchAndBuffer, { poll: refetchAndBuffer });
    return unsubscribe;
  }, []);

  // Reveal buffered live drops on tap: merge them into `items` (they're already
  // in knownIds) and clear the pill. Prepending keeps them at the top without
  // disturbing the reader's current position until they choose to look.
  const revealPending = useCallback(() => {
    setPendingItems((buffered) => {
      if (buffered.length > 0) setItems((prev) => [...buffered, ...prev]);
      return [];
    });
  }, []);

  // "X spilling right now" (issue #37): a derived count, not a stream — how many
  // PINT DROPS were logged in the last hour, off the SAME already-filtered feed
  // read (so a withheld drop is never counted). Buffered live drops count too
  // (they're genuinely recent). Recomputed when the feed or buffer changes; the
  // now-anchored recency is a snapshot per render (no live ticking).
  const spillingNow = useMemo(
    () =>
      countSpillingNow(
        [...pendingItems, ...items].filter((it) => it.type === "pint_drop"),
      ),
    [items, pendingItems],
  );

  // Read the viewer's own handle after mount (the server can't know
  // localStorage). Prefer the signed-in auth handle when present (Wave I1).
  // Done in an async step, not the synchronous effect body, so it
  // satisfies react-hooks/set-state-in-effect (mirrors the /u/[handle] page).
  useEffect(() => {
    let active = true;
    async function loadHandle() {
      try {
        const fromAuth = normalizeHandle(authHandle ?? "");
        if (fromAuth) {
          if (active) setMyHandle(fromAuth);
          return;
        }
        const handle = normalizeHandle(window.localStorage.getItem("pubmax_handle") ?? "");
        if (active) setMyHandle(handle);
      } catch {
        // Storage disabled → stays anonymous; the Friends lane shows its prompt.
      }
    }
    void loadHandle();
    return () => {
      active = false;
    };
  }, [authHandle]);

  // Fetch the handles the viewer follows once their handle is known. Best-effort
  // and fail-soft: any failure (or no handle) resolves to an empty set, so the
  // Friends lane falls through to its "follow people" state — never a crash.
  // setState only runs inside the async callback (never the effect body).
  useEffect(() => {
    const controller = new AbortController();
    async function loadFollowing() {
      if (!socialFriendsLaunchEnabled) {
        setFollowingHandles(new Set());
        return;
      }
      // No handle (viewer anonymous): settle to a known-empty set so the Friends
      // lane renders its prompt rather than waiting on a fetch that never fires.
      // Done in this async step (not the sync effect body) per react-hooks rules.
      if (!myHandle) {
        setFollowingHandles(new Set());
        return;
      }
      try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(myHandle)}/following`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          discardBody(res);
          throw new Error(String(res.status));
        }
        const data = (await res.json()) as { following?: unknown };
        setFollowingHandles(followListHandleSet(data.following));
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return; // expected on unmount / handle change — not an error to surface
        }
        // Fail-soft: an empty set drives the Friends lane's empty state.
        setFollowingHandles(new Set());
      }
    }
    void loadFollowing();
    return () => controller.abort();
  }, [myHandle, socialFriendsLaunchEnabled]);

  // Social Loop data source (Cycle 15 Lane C). Fetch the tab's extra signal:
  //  • "lot"    → the viewer's mutual-follow handles (/lot) AND their friends-only
  //               check-ins (/check-ins?viewer=…, gated to the lot server-side).
  //  • "nearby" → the area-public check-ins (/check-ins?scope=area). Friends-only
  //               posts never come back on this path (privacy choke, lib/socialFeed).
  //  • "london" → nothing extra; the public drop feed stands alone.
  // Fail-soft: any error resolves to empty so the tab still renders. setState only
  // runs inside the async callback (never the effect body) per react-hooks rules.
  useEffect(() => {
    const controller = new AbortController();
    async function loadSocial() {
      if (!socialFriendsLaunchEnabled) {
        if (tab !== "london") setTab("london");
        setLotHandles(null);
        setCheckInItems([]);
        return;
      }
      if (tab === "london") {
        setLotHandles(null);
        setCheckInItems([]);
        return;
      }
      if (tab === "nearby") {
        setLotHandles(null);
        try {
          const res = await fetch("/api/check-ins?scope=area", { signal: controller.signal });
          const data = (await res.json()) as { checkIns?: CheckIn[] };
          const items = Array.isArray(data.checkIns) ? data.checkIns.map(normalizeCheckIn) : [];
          setCheckInItems(items);
        } catch {
          setCheckInItems([]);
        }
        return;
      }
      // tab === "lot": needs the viewer's handle. Anonymous → empty lot + prompt.
      if (!myHandle) {
        setLotHandles(new Set());
        setCheckInItems([]);
        return;
      }
      try {
        const [lotRes, ciRes] = await Promise.all([
          fetch(`/api/profiles/${encodeURIComponent(myHandle)}/lot`, { signal: controller.signal }),
          fetch(`/api/check-ins?viewer=${encodeURIComponent(myHandle)}`, {
            signal: controller.signal,
          }),
        ]);
        const lotData = (await lotRes.json()) as { lot?: unknown };
        const set = new Set<string>();
        for (const h of Array.isArray(lotData.lot) ? lotData.lot : []) {
          const norm = normalizeHandle(typeof h === "string" ? h : "");
          if (norm) set.add(norm);
        }
        setLotHandles(set);
        const ciData = (await ciRes.json()) as { checkIns?: CheckIn[] };
        setCheckInItems(Array.isArray(ciData.checkIns) ? ciData.checkIns.map(normalizeCheckIn) : []);
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setLotHandles(new Set());
        setCheckInItems([]);
      }
    }
    void loadSocial();
    return () => controller.abort();
  }, [myHandle, socialFriendsLaunchEnabled, tab]);

  // Seed the initial lane by view mode. Both modes start on Latest so a
  // signed-out reader sees the complete public destination on first arrival.
  // Runs once on mount, after the pre-hydration script has set html[data-mode],
  // and only while the viewer hasn't picked a lane themselves. setState fires
  // from an async microtask (never the sync effect body) per
  // react-hooks/set-state-in-effect — mirroring the isMobile effect below. If
  // The SSR-rendered lane already matches both current mode defaults.
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (laneTouched.current) return;
      const lane = MODE_DEFAULT_LANE[currentMode()];
      setFilter((prev) => (laneTouched.current ? prev : lane));
    });
  }, []);

  // Track the "phone" breakpoint via matchMedia so infinite scroll is a mobile-only
  // affordance. setState fires from the change listener / an async microtask (never
  // the synchronous effect body) per react-hooks/set-state-in-effect. Guarded on
  // `window` for SSR; the initial `false` is corrected on mount.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 640px)");
    // Sync the current value off the effect's sync path (microtask), so the first
    // render's `false` is reconciled without a set-state-in-effect violation.
    void Promise.resolve().then(() => setIsMobile(mql.matches));
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // "Load more" is cumulative: walk `paginate` from the top, chaining each
  // step's nextCursor into the next call, for `pagesLoaded` pages. Cursor
  // pagination stays the engine (each step advances by the last item's
  // createdAt|id, never an offset); `nextCursor` being non-null after the last
  // revealed page is what shows the Load-more button.
  // Fold the loaded reaction summaries into a flat id→count map for the For-You
  // ranking (a drop with no loaded summary simply scores no reaction bonus). The
  // ranking's `now` is pinned ONCE per mount (a stable ref) so the For-You order
  // doesn't reshuffle under the viewer on every render/tick — it stays stable
  // for the session, matching the "screenshot-worthy, calm" feed intent.
  const [forYouNow] = useState(() => Date.now());
  const liveReactionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [id, summary] of Object.entries(summaries)) {
      let total = 0;
      for (const n of Object.values(summary.counts)) total += n ?? 0;
      if (total > 0) counts[id] = total;
    }
    return counts;
  }, [summaries]);

  // Scroll stability: the For-You lane ranks by recency×quality where "quality"
  // folds in reaction counts. Those counts stream in per page as the reader
  // scrolls (the batch-GET below), so feeding them LIVE into the sort re-orders
  // the feed *under* the reader every time a page's summaries land — cards jump.
  // Mirror the live pill's "defer reorders until the viewer is back at the top"
  // rule: while the reader is at the top (pagesLoaded === 1, which onFilterChange
  // resets) keep the ranking signal live, but the instant they load past page 1
  // freeze the snapshot so summaries arriving mid-scroll can't reshuffle what
  // they're reading. Only the For-You lane consumes these counts; every other
  // lane sorts purely by createdAt|price, so this is a no-op there.
  const [rankReactionCounts, setRankReactionCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    // Refresh the ranking snapshot ONLY while the reader is at the top; once
    // they've loaded past page 1 it stays frozen so a page's summaries landing
    // mid-scroll can't re-sort the feed under them. setState fires from a
    // microtask (never the sync effect body) per react-hooks/set-state-in-effect.
    if (pagesLoaded !== 1) return;
    void Promise.resolve().then(() => setRankReactionCounts(liveReactionCounts));
  }, [pagesLoaded, liveReactionCounts]);

  const filtered = useMemo(() => {
    // London tab: the existing public feed, chip filters and all.
    if (tab === "london") {
      return applyFeedFilter(items, filter, {
        followingHandles: followingHandles ?? undefined,
        // Wave G4: same follow set as Friends — modest For You boost for
        // followed authors when the set is non-empty (never a hard filter).
        forYou: {
          now: forYouNow,
          reactionCounts: rankReactionCounts,
          followingHandles: followingHandles ?? undefined,
        },
      });
    }
    // Nearby: area-level activity — the area-public check-ins merged with drops,
    // strictly chronological (no ranking). Honestly a broad lane until real geo
    // lands; check-ins carry the only area signal today.
    if (tab === "nearby") {
      return [...checkInItems, ...items].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
    }
    // Your lot: mutual friends' drops (filtered to the lot) merged with the
    // server-gated friends-only check-ins (already scoped to the lot + the viewer
    // in lib/socialFeed), strictly chronological. The check-ins are NOT re-run
    // through the friends filter — that would drop the viewer's own check-ins,
    // which the choke deliberately includes.
    const lotDrops = applyFeedFilter(items, "friends", {
      followingHandles: lotHandles ?? undefined,
    });
    return [...checkInItems, ...lotDrops].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [tab, items, checkInItems, filter, followingHandles, lotHandles, forYouNow, rankReactionCounts]);
  const { visible, nextCursor } = useMemo(() => {
    const acc: FeedItem[] = [];
    let pageCursor: string | null = null;
    for (let p = 0; p < pagesLoaded; p += 1) {
      const step = paginate(filtered, pageCursor, PAGE_SIZE);
      acc.push(...step.items);
      pageCursor = step.nextCursor;
      if (!pageCursor) break; // reached the end before pagesLoaded — stop.
    }
    return { visible: acc, nextCursor: pageCursor };
  }, [filtered, pagesLoaded]);

  // Batch-load reaction summaries for whatever is now on screen. Shared client
  // keeps every request inside the route's 100-id cap and distinguishes a
  // retryable read failure from a confirmed local-only demo drop.
  const visibleIds = useMemo(() => visible.map((i) => i.id), [visible]);
  useEffect(() => {
    const fresh = visibleIds.filter((id) => !summarizedIds.current.has(id));
    if (fresh.length === 0) return;
    // Mark requested up-front so a re-render mid-flight doesn't double-fetch.
    for (const id of fresh) summarizedIds.current.add(id);

    const controller = new AbortController();
    loadReactionSummaries(fresh, actorId, controller.signal)
      .then((result) => {
        if (result.aborted || controller.signal.aborted) return;
        for (const id of result.retryableIds) summarizedIds.current.delete(id);
        setSummaries((prev) => ({ ...prev, ...result.summaries }));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return; // expected on unmount / change — not an error to surface
        }
        // Unexpected client failure stays retryable. Network and response
        // failures are represented by loadReactionSummaries itself.
        for (const id of fresh) summarizedIds.current.delete(id);
      });
    return () => controller.abort();
  }, [visibleIds, actorId]);

  // Mobile infinite scroll (PRD §2.5). Watch the end-of-list sentinel; when it
  // scrolls into view reveal the next page — the same bump the desktop button does.
  // The observer is *created* in this effect, but setPagesLoaded fires from the
  // observer CALLBACK (not the effect body), which satisfies
  // react-hooks/set-state-in-effect. Guards that keep it honest:
  //  - only arms on phones (isMobile) — desktop keeps the explicit button;
  //  - only bumps while there's more to show (nextCursor) and the feed is ready;
  //  - re-bumps only after each new page settles (the effect re-runs on nextCursor
  //    change and reconnects), so one intersection = one page, never a runaway loop;
  //  - disconnects on cleanup and whenever nextCursor becomes null (nothing left).
  useEffect(() => {
    if (!isMobile || !nextCursor || status !== "ready") return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let done = false; // one bump per observer instance — hard stop against double-fire
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!done && entry?.isIntersecting) {
          done = true;
          observer.disconnect();
          setPagesLoaded((n) => n + 1);
        }
      },
      // Prefetch a touch before the sentinel is fully on screen so the next page is
      // ready as the user reaches the bottom, not after a visible pause.
      { rootMargin: "300px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isMobile, nextCursor, status]);

  // Toggle one reaction on a drop. Optimistic: flip `mine` + adjust the count
  // immediately, then reconcile from the server's authoritative summary. A 404
  // (demo seed the backend doesn't know) drops this id into local-only mode and
  // persists the toggle to localStorage — so sample cards react without a crash.
  // U2: returns whether the toggle actually stuck — false means the POST failed
  // (503 store gating, network) and the optimistic flip was rolled back. The
  // CheersButton consumes this to revert its own optimistic overlay and show
  // the claim-a-handle prompt; other callers may ignore it (the chip row does).
  const toggleReaction = useCallback(
    async (dropId: string, reaction: ReactionKey): Promise<boolean> => {
      // Local-only (a known demo seed) — never hit the network again.
      if (localOnly.current.has(dropId)) {
        setSummaries((prev) => {
          const current = prev[dropId] ?? EMPTY_SUMMARY;
          const mine = toggleReactionMine(current.mine, reaction);
          writeLocalReactions(dropId, mine);
          return { ...prev, [dropId]: localReactionSummary(mine) };
        });
        return true;
      }

      // Optimistic flip against the current summary.
      let optimisticMine: ReactionKey[] = [];
      setSummaries((prev) => {
        const current = prev[dropId] ?? EMPTY_SUMMARY;
        const on = current.mine.includes(reaction);
        optimisticMine = toggleReactionMine(current.mine, reaction);
        const counts = { ...current.counts };
        counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
        if (counts[reaction] === 0) delete counts[reaction];
        return { ...prev, [dropId]: { counts, mine: optimisticMine } };
      });

      // The POST lives in lib/optimisticToggle.ts (postReactionToggle) so the
      // failure path is unit-testable; it never throws — it answers with an
      // outcome kind this handler maps onto the existing three branches.
      const outcome = await postReactionToggle({ id: dropId, actor: actorId, reaction });
      if (outcome.kind === "unknown-drop") {
        // Unknown drop (demo seed): keep the optimistic toggle, persist it
        // locally, and mark the id local-only for future toggles.
        localOnly.current.add(dropId);
        writeLocalReactions(dropId, optimisticMine);
        setSummaries((prev) => ({
          ...prev,
          [dropId]: localReactionSummary(optimisticMine),
        }));
        return true;
      }
      if (outcome.kind === "confirmed") {
        // Reconcile from the source of truth (never trust the optimistic copy).
        if (outcome.summary) {
          setSummaries((prev) => ({ ...prev, [dropId]: outcome.summary as ReactionSummary }));
        }
        return true;
      }
      // Network/503 — revert the optimistic flip so counts stay honest; a
      // retry will re-toggle. Report the failure: a rollback that lands on the
      // exact pre-flip values is invisible to CheersButton's prop-diffing, so
      // this boolean is its only honest signal to revert the tick and show the
      // claim-a-handle prompt (U2).
      setSummaries((prev) => {
        const current = prev[dropId] ?? EMPTY_SUMMARY;
        const on = current.mine.includes(reaction);
        const mine = toggleReactionMine(current.mine, reaction);
        const counts = { ...current.counts };
        counts[reaction] = Math.max(0, (counts[reaction] ?? 0) + (on ? -1 : 1));
        if (counts[reaction] === 0) delete counts[reaction];
        return { ...prev, [dropId]: { counts, mine } };
      });
      return false;
    },
    [actorId],
  );

  const retryOptimisticPost = useCallback(async (clientRequestId: string) => {
    if (typeof window === "undefined") return;
    const writeLocalEntries = (entries: ReturnType<typeof readOptimisticSpills>) => {
      writeOptimisticSpills(window.localStorage, entries);
      emitOptimisticSpillChange();
    };
    const stored = readOptimisticSpills(window.localStorage);
    const entry = stored.find((candidate) => candidate.clientRequestId === clientRequestId);
    if (!entry?.retry) {
      writeLocalEntries(
        failOptimisticSpill(
          stored,
          clientRequestId,
          "Retry details are no longer available. Open the map and post it again.",
        ),
      );
      return;
    }

    writeLocalEntries(markOptimisticSpillRetrying(stored, clientRequestId));

    try {
      const body = await buildOptimisticSpillRetryFormData(entry.retry);
      const response = await authedActionFetch("/api/pint-drops", { method: "POST", body });
      const data = (await response.json().catch(() => ({}))) as {
        drop?: PintDropDTO;
        error?: string;
      };
      if (!response.ok || !data.drop) {
        throw new Error(errorMessageFrom(data, "Could not save that Spill."));
      }
      const reconciledDrop: PintDropDTO = {
        ...data.drop,
        venueName: entry.retry.venueName,
        venueMapUrl: venueMapUrl(entry.retry.venueId),
      };
      writeLocalEntries(
        reconcileOptimisticSpill(
          readOptimisticSpills(window.localStorage),
          clientRequestId,
          reconciledDrop,
        ),
      );
      window.localStorage.setItem("pubmax_handle", entry.retry.handle.trim());
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Network or storage error. Try again.";
      writeLocalEntries(
        failOptimisticSpill(readOptimisticSpills(window.localStorage), clientRequestId, message),
      );
    }
  }, []);

  function onFilterChange(next: FeedFilter) {
    // The viewer chose a lane — from here on their choice is sticky and the
    // mode-default seeding above stands down.
    laneTouched.current = true;
    setFilter(next);
    setPagesLoaded(1);
  }

  function onTabChange(next: SocialTab) {
    setTab(next);
    setPagesLoaded(1);
  }

  const isError = status === "error";
  const isEmpty = status === "ready" && filtered.length === 0;

  // The Your lot tab's own empty state: the viewer has no mutual follows AND no
  // check-ins to show. A mutual follow (not a one-way follow) is what fills this
  // tab, so the prompt sends them to add friends at the table.
  const lotEmpty =
    tab === "lot" &&
    status === "ready" &&
    lotHandles !== null &&
    lotHandles.size === 0 &&
    checkInItems.length === 0;

  // Where ambient sightings sit on the London tab (lib/feedSightings.ts):
  //  - "primary" — no user drops, so sightings ARE the surface (they stand in
  //    for the dead empty state, grouped as sourced prices, never as drinkers);
  //  - "strip"   — user drops exist, so sightings collapse to a quiet strip below
  //    the fresh content — real drinkers always lead;
  //  - "none" - other tabs or filters, still loading/errored, or no
  //    sightings.
  // This is a SEPARATE data source + card type from the error/empty states, so it
  // does not touch that branch (coordination with the error-honesty work in
  // this PR's own empty/error rework).
  const sightingSpot = sightingPlacement({
    tab,
    filter,
    status,
    userItemCount: filtered.length,
    sightingCount: sightings.length,
  });

  // Empty / error / lot-empty surfaces own their single next step. Keep the
  // header compose stack off those states so mobile never stacks Capture /
  // Log / We're out / Find a pub as four competing CTAs.
  const showComposeActions = status === "ready" && !isEmpty && !lotEmpty;

  return (
    <main id="main" className="feedShell">
      <SiteNav active="feed" />

      {/* One compact intro line only (spec #395): the title carries the whole
          pre-content header so the feed starts within a single viewport — the
          old eyebrow + lede stack pushed real content below the fold. */}
      <header className="feedHeader">
        <h1 className="feedTitle">Stories</h1>
        {showComposeActions ? (
          <div className="feedComposeActions" aria-label="Create">
            <Link href="/moment" className="feedMomentCta">Share a Moment</Link>
            <Link href="/map?log=1" className="feedDropCta">Log a Pint Drop</Link>
            <Link href="/we-are-out" className="feedMomentCta">I&rsquo;m here</Link>
          </div>
        ) : null}
      </header>

      {/* N4: two wrapper divs only — display:contents below 1024px means they
          contribute ZERO box on mobile (byte-identical layout); at >=1024px
          they become the rail | stream grid (see feed.css). DOM order is
          unchanged. */}
      <div className="feedGrid">
        <div className="feedRail">
          {/* Desktop-only (D1): the rail's parent is display:contents below
              1024px, so this wrapper carries its own hide rule to keep the
              mobile feed byte-identical. Conditions strip fails soft. */}
          <div className="feedRailDesktopOnly">
            <TonightConditionsStrip />
          </div>

          <PresenceStrip spillingNow={spillingNow} />

          {socialFriendsLaunchEnabled ? (
            <SocialTabs active={tab} onChange={onTabChange} />
          ) : null}

          {/* The chip filters refine the city-wide feed; on Your lot / Nearby the
              tab itself is the lane, so the chips stand down. */}
          {tab === "london" ? (
            <FeedFilters active={filter} onChange={onFilterChange} />
          ) : null}
        </div>

        <div className="feedMain">
      {/* Live "N new pints" pill (issue #37): reveals buffered new drops on tap
          rather than yanking the scroll. Hidden when nothing is buffered. */}
      {pendingItems.length > 0 ? (
        <button type="button" className="feedNewPill" onClick={revealPending}>
          {pendingItems.length === 1
            ? "1 new pint. Tap to show"
            : `${pendingItems.length} new pints. Tap to show`}
        </button>
      ) : null}

      {status === "loading" ? (
        <div className="feedList" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="feedCard feedCardSkeleton">
              <div className="feedSkelHead">
                <span className="feedSkelAvatar" />
                <span className="feedSkelLine feedSkelLineShort" />
              </div>
              <div className="feedSkelPhoto" />
              <div className="feedSkelLine" />
              <div className="feedSkelLine feedSkelLineShort" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          className="feedEmpty"
          actionTone="accent"
          title="Couldn't load Stories."
          body="Check your connection, then try again."
          role="alert"
          action={
            <button
              type="button"
              className="feedRetryBtn"
              onClick={() => setFetchTick((n) => n + 1)}
            >
              Try again
            </button>
          }
        />
      ) : lotEmpty ? (
        <EmptyState
          className="feedEmpty"
          actionTone="accent"
          eyebrow="Your lot"
          title="Your lot is quiet."
          body="Your lot is the people you both follow. Find your lot to search a handle or send an invite, and their nights, drops and check-ins land here."
          action={<Link href="/social">Find your lot</Link>}
        />
      ) : sightingSpot === "primary" ? (
        // London cold start: no drinker has logged yet, so the honestly-sourced
        // sightings ARE the surface instead of a dead empty state. Kept as its
        // own branch above the empty state so it never touches that component.
        <FeedSightings variant="primary" sightings={sightings} />
      ) : isEmpty ? (
        <EmptyState
          className="feedEmpty"
          actionTone="accent"
          eyebrow="Quiet at the bar"
          title="No pints logged yet tonight."
          body="Be the first to drop one. Snap your pint, log the price, pass down a story. The feed fills up as London drinks."
          action={
            <div className="feedEmptyActions">
              <Link href="/map?log=1" className="feedEmptyPrimary">
                Find a pub and drop a pint
              </Link>
              <Link href="/moment" className="feedEmptySecondary">
                Share a Moment instead
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="feedList">
            {visible.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                summary={summaries[item.id] ?? EMPTY_SUMMARY}
                onToggleReaction={toggleReaction}
                onRetryPost={retryOptimisticPost}
              />
            ))}
          </div>
          {nextCursor ? (
            <div className="feedLoadMore">
              {/* Sentinel the mobile IntersectionObserver watches. Zero-height,
                  aria-hidden — invisible to AT and keyboard users, who rely on the
                  button below. On desktop it simply never trips (observer unarmed). */}
              <div ref={sentinelRef} className="feedSentinel" aria-hidden="true" />
              <button
                type="button"
                className="feedLoadMoreBtn"
                onClick={() => setPagesLoaded((n) => n + 1)}
              >
                Load more pints
              </button>
            </div>
          ) : (
            <div className="feedEndWrap">
              <p className="feedEnd">You&rsquo;ve reached the bottom of the barrel.</p>
              <Link href="/map?log=1" className="feedEndCta">Log your pint</Link>
            </div>
          )}
          {/* Real drinkers lead; ambient sightings sit BELOW them as a quiet,
              clearly-sourced strip so the London tab stays alive without ever
              faking user activity. */}
          {sightingSpot === "strip" ? (
            <FeedSightings variant="strip" sightings={sightings} />
          ) : null}
        </>
      )}
        </div>
      </div>
    </main>
  );
}
