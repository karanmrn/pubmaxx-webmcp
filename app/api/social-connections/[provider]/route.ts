import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { socialConnectionStore } from "@/lib/socialConnectionStore";
import {
  isSocialOAuthProvider,
  isSocialProvider,
  publicSocialConnection,
  validateSocialLink,
} from "@/lib/socialConnections";
import { createSocialOAuthStart, socialProviderAvailability } from "@/lib/socialOAuth";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { siteOrigin } from "@/lib/siteUrl";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";

assertServerEnv();

type Context = { params: Promise<{ provider: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to connect an account.", "AUTH_REQUIRED", 401);
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return publicApiError("That social service is not available.", "SOCIAL_PROVIDER_NOT_FOUND", 404);
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }

  if (body.mode === "manual") {
    if (!socialProviderAvailability()[provider].manual_link) {
      return publicApiError("Manual connection is unavailable for this provider.", "SOCIAL_PROVIDER_MODE_UNAVAILABLE", 400);
    }
    const manualKey = `social-link:${ownerId}:${hashIp(clientIp(request))}`;
    if (await isLimited(manualKey, manualKey, 30, 10 * 60_000)) {
      return publicApiError("Too many changes. Try again shortly.", "SOCIAL_CONNECTION_RATE_LIMITED", 429, { retryable: true });
    }
    // `value` takes a username or a pasted profile link; validateSocialLink
    // lands both on one canonical URL.
    const validated = validateSocialLink({
      provider,
      value: typeof body.value === "string" ? body.value : body.profileUrl,
    });
    if (!validated.ok) return publicApiError(validated.error, "INVALID_SOCIAL_PROFILE", 400);
    try {
      const row = await socialConnectionStore().saveManual(ownerId, {
        provider,
        username: validated.username,
        profileUrl: validated.profileUrl,
      });
      return jsonNoStore({ connection: publicSocialConnection(row) }, { status: 201 });
    } catch {
      return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
    }
  }

  try {
    if (!isSocialOAuthProvider(provider) || !socialProviderAvailability()[provider].oauth_identity) {
      return publicApiError("That social connection is not configured.", "SOCIAL_PROVIDER_UNAVAILABLE", 503, { retryable: false });
    }
    const rateKey = `social-oauth:${ownerId}:${hashIp(clientIp(request))}`;
    if (await isLimited(rateKey, rateKey, 10, 10 * 60_000)) {
      return publicApiError("Too many connection attempts. Try again shortly.", "SOCIAL_CONNECTION_RATE_LIMITED", 429, { retryable: true });
    }
    const origin = siteOrigin(request.url);
    if (!origin) throw new Error("Site URL is invalid.");
    return jsonNoStore(await createSocialOAuthStart({ ownerId, provider, origin }));
  } catch (error) {
    return publicApiError(error instanceof Error ? error.message : "OAuth is unavailable.", "SOCIAL_PROVIDER_UNAVAILABLE", 503, { retryable: true });
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to disconnect an account.", "AUTH_REQUIRED", 401);
  const provider = (await context.params).provider;
  if (!isSocialProvider(provider)) return publicApiError("That social service is not available.", "SOCIAL_PROVIDER_NOT_FOUND", 404);
  const rateKey = `social-unlink:${ownerId}:${hashIp(clientIp(request))}`;
  if (await isLimited(rateKey, rateKey, 30, 10 * 60_000)) {
    return publicApiError("Too many changes. Try again shortly.", "SOCIAL_CONNECTION_RATE_LIMITED", 429, { retryable: true });
  }
  try {
    await socialConnectionStore().disconnect(ownerId, provider);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return publicApiError("Connected accounts are unavailable.", "SOCIAL_CONNECTIONS_UNAVAILABLE", 503, { retryable: true });
  }
}
