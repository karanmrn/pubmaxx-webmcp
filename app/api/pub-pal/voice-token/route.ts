import { callerUserId } from "@/lib/authServer";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import {
  billableVoiceMinutes,
  canReserveVoiceMinute,
  PAL_VOICE_MAX_SESSION_SECONDS,
  PAL_VOICE_MONTHLY_MINUTES,
  remainingVoiceMinutes,
  type PalVoiceMeterState,
} from "@/lib/palVoiceMetering";
import { buildPalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { palVoiceConfigured } from "@/lib/pubPalVoiceConfig.server";
import { getPubPalResult } from "@/lib/pubPalStore";
import { clientIp, hashIp, isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const usage = new Map<string, PalVoiceMeterState>();
const RELEASE_ERROR_MAX_LENGTH = 160;

type VoiceTokenBody = {
  action?: string;
  durationSeconds?: number;
};

function releaseErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
  return message.slice(0, RELEASE_ERROR_MAX_LENGTH);
}

function logReleaseFailure(input: {
  ownerId: string;
  usageMonth: string;
  reason: "rpc_error" | "rpc_exception" | "not_released";
  error: unknown;
}): void {
  log("error", "pub_pal.voice_quota_release_failed", {
    ownerId: input.ownerId,
    usageMonth: input.usageMonth,
    reason: input.reason,
    error: releaseErrorMessage(input.error),
  });
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function usageMonthDate(month: string): string {
  return `${month}-01`;
}

function meterFor(userId: string, month: string): PalVoiceMeterState {
  const current = usage.get(userId);
  if (current?.month === month) return current;
  const meter = { month, usedMinutes: 0, reservations: 0 };
  usage.set(userId, meter);
  return meter;
}

async function releaseVoiceReservation(
  admin: ReturnType<typeof requireSupabaseAdmin> | null,
  userId: string,
  usageMonth: string,
  meter: PalVoiceMeterState,
  durationSeconds: number,
): Promise<void> {
  const billedMinutes = billableVoiceMinutes(durationSeconds);
  if (admin) {
    try {
      const { data, error } = await admin.rpc("release_pub_pal_voice_trial", {
        p_owner_id: userId,
        p_month: usageMonth,
      });
      if (error) {
        logReleaseFailure({
          ownerId: userId,
          usageMonth,
          reason: "rpc_error",
          error,
        });
      } else if (data !== true) {
        logReleaseFailure({
          ownerId: userId,
          usageMonth,
          reason: "not_released",
          error: "Reservation row was not released.",
        });
      }
      if (billedMinutes > 0) {
        const recorded = await admin.rpc("record_pub_pal_voice_minutes", {
          p_owner_id: userId,
          p_month: usageMonth,
          p_seconds: durationSeconds,
        });
        if (recorded.error) {
          log("error", "pub_pal.voice_minutes_record_failed", {
            ownerId: userId,
            usageMonth,
            error: releaseErrorMessage(recorded.error),
          });
        }
      }
    } catch (error) {
      logReleaseFailure({
        ownerId: userId,
        usageMonth,
        reason: "rpc_exception",
        error,
      });
    }
    return;
  }

  meter.reservations = Math.max(0, meter.reservations - 1);
  meter.usedMinutes = Math.min(PAL_VOICE_MONTHLY_MINUTES, meter.usedMinutes + billedMinutes);
  usage.set(userId, meter);
}

async function handleRelease(
  request: Request,
  userId: string,
  body: VoiceTokenBody,
): Promise<Response> {
  const limiterKey = `pub-pal-voice-release:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const month = currentMonth();
  const usageMonth = usageMonthDate(month);
  const meter = meterFor(userId, month);
  const durationSeconds = Math.max(0, Math.min(PAL_VOICE_MAX_SESSION_SECONDS, Number(body.durationSeconds) || 0));
  const admin = isSupabaseConfigured() ? requireSupabaseAdmin() : null;
  await releaseVoiceReservation(admin, userId, usageMonth, meter, durationSeconds);
  const remainingMinutes = admin ? null : remainingVoiceMinutes(meter);
  return jsonNoStore({ released: true, remainingMinutes });
}

async function handleIssueToken(userId: string): Promise<Response> {
  const palResult = await getPubPalResult(userId);
  if (!palResult.ok) {
    return publicApiError("Pub Pal is temporarily unavailable.", "PUB_PAL_STORE_UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  }
  const pal = palResult.value;
  if (!pal) {
    return publicApiError("Create your Pub Pal before starting voice.", "PUB_PAL_REQUIRED", 409, {
      compatibilityFields: { fallback: "text" },
    });
  }
  if (pal.muted) {
    return publicApiError("Voice is muted. Turn it back on to start a voice chat.", "VOICE_MUTED", 409, {
      compatibilityFields: { fallback: "text" },
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    return publicApiError("Voice is not configured yet.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  }

  const month = currentMonth();
  const usageMonth = usageMonthDate(month);
  const supabaseConfigured = isSupabaseConfigured();
  const meter = meterFor(userId, month);
  if (!supabaseConfigured && !canReserveVoiceMinute(meter)) {
    return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, {
      compatibilityFields: { fallback: "text", remaining: 0, remainingMinutes: 0 },
    });
  }

  const admin = supabaseConfigured ? requireSupabaseAdmin() : null;
  if (admin) {
    try {
      const { data, error } = await admin.rpc("consume_pub_pal_voice_trial", {
        p_owner_id: userId,
        p_month: usageMonth,
        p_limit: PAL_VOICE_MONTHLY_MINUTES,
      });
      if (error) {
        return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, {
          retryable: true,
          compatibilityFields: { fallback: "text" },
        });
      }
      if (data === false) {
        return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, {
          compatibilityFields: { fallback: "text", remaining: 0, remainingMinutes: 0 },
        });
      }
    } catch {
      return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, {
        retryable: true,
        compatibilityFields: { fallback: "text" },
      });
    }
  } else {
    meter.reservations += 1;
    usage.set(userId, meter);
  }

  const overrides = buildPalVoiceOverrides(pal);

  let providerAllocated = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", agentId);
    url.searchParams.set("include_conversation_id", "true");
    const response = await fetch(url, {
      headers: { "xi-api-key": apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return publicApiError("Voice service is temporarily unavailable.", "PROVIDER_UNAVAILABLE", 502, {
        retryable: true,
        compatibilityFields: { fallback: "text" },
      });
    }
    const payload = await response.json() as { signed_url?: string };
    if (!payload.signed_url) {
      return publicApiError("Voice service returned no session.", "PROVIDER_UNAVAILABLE", 502, {
        retryable: true,
        compatibilityFields: { fallback: "text" },
      });
    }
    providerAllocated = true;
    const remainingMinutes = supabaseConfigured ? null : remainingVoiceMinutes(meter);
    return jsonNoStore({
      signedUrl: payload.signed_url,
      connectionType: "websocket",
      overrides,
      maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
      remaining: remainingMinutes,
      remainingMinutes,
      retention: "zero",
      mutationPolicy: "propose_then_confirm",
    });
  } catch {
    return publicApiError("Voice service did not respond in time.", "PROVIDER_TIMEOUT", 504, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  } finally {
    clearTimeout(timeout);
    if (!providerAllocated) {
      await releaseVoiceReservation(admin, userId, usageMonth, meter, 0);
    }
  }
}

/**
 * Voice availability, so the browser can explain itself before the tap.
 *
 * Reads no account and allocates nothing, so it needs no session: it answers
 * one boolean about this deployment's own configuration.
 */
export async function GET(): Promise<Response> {
  return jsonNoStore({
    available: palVoiceConfigured(),
    maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
    retention: "zero",
    mutationPolicy: "propose_then_confirm",
  });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-voice-token:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to talk with your Pub Pal.", "UNAUTHENTICATED", 401);

  let body: VoiceTokenBody = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw) as VoiceTokenBody;
  } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }

  if (body.action === "release") return handleRelease(request, userId, body);
  return handleIssueToken(userId);
}
