// Structured Visit Reports: the single write/read seam.
//
//   POST { venueId, visitedAt, busyness?, noise?, seating?,
//          serviceWait?, note? }                  -> 201 { report }
//   POST { action: "report", id, reason? }         -> 200 { ok } (public)
//   POST { action: "restore" | "hide", id, note? } -> 200 { ok } (moderator)
//   GET  ?venueId=...        -> 200 { status, reports } (public, newest first)
//   GET  ?contributor=...    -> 200 { contributor, count, status }
//   GET  ?status=reported    -> 200 { reports } (moderator review queue)
//   GET  ?status=hidden      -> 200 { reports } (moderator hidden lane)
//
// One VisitReportStore interface, two implementations (lib/visitReportsStore):
// Supabase (public.structured_visit_reports) when env keys exist, process-memory
// otherwise, with local/preview memory degradation until migrations 0046 and
// 0058 land.
// Production write schema misses fail closed with 503. Reads carry a degraded
// status so a failed lookup is never presented as an answered empty venue.
//
// Boundaries (write-surface certification): account-bound contribution path.
// Creation and reporting are durably RATE LIMITED (rate_limit class); moderator
// restore/hide require the admin token (moderator class). A note is
// slop-filtered + capped at validation; creation identity is server-derived
// from the authenticated account's immutable profile id. A body handle is
// ignored. A hard durable write failure answers 503, never a fake success.
// Creation pauses
// under the solo-operator social freeze; reporting + moderation stay open.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { normalizeHandle, validateVisitReport } from "@/lib/visitReports";
import { visitReportsStore } from "@/lib/visitReportsStore";

// A genuine reporter files a handful of reports; more from one origin in the
// window is abuse. Durable per-profile + hashed-IP, like the app's other writes.
const CREATE_WINDOW_MS = 60_000;
// One report flag per actor per target per window (a second is rejected cheaply
// before it touches the store; durable per-actor uniqueness lives in the store).
const REPORT_PER_ACTOR_LIMIT = 1;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // ── Public report (abuse flag) ─────────────────────────────────────────────
  // A report records per-actor-deduped metadata for the moderator queue. It
  // never changes public visibility. Reporting stays open under the freeze.
  if (body.action === "report") {
    const id = readString(body.id);
    if (!id) return publicApiError("Visit report not found.", "NOT_FOUND", 404);
    // The actor is derived from the request, exactly like community prices.
    // A body-provided token would let one origin manufacture distinct reporters.
    const actorHash = hashActor(`visit-report:${hashIp(clientIp(request))}`);
    if (
      (await isLimited(`visit-report-report:${id}`, `visit-report-report:${id}`)) ||
      (await isLimited(
        `visit-report-report:${id}:${actorHash}`,
        `visit-report-report:${id}:${actorHash}`,
        REPORT_PER_ACTOR_LIMIT,
      ))
    ) {
      return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    try {
      const done = await visitReportsStore().report(id, readString(body.reason), actorHash);
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Visit report not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "visit_reports.report_failed", {
        route: "POST /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Moderator decisions ────────────────────────────────────────────────────
  if (body.action === "restore" || body.action === "hide") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const id = readString(body.id);
    if (!id) return publicApiError("Visit report not found.", "NOT_FOUND", 404);
    const status = body.action === "restore" ? "visible" : "hidden";
    try {
      const done = await visitReportsStore().moderate(id, status, readString(body.note));
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Visit report not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "visit_reports.moderate_failed", {
        route: "POST /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  // ── Create (a social write — paused under the solo-operator freeze) ─────────
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const result = validateVisitReport({
    ...body,
    handle: contributor.handle,
  });
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_REPORT", 400);
  }

  // Durable per-profile + hashed-IP rate limit. Profile identity survives a
  // public handle rename, while the IP component keeps one shared origin from
  // spending another origin's budget.
  const ipHash = hashIp(clientIp(request));
  const key = `visit-report:${contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const report = await visitReportsStore().create(result.value);
    return jsonNoStore({ report }, { status: 201 });
  } catch (err) {
    log("error", "visit_reports.create_failed", {
      route: "POST /api/visit-reports",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  // Moderator lanes: ?status=reported returns flagged, undecided rows;
  // ?status=hidden returns the rows a moderator has already hidden, so a hide is
  // reversible from the same surface that made it rather than by hand-posting an
  // id the admin page no longer knows.
  const status = params.get("status");
  if (status === "reported" || status === "hidden") {
    if (!isModerator(request)) return publicApiError("Not authorised.", "FORBIDDEN", 403);
    const store = visitReportsStore();
    try {
      const reports =
        status === "hidden" ? await store.listHidden() : await store.listForReview();
      return jsonNoStore({ reports }, { status: 200 });
    } catch (err) {
      log("error", "visit_reports.list_review_failed", {
        route: "GET /api/visit-reports",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
    }
  }

  const contributorParam = params.get("contributor");
  if (contributorParam !== null) {
    const contributor = normalizeHandle(contributorParam);
    const result = await visitReportsStore().countForContributor(contributor);
    return jsonNoStore({ contributor, ...result }, { status: 200 });
  }

  // Public read: individual visible reports, newest first. Read status keeps
  // "nothing written" separate from "we could not check".
  const venueId = readString(params.get("venueId"));
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }
  const result = await visitReportsStore().readForVenue(venueId);
  return jsonNoStore(result, { status: 200 });
}
