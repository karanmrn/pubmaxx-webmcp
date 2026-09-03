// GET /api/cron/refresh-whats-on - scheduled What's-On feed refresh.
//
// Ticketmaster, Skiddle, and the bounded feed refreshers write every kind to
// the durable whats_on_listings store (migration 0119). The read side prefers
// that store and falls back to the committed public/data/whats_on files.
// GitHub workflows remain available as a secondary recovery path.
//
// A failed lane leaves its previous rows unchanged. Successful lanes advance
// independently so one unavailable source cannot erase another feed.
// AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { WHATS_ON_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { refreshWhatsOnListings } from "@/lib/whatsOnRefresh.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  let result;
  try {
    result = await refreshWhatsOnListings();
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    console.error("[cron:refresh-whats-on] refresh failed:", failure);
    return jsonNoStore({
      ok: false,
      feed: WHATS_ON_FEED_KEY,
      mode: "providers",
      written: 0,
      observedAt: null,
      stamped: false,
      error: failure,
      kinds: [],
    });
  }

  if (!result.ok || result.observedAt === null) {
    console.warn(
      `[cron:refresh-whats-on] observedAt NOT advanced (${result.mode}): previous stamp and store stand.`,
    );
    return jsonNoStore({
      ok: false,
      feed: WHATS_ON_FEED_KEY,
      mode: result.mode,
      written: result.written,
      observedAt: null,
      stamped: false,
      providers: result.providers,
      kinds: result.kinds,
    });
  }

  console.log(
    `[cron:refresh-whats-on] persisted ${result.written} rows at ${result.observedAt}.`,
  );
  return jsonNoStore({
    ok: true,
    feed: WHATS_ON_FEED_KEY,
    mode: result.mode,
    written: result.written,
    observedAt: result.observedAt,
    stamped: false,
    providers: result.providers,
    kinds: result.kinds,
  });
}
