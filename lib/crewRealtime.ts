import { getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";

export type CrewSignal = () => void;
export type CrewUnsubscribe = () => void;
export type CrewRealtimeOptions = { poll?: CrewSignal; enabled?: boolean };

const JOIN_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 30_000;

export function subscribeToPlanCrew(
  planId: string,
  onSignal: CrewSignal,
  options?: CrewRealtimeOptions,
): CrewUnsubscribe {
  if (!planId || options?.enabled === false) return () => {};
  // supabase-js loads lazily (dynamic import): a cold-cache subscribe sees null
  // here and polls; once the client warms (AuthProvider primes it on every route
  // mount) a later resubscribe upgrades to realtime — same graceful poll fallback.
  const client = getSupabaseBrowser();
  const poll = options?.poll;
  if (!client || !isAuthConfigured()) {
    if (!poll) return () => {};
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  let disposed = false;
  let channel: ReturnType<typeof client.channel> | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  // Keep a low-frequency safety poll even after SUBSCRIBED. With deny-all RLS,
  // a socket can connect successfully yet receive no row events; connection
  // status alone cannot prove delivery. Realtime remains the fast path.
  const pollTimer: ReturnType<typeof setInterval> | null = poll
    ? setInterval(poll, POLL_INTERVAL_MS)
    : null;

  const fallback = () => {
    if (disposed) return;
    if (joinTimer) clearTimeout(joinTimer);
    joinTimer = null;
    const dead = channel;
    channel = null;
    if (dead) {
      try { void client.removeChannel(dead); } catch { /* already closed */ }
    }
  };

  try {
    channel = client.channel(`live:plan-crew:${planId}`);
    const signal = () => { if (!disposed) onSignal(); };
    channel
      .on("postgres_changes" as never, {
        event: "INSERT", schema: "public", table: "plan_crew_members", filter: `plan_id=eq.${planId}`,
      }, signal)
      .on("postgres_changes" as never, {
        event: "UPDATE", schema: "public", table: "plan_crew_members", filter: `plan_id=eq.${planId}`,
      }, signal);
    joinTimer = setTimeout(fallback, JOIN_TIMEOUT_MS);
    channel.subscribe((status: string) => {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        if (joinTimer) clearTimeout(joinTimer);
        joinTimer = null;
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) fallback();
    });
  } catch {
    fallback();
  }

  return () => {
    disposed = true;
    if (joinTimer) clearTimeout(joinTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (channel) {
      try { void client.removeChannel(channel); } catch { /* already closed */ }
      channel = null;
    }
  };
}
