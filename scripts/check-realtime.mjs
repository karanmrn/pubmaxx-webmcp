// Operational check: does Supabase Realtime actually work for this project?
//
// QA finding this closes: the `supabase_realtime` publication SQL that
// pint_drop_comments/visit_reports need (see supabase/migrations/
// 0014_realtime_publication.sql) was previously undocumented-as-code and
// unverifiable from the outside. This script gives a runnable, honest signal.
//
// WHAT THIS PROVES:
//   - The anon client can open a WebSocket to this project's Realtime endpoint
//     and successfully JOIN a channel subscribed to `postgres_changes` on
//     public.pint_drop_comments. A `SUBSCRIBED` status means: the CSP/network
//     path is open, the project ref + anon key are valid, and Realtime itself
//     is reachable and accepting subscriptions.
//
// WHAT THIS DOES **NOT** PROVE:
//   - That `pint_drop_comments` is actually a member of the `supabase_realtime`
//     publication. Supabase happily lets a channel JOIN and report SUBSCRIBED
//     even when the target table was never added to the publication — the
//     subscription simply then never receives an event, because Postgres never
//     sends one. A join success is necessary but NOT sufficient: it confirms
//     the transport works, not that events will flow.
//   - There is no read-only, client-side way to query `pg_publication_tables`
//     under the anon key (RLS/grants correctly keep catalog access off the
//     anon role), so this script cannot verify publication membership itself.
//     If you need that guarantee, run migration 0014
//     (supabase/migrations/*_0014_realtime_publication.sql) — it is idempotent,
//     so re-running it is always safe — or check
//     `select * from pg_publication_tables where pubname = 'supabase_realtime'`
//     directly with a privileged connection.
//
// Usage:
//   node scripts/check-realtime.mjs
//
// Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
// the environment (the same public, anon-scoped values the browser client
// uses — see lib/authClient.ts). Never prints their values.
//
// Exit codes: 0 = joined (SUBSCRIBED) within the timeout. 1 = not configured,
// join failed/errored, or timed out.

const TABLE = "pint_drop_comments";
const JOIN_TIMEOUT_MS = 8_000;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error(
      "[check-realtime] NOT CONFIGURED: NEXT_PUBLIC_SUPABASE_URL and/or " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set in this environment. " +
        "Set both (see .env.example) and re-run to actually exercise the " +
        "Realtime connection. Exiting 1 without attempting a connection.",
    );
    process.exitCode = 1;
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      settle({ ok: false, reason: `timed out after ${JOIN_TIMEOUT_MS}ms waiting to join` });
    }, JOIN_TIMEOUT_MS);

    let channel;
    try {
      channel = supabase.channel("check-realtime:pint-drop-comments");
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE },
        () => {
          // No event is expected during this short-lived check; if one
          // arrives it doesn't change the pass/fail verdict (join is what we
          // measure), so intentionally no-op here.
        },
      );
      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          settle({ ok: true });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          settle({ ok: false, reason: err?.message ?? `channel status: ${status}` });
        }
      });
    } catch (err) {
      settle({ ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
  });

  try {
    await supabase.removeAllChannels();
  } catch {
    /* best-effort cleanup */
  }

  if (result.ok) {
    console.log(
      `[check-realtime] SUBSCRIBED: joined a postgres_changes channel on ` +
        `public.${TABLE} within ${JOIN_TIMEOUT_MS}ms. This confirms the ` +
        `WebSocket transport (CSP connect-src wss://*.supabase.co, network, ` +
        `project ref, anon key) all work. It does NOT confirm ${TABLE} is in ` +
        `the supabase_realtime publication — events only flow if migration ` +
        `0014_realtime_publication.sql has been applied. Run it (idempotent) ` +
        `if live updates still aren't showing up in the app.`,
    );
    process.exitCode = 0;
    return;
  }

  console.error(
    `[check-realtime] FAILED: could not reach SUBSCRIBED on public.${TABLE} ` +
      `(${result.reason}). This points at a transport problem — check the CSP ` +
      `connect-src includes wss://*.supabase.co (next.config.mjs), that the ` +
      `project ref/anon key are correct, and that Realtime is enabled for ` +
      `this project. If you DO reach SUBSCRIBED but still see no live ` +
      `updates in the app, that's a separate problem: run migration ` +
      `0014_realtime_publication.sql to add the table to the ` +
      `supabase_realtime publication.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[check-realtime] UNEXPECTED ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
