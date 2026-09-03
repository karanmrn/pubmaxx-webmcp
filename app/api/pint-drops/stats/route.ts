// Contribution stats for the Pint Drop gamification loop (feat/price-drops-v2).
//
// GET /api/pint-drops/stats?handle=<handle>[&city=<city>] → the honest "your
// impact" summary a contributor's You-page card renders: a mapping streak, a
// per-borough tally of the prices they've mapped, and a running total. READ
// ONLY — no mutation, so it carries no write-surface certification weight; it
// still runs the house abuse controls (per-IP + global durable rate limits) and
// returns the flat public error envelope (lib/apiError.ts) THE LOCAL routes use.
//
// Boroughs are resolved server-side (getVenueIndex — venue records carry a
// `borough`), so the pure summariser (lib/pintContributions.ts) never needs the
// server-only venue index in the browser bundle.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId } from "@/lib/cities";
import { log } from "@/lib/log";
import { summariseContributions, type ContributionInput } from "@/lib/pintContributions";
import { isLimited, normalizeViewerHandle } from "@/lib/pintDrops";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { getVenueIndex } from "@/lib/venueIndex";

// A stats read fans out to the venue index; cap how often one IP (and the whole
// deployment) can pull it. Generous — this is a personal dashboard, not a hot
// write path — but bounded so it can't be scripted into a scan.
const PER_IP_LIMIT = 30;
const GLOBAL_LIMIT = 600;
const WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const handle = normalizeViewerHandle(params.get("handle") ?? params.get("author"));
  if (!handle) {
    return publicApiError("Add a handle.", "handle_required", 400);
  }

  // Two-axis rate limit (mirrors the report path): per-IP flood control plus a
  // global ceiling. Durable in production, bounded in-memory in dev/CI.
  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`stats:${ipHash}`, `stats:${ipHash}`, PER_IP_LIMIT, WINDOW_MS)) ||
    (await isLimited("stats:global", "stats:global", GLOBAL_LIMIT, WINDOW_MS))
  ) {
    return publicApiError("Too many requests, slow down.", "rate_limited", 429, {
      retryable: true,
    });
  }

  const cityId = parseCityId(params.get("city")) ?? undefined;

  try {
    // The author viewing their own contributions: pass a viewer whose handle IS
    // the author so their follower-gated ("friends") drops count toward their own
    // streak/tally. Legacy family-lane drops stay excluded (ledger-only), matching
    // every other public read.
    const drops = await pintDropsStore().listVisible(undefined, { handle }, handle, cityId);

    const index = await getVenueIndex();
    const entries: ContributionInput[] = drops.map((drop) => ({
      createdAt: drop.createdAt,
      priceGbp: drop.priceGbp,
      borough: index.get(drop.venueId)?.borough ?? "London",
    }));

    const summary = summariseContributions(handle, entries);
    return jsonNoStore({ stats: summary }, { status: 200 });
  } catch (err) {
    log("error", "pint_drops.stats_failed", {
      route: "GET /api/pint-drops/stats",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Contribution stats are unavailable.", "stats_unavailable", 503, {
      retryable: true,
    });
  }
}
