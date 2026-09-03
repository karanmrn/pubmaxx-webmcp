// Client-side Realtime subscription helper — issue #37 ("make it feel alive").
//
// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY CONTRACT — READ THIS FIRST. Events are SIGNALS, never CONTENT.
// ─────────────────────────────────────────────────────────────────────────────
// A Supabase `postgres_changes` payload carries the RAW inserted ROW — including
// columns a public reader must NEVER see: a drop's real `handle` even when its
// visibility is `anonymous`, and `friends`/`legacy` rows that #29's server-side
// filter would withhold from this viewer entirely. Rendering straight from the
// payload would BYPASS every visibility/anonymity guarantee shipped in #29.
//
// Therefore this module treats every realtime event as a bare SIGNAL: "something
// changed, go refetch." The `onDrop` / `onComment` callbacks receive NOTHING
// from the payload — they are zero-argument nudges. The caller's job on a nudge
// is to refetch through the EXISTING filtered read paths (GET /api/pint-drops
// with the viewer param, GET /api/pint-drops/comments) so #29's server-side
// filtering re-applies to every rendered row. The raw row never leaves here.
//
// ─────────────────────────────────────────────────────────────────────────────
// RESILIENCE — everything degrades to today's behaviour.
// ─────────────────────────────────────────────────────────────────────────────
//   • No Supabase env (isAuthConfigured() false) → returns a no-op unsubscribe
//     and, if a `poll` fn was supplied, drives it on an interval instead. The
//     app behaves exactly as it does today (fetch-on-mount, no live updates).
//   • Channel fails to JOIN within ~5s, or errors/closes mid-session → we stop
//     leaning on realtime and fall back to polling `poll` every 30s. Nothing
//     throws; a dropped channel can never crash the host page.
//
// The BROWSER client (lib/authClient.ts — anon key, RLS-scoped) is the only
// client that may open a Realtime socket. The server service-role client
// (lib/supabase.ts) must NEVER be used for subscriptions.

import { getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";

// ── "X spilling right now" — a pure counter ──────────────────────────────────
// The strip's number is derived, NOT streamed: count the drops created in the
// last `windowMin` minutes from the SAME already-filtered list the feed/map has
// already read (so #29 visibility is respected — a hidden drop was never in the
// list). Pure and side-effect-free: trivially unit-testable, no clock coupling
// beyond the `now` you pass. Anything with an unparseable/future/older
// timestamp is excluded, so a bad row can't inflate the count.

/** Default recency window for "spilling now": the last hour. */
export const SPILLING_NOW_WINDOW_MIN = 60;

/**
 * How many of `drops` were created within the last `windowMin` minutes of
 * `now`. `drops` is any list of things carrying a `createdAt` ISO string — pass
 * the ALREADY-FILTERED feed/pint-drops list so withheld drops are never counted.
 * Returns a non-negative integer; robust to bad/missing/future timestamps.
 */
export function countSpillingNow(
  drops: ReadonlyArray<{ createdAt?: string | null }>,
  now: number = Date.now(),
  windowMin: number = SPILLING_NOW_WINDOW_MIN,
): number {
  const cutoff = now - windowMin * 60_000;
  let n = 0;
  for (const d of drops) {
    if (!d?.createdAt) continue;
    const t = Date.parse(d.createdAt);
    // Exclude unparseable, future-dated (clock skew / bad data), and stale rows.
    if (!Number.isFinite(t) || t > now || t < cutoff) continue;
    n += 1;
  }
  return n;
}

/** A zero-argument nudge. Deliberately carries NO payload — see the header. */
export type LiveSignal = () => void;

/** Call to tear down a subscription (and any fallback poll). Always safe. */
export type Unsubscribe = () => void;

// How long we wait for the channel to report `SUBSCRIBED` before deciding
// realtime isn't going to work and switching to polling.
const JOIN_TIMEOUT_MS = 5_000;
// Poll cadence for the fallback path. Deliberately gentle (cost/scale
// discipline, issue #37): a signal only ever triggers a refetch, so 30s of
// latency in the degraded path is acceptable.
const POLL_INTERVAL_MS = 30_000;

// Options shared by every subscription: an optional `poll` fn we fall back to
// (or run outright when realtime is unavailable). Poll is itself just a nudge —
// the caller refetches through the filtered APIs inside it.
type SubscribeOptions = {
  /** Invoked on the fallback interval when realtime is unavailable/broken. */
  poll?: LiveSignal;
  /** When false, skip opening a channel (e.g. the drop is visibility-gated). */
  enabled?: boolean;
};

/**
 * API-only tables cannot safely use browser Postgres Changes: Supabase may
 * report a channel as subscribed while RLS/SELECT grants filter every event.
 * Poll the filtered API on the same gentle cadence instead.
 */
function subscribeByPolling(
  onSignal: LiveSignal,
  options: SubscribeOptions | undefined,
): Unsubscribe {
  if (options?.enabled === false) return () => {};
  if (typeof window === "undefined") return () => {};
  const id = setInterval(options?.poll ?? onSignal, POLL_INTERVAL_MS);
  return () => clearInterval(id);
}

// Core subscription primitive. Opens ONE channel bound to a single INSERT event
// on `table` (optionally row-filtered), and:
//   1. arms a join watchdog — if the channel isn't SUBSCRIBED within
//      JOIN_TIMEOUT_MS, tears it down and starts polling;
//   2. on CHANNEL_ERROR/TIMED_OUT/CLOSED, likewise falls back to polling;
//   3. on every INSERT, fires `onSignal()` — NEVER passing the payload.
// Returns an Unsubscribe that removes the channel and clears every timer.
function subscribeInsert(
  channelName: string,
  table: string,
  filter: string | undefined,
  onSignal: LiveSignal,
  options: SubscribeOptions | undefined,
): Unsubscribe {
  if (options?.enabled === false) return () => {};
  const poll = options?.poll;

  // No browser client (no public env, or SSR) → realtime is impossible. Degrade
  // to polling if a poll fn was given, else a pure no-op. Never throws. supabase-js
  // now loads lazily (dynamic import), so a cold-cache subscribe also lands here
  // and polls until the client warms (AuthProvider primes it per route mount).
  const supabase = getSupabaseBrowser();
  if (!supabase || !isAuthConfigured()) {
    if (!poll) return () => {};
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }

  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  // Hold the channel in a mutable slot: the fallback path removes it, and a
  // resubscribe (future) would swap it. Typed loosely to avoid coupling to the
  // exact supabase-js RealtimeChannel type across versions.
  let channel: ReturnType<typeof supabase.channel> | null = null;

  // Switch to the polling fallback exactly once. Idempotent: repeated triggers
  // (watchdog + a later error) don't stack intervals.
  //
  // RE-ENTRANCY: removeChannel() → channel.unsubscribe() fires the subscribe
  // status callback SYNCHRONOUSLY with "CLOSED", which lands right back here.
  // So every guard (pollTimer, channel = null) must be settled BEFORE the
  // removeChannel call — the original order (remove first, guards after) let
  // the re-entrant call see both guards unset and recurse into removeChannel
  // until "Maximum call stack size exceeded".
  function fallBackToPolling() {
    if (disposed || pollTimer) return;
    if (joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
    const dead = channel;
    channel = null; // re-entry guard: the CLOSED callback sees no channel
    if (poll) pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    // Best-effort remove the dead channel; ignore any error. Do this LAST —
    // see the re-entrancy note above.
    if (dead) {
      try {
        void supabase!.removeChannel(dead);
      } catch {
        /* already gone */
      }
    }
  }

  try {
    channel = supabase.channel(channelName);
    channel.on(
      // supabase-js overloads `.on('postgres_changes', ...)` with a string
      // literal the base types don't model; cast keeps this helper self-contained.
      "postgres_changes" as never,
      filter
        ? { event: "INSERT", schema: "public", table, filter }
        : { event: "INSERT", schema: "public", table },
      () => {
        // SIGNAL ONLY. We deliberately ignore the payload row — see the header.
        if (!disposed) onSignal();
      },
    );

    // Watchdog: if we haven't joined by JOIN_TIMEOUT_MS, assume realtime is
    // unavailable behind this network and fall back to polling.
    joinTimer = setTimeout(fallBackToPolling, JOIN_TIMEOUT_MS);

    channel.subscribe((status: string) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        // Joined — cancel the watchdog. Realtime is live; no polling needed.
        if (joinTimer) {
          clearTimeout(joinTimer);
          joinTimer = null;
        }
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        // The channel dropped or never came up mid-session — degrade gracefully.
        fallBackToPolling();
      }
    });
  } catch {
    // Constructing/subscribing threw (e.g. transport unavailable) — never let
    // that crash the caller; just poll instead.
    fallBackToPolling();
  }

  return () => {
    disposed = true;
    if (joinTimer) clearTimeout(joinTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (channel) {
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* already gone */
      }
      channel = null;
    }
  };
}

/**
 * Subscribe to NEW pint drops landing anywhere. `onDrop` is a bare nudge — on
 * each new drop the caller must REFETCH through GET /api/pint-drops (with the
 * viewer param) so #29's visibility/anonymity filtering re-applies. The payload
 * row is never surfaced. Falls back to `options.poll` on a 30s interval if the
 * channel can't join or drops. Returns a safe Unsubscribe.
 *
 * NOTE: Pint Drops are stored in `pint_drops` - that table must be in the
 * `supabase_realtime` publication for INSERT events to fire (see 0013 header).
 * Deny-all RLS may also block INSERT
 * events for the publishable-key client; polling via `options.poll` is the
 * intentional fallback — do not re-open public SELECT to "fix" realtime.
 */
export function subscribeToNewDrops(
  onDrop: LiveSignal,
  options?: SubscribeOptions,
): Unsubscribe {
  return subscribeInsert("live:pint-drops", PINT_DROPS_TABLE, undefined, onDrop, options);
}

/**
 * Watch comments (and threaded replies) on ONE drop. Migration 0050 makes raw
 * `pint_drop_comments` reads API-only so actor hashes and parent visibility can
 * never leak through the browser client. A Realtime channel can still report
 * `SUBSCRIBED` while RLS silently filters every event, so this path deliberately
 * polls GET /api/pint-drops/comments every 30s instead. `onComment` remains a
 * payload-free refetch nudge and is used when no explicit `poll` is supplied.
 * A falsy `dropId` yields a pure no-op (nothing to watch).
 */
export function subscribeToComments(
  dropId: string,
  onComment: LiveSignal,
  options?: SubscribeOptions,
): Unsubscribe {
  if (!dropId) return () => {};
  return subscribeByPolling(onComment, options);
}
