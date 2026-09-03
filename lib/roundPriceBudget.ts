import "server-only";

// The account budget a Round's drink lines pay before they may enter the
// community price store (app/api/rounds/[code]).
//
// A Round with drink lines IS a price submission, so it uses the same
// cross-venue key namespace and hourly cap as /api/price-submit. The Round
// route and direct price submissions both use the authenticated profile actor.
// It charges one unit per reconciled venue-and-category store key.
//
// Per-key charging is why the durable limiter's own fallback is wrong here: it
// tightens to a handful of calls, which one honest itemised round would exhaust
// on its fourth drink, turning a limiter outage into "you cannot log a round".
// So when the durable check cannot answer, this does not fail open or closed —
// it charges a per-instance allowance sized at exactly one genuine round
// (ROUND_SPEND_PRICE_LINE_MAX lines per actor per window): one full turn lands,
// an account cannot spray, and the degraded decision is logged once per turn on
// the same `rate_limit.fail_open` event an operator already alerts on.

import { log } from "@/lib/log";
import { isRateLimited } from "@/lib/pintDrops";
import { ROUND_SPEND_PRICE_LINE_MAX } from "@/lib/rounds";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
} from "@/lib/supabase";

/** Same cap and window /api/price-submit applies to its account actor key. */
export const ROUND_PRICE_ACTOR_LIMIT = 30;
export const ROUND_PRICE_WINDOW_MS = 3_600_000;

/**
 * How long to tell a caller to wait when the degraded allowance is spent. The
 * house retry hint for a temporarily unavailable dependency (see
 * lib/planSigningHttp.server): short, because what the caller is waiting on is
 * the durable limiter coming back, not the hour-long budget window.
 */
export const ROUND_PRICE_DEGRADED_RETRY_SECONDS = 60;

/**
 * How the verdict was reached. "durable" is the Round hourly cap answering,
 * "memory" the keyless local budget, and "degraded" the bounded one-round
 * allowance that stands in while the durable limiter is unreachable — a
 * refusal there is our outage, not the drinker's doing, so the caller says so.
 */
export type RoundPriceBudgetMode =
  | "durable"
  | "degraded"
  | "memory"
  | "rejected";

export type RoundPriceBudget = {
  allowed: boolean;
  mode: RoundPriceBudgetMode;
};

export type RoundPriceLineCharge = Readonly<{
  clientRef: string;
  spendId: string;
  lineIndex: number;
}>;

const chargedLines = new Map<string, number>();

export function roundPriceActorKey(actor: string): string {
  return `price-submit-actor:${actor}`;
}

function chargeId(owner: string, line: RoundPriceLineCharge): string {
  return `${owner}:${line.spendId}:${line.clientRef}:${line.lineIndex}`;
}

function chargeInMemory(
  key: string,
  owner: string,
  lines: readonly RoundPriceLineCharge[],
  limit: number,
): boolean {
  const now = Date.now();
  const cutoff = now - ROUND_PRICE_WINDOW_MS;
  for (const [id, chargedAt] of chargedLines) {
    if (chargedAt <= cutoff) chargedLines.delete(id);
  }
  let allowed = true;
  for (const line of lines) {
    const id = chargeId(owner, line);
    if ((chargedLines.get(id) ?? 0) > cutoff) continue;
    if (isRateLimited(key, now, limit, ROUND_PRICE_WINDOW_MS)) {
      allowed = false;
    } else {
      chargedLines.set(id, now);
    }
  }
  return allowed;
}

function degradedAllowance(
  key: string,
  owner: string,
  lines: readonly RoundPriceLineCharge[],
  reason: string,
): RoundPriceBudget {
  const strict = process.env.RATE_LIMIT_STRICT === "1";
  const allowed = strict
    ? false
    : chargeInMemory(
        `${key}:degraded`,
        owner,
        lines,
        ROUND_SPEND_PRICE_LINE_MAX,
      );
  log("warn", "rate_limit.fail_open", {
    reason,
    mode: "degraded",
    surface: "round.price_lines",
    effectiveLimit: strict ? 0 : ROUND_SPEND_PRICE_LINE_MAX,
    windowMs: ROUND_PRICE_WINDOW_MS,
    lines: lines.length,
    allowed,
  });
  return { allowed, mode: "degraded" };
}

async function chargeDurably(
  key: string,
  owner: string,
  line: RoundPriceLineCharge,
): Promise<"charged" | "limited" | "rejected" | "unavailable"> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "charge_round_price_line",
      {
        p_actor: owner,
        p_key: key,
        p_limit: ROUND_PRICE_ACTOR_LIMIT,
        p_line_index: line.lineIndex,
        p_spend_id: line.spendId,
        p_window_ms: ROUND_PRICE_WINDOW_MS,
      },
    );
    if (error) {
      console.error(
        "[round-price-budget] durable charge unavailable:",
        error.message,
      );
      return "unavailable";
    }
    if (data === "charged" || data === "already_charged") return "charged";
    if (data === "limited") return "limited";
    if (data === "forbidden") return "rejected";
    return "unavailable";
  } catch (err) {
    console.error(
      "[round-price-budget] durable charge unavailable:",
      err instanceof Error ? err.message : err,
    );
    return "unavailable";
  }
}

/**
 * Charge one unit per drink line this turn will submit. Total, never throws:
 * the caller gets a verdict and the mode that produced it.
 */
export async function chargeRoundPriceLines(
  profileActor: string,
  promotionOwner: string,
  lines: readonly RoundPriceLineCharge[],
): Promise<RoundPriceBudget> {
  const key = roundPriceActorKey(profileActor);
  if (lines.length === 0) return { allowed: true, mode: "durable" };

  if (!isSupabaseConfigured()) {
    return {
      allowed: chargeInMemory(
        key,
        promotionOwner,
        lines,
        ROUND_PRICE_ACTOR_LIMIT,
      ),
      mode: "memory",
    };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const verdict = await chargeDurably(key, promotionOwner, line);
    if (verdict === "limited") {
      return { allowed: false, mode: "durable" };
    }
    if (verdict === "rejected") {
      return { allowed: false, mode: "rejected" };
    }
    if (verdict === "unavailable") {
      return degradedAllowance(
        key,
        promotionOwner,
        lines.slice(index),
        "error",
      );
    }
  }
  return { allowed: true, mode: "durable" };
}
