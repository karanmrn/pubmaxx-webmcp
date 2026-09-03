// Step Out weekly nudge preference.
//
//   GET                    → 200 { enabled, lastSentAt, canSend }
//   POST { enabled: true, token }   → enable + bind web subscription
//   POST { enabled: false } | DELETE → withdraw (opt out)
//
// Auth via resolveContributionIdentity. Rate-limited. publicApiError envelope.
// Default OFF. Frequency stamp is server-side; copy names the weekly cap.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { canSendStepOutNudge } from "@/lib/stepOutNudge";
import { stepOutNudgeStore } from "@/lib/stepOutNudgeStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

export const runtime = "nodejs";

const MUTATE_WINDOW_MS = 60_000;

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requireOwner(request: Request) {
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return {
      ok: false as const,
      response: jsonNoStore(contributor.body, { status: contributor.httpStatus }),
    };
  }
  return { ok: true as const, contributor };
}

function prefResponse(pref: {
  enabled: boolean;
  lastSentAt: string | null;
} | null) {
  const enabled = Boolean(pref?.enabled);
  const lastSentAt = pref?.lastSentAt ?? null;
  return {
    enabled,
    lastSentAt,
    canSend: enabled && canSendStepOutNudge(lastSentAt),
    maxPerWeek: 1,
  };
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  try {
    const pref = await stepOutNudgeStore().get(owner.contributor.actor);
    return jsonNoStore(prefResponse(pref), { status: 200 });
  } catch (err) {
    log("error", "step_out_nudge.get_failed", {
      route: "GET /api/step-out-nudge",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const ipHash = hashIp(clientIp(request));
  const key = `step-out-nudge:${owner.contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, MUTATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (body.enabled !== true && body.enabled !== false) {
    return publicApiError("Say whether Step Out is on or off.", "INVALID_REQUEST", 400);
  }

  try {
    if (body.enabled === false) {
      const previous = await stepOutNudgeStore().get(owner.contributor.actor);
      const pref = await stepOutNudgeStore().withdraw(owner.contributor.actor);
      if (previous?.subscriptionToken && !previous.cheapPintEnabled) {
        await pushTokenStore().delete(previous.subscriptionToken).catch(() => undefined);
      }
      return jsonNoStore(prefResponse(pref), { status: 200 });
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || !decodeWebPushSubscription(token)) {
      return publicApiError(
        "Turn on web push on this device before opting in.",
        "INVALID_REQUEST",
        400,
      );
    }
    const validation = validatePushToken({ token, platform: "web" });
    if (!validation.ok) {
      return publicApiError(validation.error, "INVALID_REQUEST", 400);
    }
    await pushTokenStore().save(validation.input);
    const pref = await stepOutNudgeStore().put(owner.contributor.actor, {
      enabled: true,
      subscriptionToken: token,
    });
    return jsonNoStore(prefResponse(pref), { status: 200 });
  } catch (err) {
    log("error", "step_out_nudge.put_failed", {
      route: "POST /api/step-out-nudge",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const ipHash = hashIp(clientIp(request));
  const key = `step-out-nudge:delete:${owner.contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, MUTATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    const previous = await stepOutNudgeStore().get(owner.contributor.actor);
    const pref = await stepOutNudgeStore().withdraw(owner.contributor.actor);
    if (previous?.subscriptionToken && !previous.cheapPintEnabled) {
      await pushTokenStore().delete(previous.subscriptionToken).catch(() => undefined);
    }
    return jsonNoStore(prefResponse(pref), { status: 200 });
  } catch (err) {
    log("error", "step_out_nudge.delete_failed", {
      route: "DELETE /api/step-out-nudge",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
