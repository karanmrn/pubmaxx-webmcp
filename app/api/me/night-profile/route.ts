import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { cleanNightProfileInput } from "@/lib/nightProfile";
import { nightProfileStore } from "@/lib/nightProfileStore";
import { isLimited } from "@/lib/pintDrops";
import { getPubPalResult } from "@/lib/pubPalStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

const WINDOW_MS = 60_000;

async function owner(request: Request): Promise<string | Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) {
    return publicApiError(
      "Sign in to manage your Night Profile.",
      "AUTH_REQUIRED",
      401,
    );
  }
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Night Profile storage is not configured.",
      "NIGHT_PROFILE_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  return ownerId;
}

async function rateLimited(request: Request, ownerId: string, action: "read" | "write") {
  const key = `night-profile:${action}:${ownerId}:${hashIp(clientIp(request))}`;
  return isLimited(key, key, action === "read" ? 60 : 30, WINDOW_MS);
}

export async function GET(request: Request): Promise<Response> {
  const resolved = await owner(request);
  if (resolved instanceof Response) return resolved;
  if (await rateLimited(request, resolved, "read")) {
    return publicApiError(
      "Too many Night Profile requests. Try again shortly.",
      "NIGHT_PROFILE_RATE_LIMITED",
      429,
      { retryable: true },
    );
  }
  try {
    return jsonNoStore({ profile: await nightProfileStore().get(resolved) });
  } catch {
    return publicApiError(
      "Your Night Profile is temporarily unavailable.",
      "NIGHT_PROFILE_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  const resolved = await owner(request);
  if (resolved instanceof Response) return resolved;
  if (await rateLimited(request, resolved, "write")) {
    return publicApiError(
      "Too many Night Profile updates. Try again shortly.",
      "NIGHT_PROFILE_RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }
  const profile = cleanNightProfileInput(body.profile);
  const expectedUpdatedAt = body.expectedUpdatedAt;
  if (
    !profile ||
    !(
      expectedUpdatedAt === null ||
      (typeof expectedUpdatedAt === "string" && Number.isFinite(Date.parse(expectedUpdatedAt)))
    )
  ) {
    return publicApiError(
      "Add a valid versioned Night Profile and expected update time.",
      "INVALID_NIGHT_PROFILE",
      400,
    );
  }

  if (profile.pubPalId) {
    const pal = await getPubPalResult(resolved);
    if (!pal.ok) {
      return publicApiError(
        "Pub Pal ownership could not be checked.",
        "NIGHT_PROFILE_STORE_UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
    if (!pal.value || pal.value.id !== profile.pubPalId) {
      return publicApiError(
        "Choose a Pub Pal owned by this account.",
        "NIGHT_PROFILE_PAL_FORBIDDEN",
        403,
      );
    }
  }

  try {
    const result = await nightProfileStore().put(resolved, profile, expectedUpdatedAt);
    if (!result.ok) {
      return publicApiError(
        "Your Night Profile changed on another tab. Review it before saving again.",
        "NIGHT_PROFILE_CONFLICT",
        409,
        { details: { currentProfile: result.current } },
      );
    }
    return jsonNoStore({ profile: result.profile });
  } catch {
    return publicApiError(
      "Your Night Profile could not be saved.",
      "NIGHT_PROFILE_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
