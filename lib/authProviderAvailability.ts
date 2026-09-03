import { withAuthFetchTimeout } from "@/lib/authFetch";
import { clerkFrontendApiOrigin } from "@/lib/clerkIdentity";

export type SocialAuthProvider = "google" | "apple";

export type SocialAuthProviderAvailability = Record<SocialAuthProvider, boolean>;

export const NO_SOCIAL_AUTH_PROVIDERS: SocialAuthProviderAvailability = {
  google: false,
  apple: false,
};

type AuthStartResult = { error: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function availabilityFromClerkEnvironment(
  environment: unknown,
): SocialAuthProviderAvailability | null {
  if (!isRecord(environment) || !isRecord(environment.userSettings)) return null;
  const social = environment.userSettings.social;
  if (!isRecord(social)) return null;

  const enabledStrategies = new Set(
    Object.entries(social).flatMap(([key, value]) => {
      if (!isRecord(value) || value.enabled !== true) return [];
      return [typeof value.strategy === "string" ? value.strategy : key];
    }),
  );

  return {
    google: enabledStrategies.has("oauth_google"),
    apple: enabledStrategies.has("oauth_apple"),
  };
}

/**
 * Read Supabase Auth's public provider settings. Unknown is distinct from an
 * all-disabled response so callers can fail closed without claiming the read
 * succeeded.
 */
export async function loadSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SocialAuthProviderAvailability | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return null;

  let settingsUrl: string;
  try {
    settingsUrl = new URL("/auth/v1/settings", supabaseUrl).toString();
  } catch {
    return null;
  }

  try {
    const response = await withAuthFetchTimeout(fetchImpl)(settingsUrl, {
      cache: "no-store",
      headers: { apikey: publishableKey },
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.external)) return null;

    return {
      google: payload.external.google === true,
      apple: payload.external.apple === true,
    };
  } catch {
    return null;
  }
}

/**
 * Read Clerk's public instance environment for enabled OAuth strategies. Clerk
 * exposes the configured social set through user_settings.social, so provider
 * availability follows dashboard changes without a second application list.
 */
export async function loadClerkSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
  clerkEnvironment?: unknown,
): Promise<SocialAuthProviderAvailability | null> {
  if (clerkEnvironment !== undefined) {
    return availabilityFromClerkEnvironment(clerkEnvironment);
  }

  const frontendApi = clerkFrontendApiOrigin();
  if (!frontendApi) return null;

  let environmentUrl: string;
  try {
    environmentUrl = new URL("/v1/environment", frontendApi).toString();
  } catch {
    return null;
  }

  try {
    const response = await withAuthFetchTimeout(fetchImpl)(environmentUrl, {
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return availabilityFromClerkEnvironment(
      isRecord(payload) && isRecord(payload.user_settings)
        ? { userSettings: payload.user_settings }
        : null,
    );
  } catch {
    return null;
  }
}

function unavailableMessage(provider: SocialAuthProvider): string {
  const name = provider === "google" ? "Google" : "Apple";
  return `${name} sign-in isn't available right now. Use email instead.`;
}

/**
 * Recheck the selected provider immediately before OAuth starts. This closes
 * the stale-page gap where a provider can be disabled after initial render.
 */
export async function guardSocialAuthProvider(
  provider: SocialAuthProvider,
  start: () => Promise<AuthStartResult>,
  load: () => Promise<SocialAuthProviderAvailability | null> =
    loadSocialAuthProviders,
): Promise<{
  availability: SocialAuthProviderAvailability | null;
  result: AuthStartResult;
}> {
  let availability: SocialAuthProviderAvailability | null = null;
  try {
    availability = await load();
  } catch {
    availability = null;
  }

  if (!availability?.[provider]) {
    return {
      availability,
      result: { error: unavailableMessage(provider) },
    };
  }

  return {
    availability,
    result: await start(),
  };
}
