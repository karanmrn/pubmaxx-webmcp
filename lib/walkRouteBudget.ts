// SERVER-ONLY. Global DAILY budget for OUTBOUND OpenRouteService calls.
//
// /api/walk-route already carries a per-CLIENT limiter (20/min, keyed on the
// hashed IP — lib/pintDrops isLimited, same seam as every write route). That
// caps one client, but nothing caps the GLOBAL daily ORS spend. The free ORS
// tier is ~2500 calls/day, and the durable limiter's documented fail-open path
// makes the per-client cap leaky exactly when it matters: when Supabase can't
// answer, isLimited degrades to a per-INSTANCE in-memory budget, so under
// Friday-night load each cold-start instance grants its own 20/min. Multiplied
// across instances the aggregate can silently drain the daily ORS quota, after
// which ORS 403s and EVERY route degrades to straight lines for everyone.
//
// This module adds a DURABLE global daily counter for the ACTUAL provider calls,
// reusing the exact same check_rate_limit seam (lib/supabase, via isLimited)
// with a single global bucket keyed `ors-global:<UTC-date>` and a 24h window.
// Each real provider call consumes one unit; cache hits and the keyless path
// never call in here, so they never consume budget. Over budget -> the caller
// skips the provider and serves the straight leg (the existing fail-soft path).
//
// COST: at most one cheap durable round-trip per ACTUAL provider call, and an
// in-process short-circuit once the day is exhausted (the exhausted verdict is
// cached for a few minutes), so an exhausted Friday night costs ZERO durable
// reads per request. The dominant debounced map-redraw sends one request with
// at most one uncached leg, i.e. one durable read; a cold full route does one
// per uncached leg (bounded by WALK_ROUTE_MAX_STOPS - 1).
//
// DEGRADED MODE (documented, inherited from isLimited):
//   • Supabase configured + durable RPC answers -> the true GLOBAL cap holds.
//   • Supabase not configured (local/dev/CI)     -> per-instance in-memory cap.
//   • Durable RPC missing / transient outage      -> isLimited fails open to the
//     per-instance in-memory budget (rate_limit.fail_open warn). On Vercel each
//     instance then keeps its own daily counter, so the effective global cap is
//     looser than ORS_DAILY_BUDGET by roughly the live instance count. That is
//     the SAME accepted trade the write-path limiter makes: durable is the
//     design target, the in-memory budget is the fail-soft floor — never a hard
//     stop on routing, which stays fail-soft to straight lines throughout.

import { isLimited } from "@/lib/pintDrops";
import { log } from "@/lib/log";
import { DAY_MS } from "@/lib/dayMs";

/** Default daily cap on outbound ORS calls. 2000 leaves ~500 headroom under the
 *  ~2500/day free tier so a burst that trips the soft cap still can't 403 ORS. */
export const ORS_DAILY_BUDGET_DEFAULT = 2000;

/** One UTC day. The bucket key already rolls per calendar day; the matching
 *  window makes the durable counter prune anything older than a day too. */
export const ORS_BUDGET_WINDOW_MS = DAY_MS;

/** Once exhausted, cache that verdict this long so we stop paying a durable
 *  round-trip (and stop making provider calls) for the rest of the window. Short
 *  enough that a freed budget — a rolled UTC day, or a raised env cap — recovers
 *  within minutes rather than being pinned for the whole day. */
export const ORS_BUDGET_EXHAUSTED_TTL_MS = 5 * 60 * 1000;

/**
 * Configured daily budget. `ORS_DAILY_BUDGET` overrides the default; a missing,
 * non-numeric, or non-positive value falls back to ORS_DAILY_BUDGET_DEFAULT.
 * Read per call so an env change (or a test stub) takes effect without a reload.
 */
export function orsDailyBudget(): number {
  const raw = Number(process.env.ORS_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : ORS_DAILY_BUDGET_DEFAULT;
}

/** The global bucket key for a given instant: `ors-global:<UTC-date>`. Rolls at
 *  UTC midnight so each calendar day gets a fresh budget. */
export function orsBudgetKey(now: number = Date.now()): string {
  return `ors-global:${new Date(now).toISOString().slice(0, 10)}`;
}

// In-process short-circuit: once the durable check reports the day is spent, we
// remember that (scoped to the UTC date so a rolled day is never held down by a
// stale flag) and skip the durable round-trip until the TTL lapses.
let exhausted: { date: string; until: number } = { date: "", until: 0 };

/**
 * Emit ONE structured WARN when the global daily ORS budget is first observed
 * exhausted in a window. Mirrors the rate_limit.fail_open idiom (lib/pintDrops):
 * a single grep-able line an operator can alert on. `date` (not `key`) carries
 * the bucket day — the logger redacts any field literally named `key`, and the
 * date is not sensitive anyway. No IP, key material, or PII reaches the log.
 */
function warnOrsBudgetExhausted(date: string, budget: number): void {
  log("warn", "ors_budget.exhausted", { date, budget, windowMs: ORS_BUDGET_WINDOW_MS });
}

/**
 * Reserve ONE unit of the global daily ORS budget for an actual provider call
 * that is about to happen. Returns true when the call may proceed, false when
 * the day is over budget and the caller must serve the straight leg instead.
 *
 * Call this ONLY immediately before a real ORS fetch — never for a cache hit or
 * the keyless path — so budget is consumed per PROVIDER CALL, not per request.
 * Delegates to isLimited (the check_rate_limit seam), inheriting its documented
 * durable/degraded behaviour verbatim (see the module header).
 */
export async function consumeOrsBudget(now: number = Date.now()): Promise<boolean> {
  const date = new Date(now).toISOString().slice(0, 10);

  // Short-circuit: the day is already known-exhausted and the TTL hasn't lapsed.
  // Costs nothing — no durable round-trip, no provider call.
  if (exhausted.date === date && now < exhausted.until) return false;

  const key = orsBudgetKey(now);
  const over = await isLimited(key, key, orsDailyBudget(), ORS_BUDGET_WINDOW_MS);
  if (over) {
    exhausted = { date, until: now + ORS_BUDGET_EXHAUSTED_TTL_MS };
    warnOrsBudgetExhausted(date, orsDailyBudget());
    return false;
  }
  return true;
}

/** Test-only: clear the in-process exhausted flag between cases. The durable
 *  counter itself resets via the supabase/in-memory limiter reset. */
export function __resetOrsBudget(): void {
  exhausted = { date: "", until: 0 };
}
