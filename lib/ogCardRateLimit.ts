import "server-only";

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

/** OG share-card routes: IP-keyed budget shared across card generators. */
export const OG_CARD_RATE_LIMIT = 30;
export const OG_CARD_RATE_WINDOW_MS = 60_000;

/**
 * Rate-limit an OG card GET. Distinct `prefix` per route so one card's budget
 * cannot starve another. Returns a 429 Response when limited, else null.
 */
export async function ogCardRateLimitedResponse(
  request: Request,
  prefix: string,
): Promise<Response | null> {
  const key = `${prefix}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, OG_CARD_RATE_LIMIT, OG_CARD_RATE_WINDOW_MS)) {
    return new Response("Too many requests", { status: 429 });
  }
  return null;
}
