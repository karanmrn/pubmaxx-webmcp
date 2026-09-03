// POST /api/heritage — "The Landlord" heritage Q&A for one pub.
// GET  /api/heritage — read-only cited heritage facts for passive display.
// Grounded in retrieved facts only; never exposes API keys; never 500s the demo.

import { apiError, publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  answerHeritage,
  NO_STORY_LINE,
  retrieveHeritageWithStatus,
} from "@/lib/heritage";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { resolveHarvestOverlayVenue } from "@/lib/harvestOverlayVenue";
import { resolveVenue } from "@/lib/venueIndex";

// Heritage does not require Supabase durability, but production still needs
// ADMIN_TOKEN / RATE_LIMIT_SALT so the durable limiter salt is real.
if (process.env.NODE_ENV === "production") assertProductionSecrets();

const MAX_QUESTION_LEN = 300;
const MAX_VENUE_NAME_LEN = 200;

// Heritage facts are static-ish (shipped cache + slow-moving Supabase rows), so
// the read endpoint is safe to cache publicly on the CDN for a short window —
// matching the codebase convention for cacheable GET JSON (e.g. venue/[id]).
const HERITAGE_FACTS_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=600";

// Cost protection: The Landlord fronts a paid OpenRouter call, so this route
// is rate-limited like Pint Drop writes — durable (Supabase RPC) when
// configured, in-memory fallback otherwise. Keyed on the hashed IP (there is
// no contributor handle here), so spend can't be scripted from one machine.
const HERITAGE_RATE_LIMIT = 10;
const HERITAGE_RATE_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
    }

    const record = (body ?? {}) as Record<string, unknown>;

    const rawVenueName = typeof record.venueName === "string" ? record.venueName.trim() : "";
    if (!rawVenueName) {
      return publicApiError("Add a venue name.", "INVALID_REQUEST", 400);
    }
    const venueName = rawVenueName.slice(0, MAX_VENUE_NAME_LEN);

    const rawQuestion = typeof record.question === "string" ? record.question.trim() : "";
    if (!rawQuestion) {
      return publicApiError("Add a question.", "INVALID_REQUEST", 400);
    }
    const question = rawQuestion.slice(0, MAX_QUESTION_LEN);

    const limiterKey = `heritage:${hashIp(clientIp(request))}`;
    // Fail CLOSED on the durable path: this route fronts paid OpenRouter spend,
    // so if Supabase is configured but the durable limiter can't answer
    // (missing-rpc / no-client / error), refuse rather than fall back to a
    // scriptable per-instance budget.
    if (
      await isLimited(limiterKey, limiterKey, HERITAGE_RATE_LIMIT, HERITAGE_RATE_WINDOW_MS, {
        failClosed: true,
      })
    ) {
      return publicApiError("Too many questions, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }

    // Any client-supplied `context` is deliberately ignored — venue context is
    // reconstructed server-side (heritage cache + pub_heritage) so a client
    // cannot forge pub history.
    const venueId = typeof record.venueId === "string" ? record.venueId : undefined;
    const overlayVenueResolution = venueId
      ? await resolveHarvestOverlayVenue(venueId)
      : undefined;
    // The overlay resolution answers a NARROWER question: which OSM overlay
    // rows apply. A curated venue with no OSM id answers `unknown` there, which
    // says nothing about the venue itself, so name and kind fall back to the
    // canonical index. Without this the client-supplied venueName wins for
    // every OSM-less venue, which is exactly the forgery this route refuses.
    const resolvedVenue =
      (overlayVenueResolution?.status === "resolved"
        ? overlayVenueResolution.venue
        : null) ?? (venueId ? await resolveVenue(venueId) : null);

    const response = await answerHeritage({
      venueId: resolvedVenue?.id ?? venueId,
      venueName: resolvedVenue?.name ?? venueName,
      venueKind: resolvedVenue?.kind,
      question,
      overlayVenueResolution,
    });
    return jsonNoStore(response, { status: 200 });
  } catch {
    // Never 500 the demo — degrade to the honest empty-line answer.
    return jsonNoStore({ answer: NO_STORY_LINE, citations: [] }, { status: 200 });
  }
}

// GET /api/heritage?venueId=<id>&venueName=<name>
//
// Read-only cited heritage facts for passive display on the venue sheet.
// Same trust boundary as POST: facts are reconstructed SERVER-SIDE only
// (heritage_cache.json + Supabase `pub_heritage` + harvest overlay lore keyed
// by OSM id). No client-supplied fact is ever accepted — a ready response
// carries only what's on record, and an empty array when there is nothing.
//
// No rate limit here (unlike POST, which fronts paid OpenRouter spend): this is
// a light internal read of local/Supabase data, and the short public/CDN cache
// above absorbs repeat traffic for ready reads.
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;

    const rawVenueName = params.get("venueName")?.trim() ?? "";
    if (!rawVenueName) {
      return apiError("venue_name_required", "Add a venue name.", 400);
    }
    // Cap like POST so a hostile 5 kB name can't blow up retrieval.
    const venueName = rawVenueName.slice(0, MAX_VENUE_NAME_LEN);
    const venueId = params.get("venueId")?.trim() || undefined;

    const result = await retrieveHeritageWithStatus({ venueId, venueName });
    if (result.status === "degraded") {
      return jsonNoStore({ facts: result.facts }, { status: 200 });
    }
    return Response.json(
      { facts: result.facts },
      { headers: { "Cache-Control": HERITAGE_FACTS_CACHE_CONTROL } },
    );
  } catch {
    // Never 500 the demo — an unexpected failure degrades to "nothing on
    // record", never a fabricated fact. no-store so a transient error can't be
    // pinned at the CDN as an empty result.
    return jsonNoStore({ facts: [] }, { status: 200 });
  }
}
