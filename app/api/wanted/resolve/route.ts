// POST /api/wanted/resolve — paste a name or URL → venue candidates.
// Auth-gated. Never fetches Instagram/TikTok. Rate-limited.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { resolveWantedPaste } from "@/lib/wantedResolve.server";

export const runtime = "nodejs";

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  const paste = readString(body.paste) || readString(body.q) || readString(body.query);
  if (!paste || paste.trim().length < 2) {
    return publicApiError("Paste a pub name or a link.", "INVALID_REQUEST", 400);
  }

  const limiterKey = `wanted-resolve:${contributor.actor}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
    return publicApiError("Too many searches, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    const result = await resolveWantedPaste(paste, 8);
    return jsonNoStore(result, { status: 200 });
  } catch (err) {
    log("error", "wanteds.resolve_failed", {
      route: "POST /api/wanted/resolve",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Search is unavailable right now.", "SEARCH_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
