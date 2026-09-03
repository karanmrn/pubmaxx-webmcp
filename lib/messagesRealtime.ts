// Signal-only realtime for a message thread (PRD E4). Kept OUT of lib/realtime.ts
// (owned elsewhere; import-only) but follows the exact same privacy + resilience
// contract as its subscribeInsert helper.
//
// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY CONTRACT — events are SIGNALS, never CONTENT. A postgres_changes payload
// carries the RAW inserted message row (body + sender handle). Rendering straight
// from it would BYPASS the courtesy participant check the server route enforces.
// So `onMessage` is a ZERO-ARGUMENT nudge: on each signal the caller must REFETCH
// through GET /api/messages/[id]?handle=… so the participant gating re-applies to
// every rendered row. The raw payload never leaves here.
// ─────────────────────────────────────────────────────────────────────────────
//
// RESILIENCE — degrades to polling. No public Supabase env, or the channel can't
// join within ~5s, or it errors/closes mid-session → we fall back to the caller's
// `poll` on a gentle interval. Polling is the MANDATORY fallback; realtime is the
// optimisation. Nothing here ever throws into the caller.
//
// Only the BROWSER client (anon key, RLS-scoped) may open a socket. But messages
// are RLS deny-all (migration 0019) — the anon key can't read the row — so realtime
// here is opportunistic: if the publication/policy ever allows the INSERT signal
// through it speeds up the thread; if not, the poll fallback keeps it live. Either
// way no content is read from the socket. The server route stays the only reader.

import { getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";

/** A zero-argument nudge — deliberately carries NO payload (see header). */
export type LiveSignal = () => void;
/** Tear down the subscription (and any fallback poll). Always safe to call. */
export type Unsubscribe = () => void;

const JOIN_TIMEOUT_MS = 5_000;
// Threads are more active than the ambient feed — poll a touch faster (10s) so the
// fallback path still feels like a conversation. Matches the page's own cadence.
const POLL_INTERVAL_MS = 10_000;

/**
 * Subscribe to NEW messages in ONE conversation. `onMessage` is a bare nudge; the
 * caller refetches through the participant-gated API on each signal. Falls back to
 * `poll` on a 10s interval if realtime is unavailable or drops. A falsy
 * conversationId yields a pure no-op. Returns a safe Unsubscribe.
 *
 * NOTE: `messages` must be in the `supabase_realtime` publication for INSERT
 * events to fire; if it isn't (deny-all RLS may keep it out), the poll fallback
 * carries the thread — that's by design.
 */
export function subscribeToMessages(
  conversationId: string,
  onMessage: LiveSignal,
  options?: { poll?: LiveSignal },
): Unsubscribe {
  if (!conversationId) return () => {};
  const poll = options?.poll;

  // supabase-js loads lazily (dynamic import): a cold-cache subscribe sees null
  // here and polls until the client warms (AuthProvider primes it per route
  // mount), then a resubscribe upgrades to realtime — same graceful poll fallback.
  const supabase = getSupabaseBrowser();
  if (!supabase || !isAuthConfigured()) {
    if (!poll) return () => {};
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }

  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  // Switch to polling exactly once. Idempotent; guards settle BEFORE removeChannel
  // because unsubscribe fires a synchronous "CLOSED" back into this fn (mirrors the
  // re-entrancy note in lib/realtime.ts).
  function fallBackToPolling() {
    if (disposed || pollTimer) return;
    if (joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
    const dead = channel;
    channel = null;
    if (poll) pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    if (dead) {
      try {
        void supabase!.removeChannel(dead);
      } catch {
        /* already gone */
      }
    }
  }

  try {
    channel = supabase.channel(`live:messages:${conversationId}`);
    channel.on(
      "postgres_changes" as never,
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => {
        // SIGNAL ONLY — ignore the payload row (see header).
        if (!disposed) onMessage();
      },
    );

    joinTimer = setTimeout(fallBackToPolling, JOIN_TIMEOUT_MS);

    channel.subscribe((status: string) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        if (joinTimer) {
          clearTimeout(joinTimer);
          joinTimer = null;
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        fallBackToPolling();
      }
    });
  } catch {
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
