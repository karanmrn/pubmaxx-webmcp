import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { contextFrom } from "@/lib/concierge/context";
import {
  CONCIERGE_MOODS,
  narrateCrawl,
  rankConciergeVenues,
  type ConciergeIntent,
  type ConciergeMood,
} from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  buildWhatsOnAnswer,
  detectWhatsOnIntent,
  filterRowsByArea,
  filterRowsByWeekday,
} from "@/lib/concierge/whatsOn";
import type { WhatsOnKind } from "@/lib/whatsOn";
import {
  loadWhatsOn,
  type LoadWhatsOnParams,
  type LoadWhatsOnResult,
} from "@/lib/whatsOnStore";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

if (process.env.NODE_ENV === "production") assertProductionSecrets();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_QUERY_LENGTH = 500;

// One rule for both grounded reads here: a bundled read that could not run has
// nothing in it to ground an answer on, so it throws and each call site takes
// its own honest refusal. An empty list from a failed read would otherwise pass
// as a night with nothing on it.
async function loadGroundedWhatsOn(
  params: LoadWhatsOnParams,
): Promise<LoadWhatsOnResult> {
  const answer = await loadWhatsOn(params, {});
  if (answer.readStatus === "degraded") {
    throw new Error("whats-on baseline unavailable");
  }
  return answer;
}

// C3 — build the venueId → tonight-kinds map the soft planner weight reads.
// Isolated from POST so an outage here is a plain try/catch at the call site,
// not extra branching inside the route's already-large handler.
async function tonightEventKindsByVenueMap(): Promise<Map<string, Set<WhatsOnKind>>> {
  const { rows } = await loadGroundedWhatsOn({ window: "tonight" });
  const byVenue = new Map<string, Set<WhatsOnKind>>();
  for (const row of rows) {
    if (!row.venueId) continue;
    const kinds = byVenue.get(row.venueId) ?? new Set<WhatsOnKind>();
    kinds.add(row.kind);
    byVenue.set(row.venueId, kinds);
  }
  return byVenue;
}

