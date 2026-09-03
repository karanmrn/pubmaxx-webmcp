// Cheap pint weekday ping preference and one-shot opt-in.
//
//   GET  → { qualified, enabled, declined, sentAt, canPrompt, canSend }
//   POST { action: "qualify" }              → mark qualified (signed-in)
//   POST { action: "opt-in", token }        → bind web push + opt in
//   POST { action: "decline" }              → durable decline

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  canPromptCheapPint,
  canSendCheapPint,
  cheapPintPrefView,
  isCheapPintPingWindow,
} from "@/lib/cheapPintPing";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { cheapPintPingStore } from "@/lib/stepOutNudgeStore";
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

function prefBody(
  pref: {
    cheapPintQualified: boolean;
    cheapPintEnabled: boolean;
    cheapPintDeclined: boolean;
    cheapPintSentAt: string | null;
  } | null,
  now: Date = new Date(),
) {
  const view = cheapPintPrefView({
    cheapPintQualified: Boolean(pref?.cheapPintQualified),
    cheapPintEnabled: Boolean(pref?.cheapPintEnabled),
    cheapPintDeclined: Boolean(pref?.cheapPintDeclined),
    cheapPintSentAt: pref?.cheapPintSentAt ?? null,
  });
  return {
    qualified: view.qualified,
    enabled: view.enabled,
    declined: view.declined,
    sentAt: view.sentAt,
    canPrompt: canPromptCheapPint(view),
    canSend: canSendCheapPint(view, now),
    sendWindow: isCheapPintPingWindow(now),
  };
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  try {
    const pref = await cheapPintPingStore().get(owner.contributor.actor);
    return jsonNoStore(prefBody(pref), { status: 200 });
  } catch (err) {
    log("error", "cheap_pint_ping.get_failed", {
      route: "GET /api/cheap-pint-ping",
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

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "qualify" && action !== "opt-in" && action !== "decline") {
    return publicApiError("Say what you want to do.", "INVALID_REQUEST", 400);
  }

  const ipHash = hashIp(clientIp(request));
  const key = `cheap-pint-ping:${action}:${owner.contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, MUTATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  try {
    if (action === "qualify") {
      const pref = await cheapPintPingStore().qualifyCheapPint(owner.contributor.actor);
      return jsonNoStore(prefBody(pref), { status: 200 });
    }

    if (action === "decline") {
      const pref = await cheapPintPingStore().declineCheapPint(owner.contributor.actor);
      return jsonNoStore(prefBody(pref), { status: 200 });
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
    const pref = await cheapPintPingStore().optInCheapPint(
      owner.contributor.actor,
      token,
    );
    return jsonNoStore(prefBody(pref), { status: 200 });
  } catch (err) {
    log("error", "cheap_pint_ping.post_failed", {
      route: "POST /api/cheap-pint-ping",
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
