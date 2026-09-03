import { isModerator } from "@/lib/adminAuth";
import { callerUserId } from "@/lib/authServer";

// Single write-path seam for community "Pint Drops".
//
// One PintDropStore interface, two implementations (lib/pintDropsStore):
// Supabase (pint_drops + Storage) when env keys exist, process-memory
// otherwise. pintDropsStore() below is the ONLY place the backend is chosen (M4 / PRD
// P2.7); every handler talks to the interface. Validation/provenance/rate-limit
// run before either backend. When Supabase is configured it is the source of
// truth: backend failures return a 503 instead of acknowledging data that
// would only live in process memory.

import { qualifyCheapPintForAccountId } from "@/lib/cheapPintPingQualify.server";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { enrichItemsWithAvatarUrls } from "@/lib/avatarResolve";
import { parseCityId } from "@/lib/cities";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { log } from "@/lib/log";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { pintDropReportIdentity } from "@/lib/pintDropReportActor.server";
import {
  isLimited,
  validatePintDrop,
  type PintDropReviewStatus,
  type PintDropStatus,
} from "@/lib/pintDrops";
import {
  pintDropsStore,
  type PintDropPhotos,
} from "@/lib/pintDropsStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, requiresSupabaseStore, isSupabaseConfigured } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { getVenueIndex, lookupCanonicalVenue, venueMapUrl } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

// Fail fast at module load: a misconfigured production deploy (no Supabase)
// would silently fall back to the process-memory store and lose every write on
// the next cold start. In prod that is a FATAL condition — throw here, at import
// time, so the route never comes up half-broken. No-op outside production, where
// the in-memory store is the intended dev/demo backend.
assertServerEnv();

// A pint drop is also the moment a handle first "exists" socially, so we lazily
// create its profile row (foundation for follows / saved lists / a public
// /u/[handle]). Best-effort and non-blocking: a profile hiccup must never fail
// an otherwise-good drop, so failures are logged, not thrown.
async function ensureProfileForHandle(handle: string): Promise<void> {
  try {
    await profileStore().ensure(handle);
  } catch (err) {
    console.warn(
      "[pint-drops] could not ensure profile for handle (drop still saved):",
      err instanceof Error ? err.message : err,
    );
  }
}

function priceAuthorityKeyForDrop(
  venueId: string,
  visibility: string | undefined,
  verifiedAccountId: string | null,
): string | undefined {
  if (visibility === "anonymous") return undefined;
  return pintDropAuthorityKey(venueId, verifiedAccountId);
}

// The friendly label a card shows when an id has no resolvable pub name — kept
// in step with lib/feed.ts VENUE_FALLBACK_LABEL so server and client agree.
const VENUE_FALLBACK_LABEL = "A London pub";

// PRD §9: enrich each public drop with a human `venueName` + a "/map?sel=…"
// `venueMapUrl`, resolved server-side from the bundled venue index, so no public
// feed/profile/permalink card ever surfaces the raw content-hashed `venue-…` id.
// Batched over the whole page against the one memoized index (a single Map read
// per drop). Never throws: an unreadable index yields the friendly fallback for
// every id, and the drops still render.
async function withVenueNames<T extends { venueId: string }>(
  drops: T[],
): Promise<(T & { venueName: string; venueMapUrl: string })[]> {
  const index = await getVenueIndex();
  return drops.map((drop) => ({
    ...drop,
    venueName: index.get(drop.venueId)?.name ?? VENUE_FALLBACK_LABEL,
    venueMapUrl: venueMapUrl(drop.venueId),
  }));
}