function providedIntent(value: unknown): ConciergeIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.mood) || !record.mood.every((item) => typeof item === "string" && CONCIERGE_MOODS.includes(item as ConciergeMood))) return null;
  if (typeof record.groupSize !== "number" || !Number.isInteger(record.groupSize) || record.groupSize < 1 || record.groupSize > 20) return null;
  if (record.area !== undefined && (typeof record.area !== "string" || !record.area.trim() || record.area.length > 80)) return null;
  if (record.maxPintPrice !== undefined && (typeof record.maxPintPrice !== "number" || !Number.isFinite(record.maxPintPrice) || record.maxPintPrice < 3 || record.maxPintPrice > 15)) return null;
  return {
    mood: [...new Set(record.mood as ConciergeMood[])],
    groupSize: record.groupSize,
    ...(typeof record.area === "string" ? { area: record.area.trim() } : {}),
    ...(typeof record.maxPintPrice === "number" ? { maxPintPrice: record.maxPintPrice } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const query = typeof record.query === "string" ? record.query.trim().slice(0, MAX_QUERY_LENGTH) : "";
  const directIntent = record.intent === undefined ? null : providedIntent(record.intent);
  if (!query && !directIntent) {
    return publicApiError(record.intent === undefined ? "Ask a question or choose an option." : "Choose a valid option.", "INVALID_REQUEST", 400);
  }

  const rawCity = typeof record.cityId === "string" ? record.cityId : undefined;
  const cityId = rawCity ? parseCityId(rawCity) : DEFAULT_CITY_ID;
  if (!cityId) return publicApiError("Choose a listed city.", "INVALID_REQUEST", 400);

  const limiterKey = `concierge:${hashIp(clientIp(request))}`;
  // Fail CLOSED: concierge calls a paid LLM. If the durable limiter can't
  // answer (Supabase misconfig/outage), refuse rather than fall back to a
  // scriptable per-instance budget (B2).
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true })) {
    return publicApiError("Too many concierge requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Paid-spend guard (cursor bot, PR #149): without Supabase, isLimited() can
  // only offer a per-instance in-memory budget — scriptable across lambdas. In
  // that state the PAID model assist is withheld in production (deterministic
  // parse still answers, so the route degrades honestly instead of 429ing).
  // Dev/tests keep the assist; with Supabase the durable limiter governs.
  const llmAssistAllowed =
    isSupabaseConfigured() || process.env.NODE_ENV !== "production";

  // What's-On intents (W5 / B7): a "quiz tonight / what's on in Soho / where's
  // showing the football / curry club deals" query is answered from real
  // What's-On store rows — grounded, with provenance, refusing honestly when no
  // rows match. Only free-text queries route here; a tap-chip mood intent stays
  // on the venue-ranking path. Runs no paid model.
  const whatsOnQuery = query ? detectWhatsOnIntent(query) : null;
  if (whatsOnQuery) {
    try {
      // A read that could not run takes the same 503 refusal a thrown read
      // takes, rather than answering "no matches" for a question nobody could
      // look up (loadGroundedWhatsOn owns that rule).
      const { rows, asOf } = await loadGroundedWhatsOn({
        ...(whatsOnQuery.kind ? { kind: whatsOnQuery.kind } : {}),
        ...(whatsOnQuery.window === "tonight" ? { window: "tonight" as const } : {}),
      });
      let matched = whatsOnQuery.area ? filterRowsByArea(rows, whatsOnQuery.area) : rows;
      if (whatsOnQuery.window === "weekday" && whatsOnQuery.weekday !== undefined) {
        matched = filterRowsByWeekday(matched, whatsOnQuery.weekday);
      }
      const answer = buildWhatsOnAnswer(whatsOnQuery, matched);
      return jsonNoStore({ ...answer, asOf });
    } catch {
      // Even the grounding source is unavailable — refuse rather than invent,
      // and signal a degraded dependency (503) so monitoring can distinguish
      // "no matches" from "What's-On storage is down."
      return jsonNoStore(
        {
          mode: "whats-on",
          kind: whatsOnQuery.kind ?? null,
          window: whatsOnQuery.window ?? null,
          area: whatsOnQuery.area ?? null,
          count: 0,
          listings: [],
          message: "I couldn't load sourced listings just now.",
          asOf: new Date().toISOString(),
        },
        { status: 503 },
      );
    }
  }

  try {
    const parsed = directIntent
      ? { intent: directIntent, source: "provided" as const }
      : await parseConciergeIntent(query, { skipModel: !llmAssistAllowed });
    const venues = await loadConciergeVenues(cityId);

    // C3 — soft, opt-in planner weighting: only PlanComposer's "Sort it" sets
    // this today (weighTonightEvents: true). Every other caller (e.g. the
    // map's concierge-ask) omits it, so this whole block is a no-op for them —
    // rankConciergeVenues falls back to its pre-C3 behaviour unchanged. A
    // What's-On outage here must never break venue ranking, so it fails soft
    // to "no weighting" rather than surfacing an error.
    const tonightEventKindsByVenue = record.weighTonightEvents === true
      ? await tonightEventKindsByVenueMap().catch(() => undefined)
      : undefined;

    const ranked = rankConciergeVenues(venues, parsed.intent, {
      limit: typeof record.limit === "number" ? record.limit : 3,
      context: contextFrom(record.context),
      ...(tonightEventKindsByVenue ? { tonightEventKindsByVenue } : {}),
    });
    const results = ranked.map(({ venue, score, reasons }) => ({
      id: venue.id,
      name: venue.name,
      area: venue.area,
      lat: venue.lat,
      lng: venue.lng,
      cheapestPrice: venue.cheapestPrice,
      score,
      reasons,
    }));
    return jsonNoStore({
      intent: parsed.intent,
      intentSource: parsed.source,
      venues: results,
      ...(record.narrated === true ? { narration: narrateCrawl(ranked) ?? null } : {}),
    });
  } catch {
    // The demo remains useful without keys or upstream services; if even the
    // local dataset is unavailable, state the empty result rather than inventing.
    return jsonNoStore({
      intent: directIntent ?? { mood: [], groupSize: 2 },
      intentSource: directIntent ? "provided" : "deterministic",
      venues: [],
      message: "I couldn't load listed venue options.",
    });
  }
}
