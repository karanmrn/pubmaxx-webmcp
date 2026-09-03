// Crowd occupancy for one venue (master plan R-011).
//
// GET is public and fail-soft: a broken read is `degraded`, never "no reports".
// POST is signed-in, rate-limited, and idempotent per account per pub per
// 15 minutes. Trust is derived on read. The browser never touches the table.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { occupancyNowFromReports, parseOccupancyLevel } from "@/lib/occupancy";
import { occupancyStore } from "@/lib/occupancyStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { resolveCanonicalVenueId } from "@/lib/venueAliases";
import { resolveWritableVenueId } from "@/lib/venueWriteTarget.server";

assertServerEnv();

type RouteContext = { params: Promise<{ id: string }> };

function venueIdFrom(raw: string): string {
  return raw.trim().slice(0, 64);
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: rawId } = await context.params;
  const venueId = venueIdFrom(rawId);
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }
  try {
    const canonicalId = await resolveCanonicalVenueId(venueId);
    const reading = await occupancyStore().readNow(canonicalId);
    return jsonNoStore({
      now: reading.now,
      ageMinutes: reading.ageMinutes,
      reportersLast90: reading.reportersLast90,
      degraded: reading.degraded,
      state: reading.state,
      id: reading.id,
    });
  } catch {
    const failed = occupancyNowFromReports([], Date.now(), { degraded: true });
    return jsonNoStore({
      now: failed.now,
      ageMinutes: failed.ageMinutes,
      reportersLast90: failed.reportersLast90,
      degraded: true,
      state: "degraded",
      id: failed.id,
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: rawId } = await context.params;
  const venueId = venueIdFrom(rawId);
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const action = readString(body.action);
  if (action === "report") {
    const id = readString(body.id);
    if (!id) return publicApiError("Crowd reading not found.", "NOT_FOUND", 404);
    const actorHash = hashActor(`occupancy:${hashIp(clientIp(request))}`);
    if (
      (await isLimited(`occupancy-report:${id}`, `occupancy-report:${id}`)) ||
      (await isLimited(
        `occupancy-report:${id}:${actorHash}`,
        `occupancy-report:${id}:${actorHash}`,
        1,
      ))
    ) {
      return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
        retryable: true,
      });
    }
    try {
      const done = await occupancyStore().flag(id, readString(body.reason), actorHash);
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Crowd reading not found.", "NOT_FOUND", 404);
    } catch {
      return publicApiError(
        "We could not save that just now. Try again.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
  }

  if (action === "hide" || action === "restore") {
    if (!isModerator(request)) {
      return publicApiError("Not authorised.", "FORBIDDEN", 403);
    }
    const id = readString(body.id);
    if (!id) return publicApiError("Crowd reading not found.", "NOT_FOUND", 404);
    try {
      const done = await occupancyStore().moderate(id, action === "hide");
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Crowd reading not found.", "NOT_FOUND", 404);
    } catch {
      return publicApiError(
        "We could not save that just now. Try again.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
  }

  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to report how busy it is.", "UNAUTHENTICATED", 401);
  }

  const key = `venue-occupancy:${userId}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const level = parseOccupancyLevel(body.level);
  if (!level) {
    return publicApiError(
      "Choose empty, some seats, or full.",
      "INVALID_REQUEST",
      400,
    );
  }

  // A report is stored under the venue's canonical id, or it is stored under a
  // key no reader ever asks about.
  const target = await resolveWritableVenueId(venueId);
  if (!target.ok) {
    return publicApiErrorFromStatus(target.error, target.status);
  }

  try {
    const stored = await occupancyStore().report({
      venueId: target.venueId,
      level,
      reporterUserId: userId,
    });
    const reading = await occupancyStore().readNow(target.venueId);
    return jsonNoStore({
      now: reading.now,
      ageMinutes: reading.ageMinutes,
      reportersLast90: reading.reportersLast90,
      degraded: reading.degraded,
      state: reading.state,
      id: reading.id ?? stored.id,
      level: stored.level,
    });
  } catch {
    return publicApiError(
      "We could not save that just now. Try again.",
      "UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