// Resolve the requester's verified viewer identity for friends-gated reads
// (issue #29). JWT → profiles.user_id → handle is authoritative; ?viewer= is
// a dev/test fallback only (see resolveViewerContextFromRequest).
async function resolveViewer(request: Request): Promise<Awaited<ReturnType<typeof resolveViewerContextFromRequest>>> {
  const params = new URL(request.url).searchParams;
  try {
    return await resolveViewerContextFromRequest(
      request,
      params.get("viewer") ?? params.get("handle"),
    );
  } catch (err) {
    log("warn", "pint_drops.viewer_follow_lookup_failed", {
      route: "GET /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

const STORAGE_UNCONFIGURED_ERROR =
  "Pint Drop production storage is not configured.";

function productionStorageUnavailable(): Response | null {
  return requiresSupabaseStore() && !isSupabaseConfigured()
    ? publicApiError(STORAGE_UNCONFIGURED_ERROR, "UNAVAILABLE", 503, { retryable: true })
    : null;
}

function storageUnavailable(): Response {
  return publicApiError("Pint Drop storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
}

function notFound(): Response {
  return publicApiError("Pint Drop not found.", "NOT_FOUND", 404);
}

function ok(): Response {
  return jsonNoStore({ ok: true }, { status: 200 });
}

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

// Parse either a JSON body or a multipart form. For multipart we pull the text
// fields into a plain object (validatePintDrop cleans them) and keep the photo
// Files aside. JSON bodies carry no photos. Returns null on a malformed body.
async function parseBody(
  request: Request,
): Promise<{ fields: Record<string, unknown>; photos: PintDropPhotos } | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const fields: Record<string, unknown> = {};
      const photos: PintDropPhotos = { pint: null, venue: null };
      // Vibe tags arrive as a form field: either repeated `vibe_tags` entries or
      // one comma-separated value. Collect into an array; validatePintDrop re-
      // filters against the server allowlist (the client value is never trusted).
      const vibeTags: string[] = [];
      for (const [k, v] of form.entries()) {
        if (k === "pint_photo" && v instanceof File && v.size > 0) photos.pint = v;
        else if (k === "venue_photo" && v instanceof File && v.size > 0) photos.venue = v;
        else if (k === "vibe_tags" && typeof v === "string") {
          vibeTags.push(...v.split(",").map((t) => t.trim()).filter(Boolean));
        } else if (typeof v === "string") fields[k] = v;
      }
      if (vibeTags.length) fields.vibeTags = vibeTags;
      return { fields, photos };
    } catch (err) {
      // Malformed multipart body (bad/missing boundary, truncated body) — the
      // caller turns this into a 400, same as a malformed JSON body below.
      log("warn", "pint_drops.malformed_body", {
        route: "POST /api/pint-drops",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  try {
    return {
      fields: (await request.json()) as Record<string, unknown>,
      photos: { pint: null, venue: null },
    };
  } catch (err) {
    // Malformed JSON body — the caller turns this into a 400. Log the parse
    // failure (message only, never the raw body) so a spike in bad requests is
    // visible instead of silently swallowed.
    log("warn", "pint_drops.malformed_body", {
      route: "POST /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function validateCanonicalPintDrop(fields: Record<string, unknown>) {
  const result = validatePintDrop(fields);
  if (!result.ok) {
    return {
      ok: false,
      response: publicApiError(result.error, "INVALID_REQUEST", 400),
    } as const;
  }

  const venueLookup = await lookupCanonicalVenue(result.value.venueId);
  if (venueLookup.status === "unavailable") {
    return {
      ok: false,
      response: publicApiError("Venue list is unavailable right now, try again shortly.", "UNAVAILABLE", 503, { retryable: true }),
    } as const;
  }
  if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
    return {
      ok: false,
      response: publicApiError("Pick a pub from the map.", "INVALID_REQUEST", 400),
    } as const;
  }

  return {
    ok: true,
    value: {
      ...result.value,
      venueId: venueLookup.canonicalId,
    },
  } as const;
}

async function handleReportAction(
  request: Request,
  fields: Record<string, unknown>,
): Promise<Response> {
  const id = readString(fields.id);
  if (!id) return notFound();
  const identity = await pintDropReportIdentity(request);
  const reportPerActorLimit = 1;
  if (
    (await isLimited(`report:${id}`, `report:${id}`)) ||
    (await isLimited(
      `report:${id}:${identity.actorHash}`,
      `report:${id}:${identity.actorHash}`,
      reportPerActorLimit,
    ))
  ) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    return (await pintDropsStore().report(id, readString(fields.reason), identity))
      ? ok()
      : notFound();
  } catch (err) {
    log("error", "pint_drops.report_failed", {
      route: "POST /api/pint-drops",
      action: "report",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

async function handleModeratorAction(
  request: Request,
  fields: Record<string, unknown>,
): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const id = readString(fields.id);
  if (!id) return notFound();
  const status: PintDropStatus = fields.action === "restore" ? "visible" : "hidden";
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    return (await pintDropsStore().moderate(id, status, readString(fields.note)))
      ? ok()
      : notFound();
  } catch (err) {
    log("error", "pint_drops.moderate_failed", {
      route: "POST /api/pint-drops",
      action: fields.action === "restore" ? "restore" : "keep_hidden",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request);
  if (!parsed) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { fields, photos } = parsed;

  // Public moderation: every report is recorded. Only verified account reports
  // count toward REPORT_HIDE_THRESHOLD; anonymous reports go to moderation
  // without auto-hiding the drop.
  if (fields.action === "report") {
    // Rate-limit reports on two axes as FLOOD PROTECTION only:
    //   • per-drop  (`report:<id>`)                — caps total report volume;
    //   • per-actor (`report:<id>:<actorHash>`)    — the SAME actor gets EXACTLY
    //     ONE report per drop per window, so a duplicate is rejected cheaply
    //     here before it touches storage.
    // DURABLE per-account uniqueness lives in the store/RPC layer
    // (report_pint_drop_v2 + the pint_drop_verified_reports unique (pint_drop_id,
    // actor_hash) pair; the in-memory store mirrors it): a same-actor repeat
    // that slips past this window (new window, limiter cold-start/outage) is an
    // idempotent no-op in the store. Anonymous IP hashes record reports and key
    // flood control, but never enter the auto-hide count. The client `actor`
    // field decides nothing.
    return handleReportAction(request, fields);
  }

  // Moderator decisions: restore (→ visible) or keep_hidden (stay hidden). Both
  // stamp moderated_at so the drop leaves the review queue. 403 without a token.
  if (fields.action === "restore" || fields.action === "keep_hidden") {
    return handleModeratorAction(request, fields);
  }

  // Solo-operator emergency freeze (U15): dropping a pint is a social write. The
  // `report` and moderator (`restore`/`keep_hidden`) branches return above, so
  // reporting and moderation stay OPEN under a freeze — only creation is paused.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;

  const verifiedUserId = await callerUserId(request);
  if (requiresSupabaseStore() && !verifiedUserId) {
    return publicApiError(
      "Sign in to post a Pint Drop.",
      "UNAUTHENTICATED",
      401,
    );
  }

  const canonicalResult = await validateCanonicalPintDrop(fields);
  if (!canonicalResult.ok) return canonicalResult.response;
  const canonicalDrop = canonicalResult.value;

  // JWT-linked handle wins over a self-asserted body handle when signed in.
  // Signed-in users must finish handle onboarding. Signed-out requests keep
  // the self-asserted handle only in the keyless local demo path.
  const actorHandle = await resolveMessageHandle(
    request,
    canonicalDrop.handle,
    verifiedUserId,
    { requireLinked: Boolean(verifiedUserId) },
  );
  if (!actorHandle) {
    return verifiedUserId
      ? publicApiError(
          "Choose a PUBMAXX Handle before posting.",
          "ONBOARDING_REQUIRED",
          409,
          { compatibilityFields: { status: "onboarding_required" } },
        )
      : publicApiError("Add a handle.", "INVALID_REQUEST", 400);
  }
  const ownership = await gateHandleAction(request, actorHandle, verifiedUserId);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  const dropPayload = {
    ...canonicalDrop,
    handle: ownership.handle,
    authorityKey: priceAuthorityKeyForDrop(
      canonicalDrop.venueId,
      canonicalDrop.visibility,
      ownership.callerUserId,
    ),
  };

  // Durable key = handle + hashed IP (PRD P3.9); in-memory fallback stays
  // keyed on handle alone, exactly as before.
  const submitKey = `drop:${ownership.handle.toLowerCase()}:${hashIp(clientIp(request))}`;
  if (await isLimited(ownership.handle, submitKey)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Duplicate guard (feat/price-drops-v2): one PRICED observation per
  // venue+identity+London-day. A second priced drop at the same pub the same day
  // is a 409, not a silent overwrite — the first observation is kept, and one
  // actor can't stack rows to skew a venue's median. Note-only anecdotes are
  // exempt (a passed-down memory isn't a price observation). A store hiccup here
  // must not block an otherwise-good drop, so a lookup failure fails OPEN and the
  // create proceeds (the create path still has its own error handling below).
  if (dropPayload.priceGbp !== null) {
    try {
      if (await pintDropsStore().hasPricedDropToday(dropPayload.venueId, ownership.handle)) {
        return publicApiError("You've already logged a price here today. You can log one price per pub each day.", "CONFLICT", 409);
      }
    } catch (err) {
      log("warn", "pint_drops.dedupe_check_failed", {
        route: "POST /api/pint-drops",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const drop = await pintDropsStore().create(dropPayload, photos);
    // Fire-and-forget: the profile bootstrap must never delay or fail the drop
    // response (an awaited Supabase upsert here blocks every submission and hangs
    // unmocked tests). It never rejects — the inner try/catch swallows failures.
    void ensureProfileForHandle(ownership.handle);
    if (ownership.callerUserId) {
      void qualifyCheapPintForAccountId(ownership.callerUserId);
    }
    return jsonNoStore({ drop }, { status: 201 });
  } catch (err) {
    // An invalid photo is the user's fault — surface as 400. The store has
    // already cleaned up anything it uploaded (no orphans). We don't log this
    // as an error: it's expected client input, and the store already logged
    // any processing failure (§7.2) at its own boundary.
    if (err instanceof Error && err.message.startsWith("Photo must")) {
      return publicApiError(err.message, "INVALID_REQUEST", 400);
    }
    // A genuine storage/insert failure — the user gets a 503. Log it (message
    // only) so the outage is observable instead of a silent 503.
    log("error", "pint_drops.create_failed", {
      route: "POST /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator read: ?status=reported|hidden|pending → the review queue, WITH
  // metadata. `reported` contains visible rows with an unreviewed report.
  const status = params.get("status");
  if (status === "reported" || status === "hidden" || status === "pending") {
    if (!isModerator(request)) return forbidden();
    const unavailable = productionStorageUnavailable();
    if (unavailable) return unavailable;
    try {
      return jsonNoStore({ drops: await pintDropsStore().listForReview(status as PintDropReviewStatus) }, { status: 200 });
    } catch (err) {
      log("error", "pint_drops.list_review_failed", {
        route: "GET /api/pint-drops",
        status,
        error: err instanceof Error ? err.message : String(err),
      });
      return storageUnavailable();
    }
  }

  // Public read: visible drops only, newest-first, hard-capped (MAX_PUBLIC_DROPS),
  // with per-drop VISIBILITY applied server-side (issue #29). The viewer is
  // resolved from a verified JWT when present; ?viewer= is ignored in production.
  const unavailable = productionStorageUnavailable();
  if (unavailable) return unavailable;
  try {
    const viewer = await resolveViewer(request);
    const params = new URL(request.url).searchParams;
    // ?author= scopes the public feed to one handle (passport / profile). Distinct
    // from ?viewer=, which only unlocks the friends visibility lane.
    // ?city= scopes unscoped demo seeds (and organic rows by venue id prefix)
    // so Manchester demo drops never noise the London feed/landing. Defaults
    // to London when omitted or unrecognised.
    const author = params.get("author") ?? undefined;
    const cityId = parseCityId(params.get("city")) ?? undefined;
    const drops = await pintDropsStore().listVisible(
      params.get("venueId") ?? undefined,
      viewer,
      author,
      cityId,
    );
    const enriched = await enrichItemsWithAvatarUrls(await withVenueNames(drops));
    return jsonNoStore({ drops: enriched }, { status: 200 });
  } catch (err) {
    log("error", "pint_drops.list_visible_failed", {
      route: "GET /api/pint-drops",
      error: err instanceof Error ? err.message : String(err),
    });
    return storageUnavailable();
  }
}
