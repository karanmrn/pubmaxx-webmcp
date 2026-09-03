import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardSocialAuthProvider,
  loadClerkSocialAuthProviders,
  loadSocialAuthProviders,
} from "@/lib/authProviderAvailability";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function settingsResponse(external: Record<string, boolean>): Response {
  return new Response(JSON.stringify({ external }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clerkEnvironmentResponse(
  social: Record<string, Record<string, unknown>>,
): Response {
  return new Response(JSON.stringify({ user_settings: { social } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function clerkPublishableKey(): string {
  return `pk_test_${Buffer.from("rare-trout-29.clerk.accounts.dev$").toString("base64")}`;
}

describe("Clerk social auth provider availability", () => {
  it("prefers the Clerk SDK environment over a direct request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      loadClerkSocialAuthProviders(fetchImpl, {
        userSettings: {
          social: {
            oauth_google: { enabled: true, strategy: "oauth_google" },
          },
        },
      }),
    ).resolves.toEqual({ google: true, apple: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads enabled social strategies from Clerk's environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      clerkEnvironmentResponse({
        oauth_google: { enabled: true, strategy: "oauth_google" },
        oauth_apple: { enabled: false, strategy: "oauth_apple" },
      }),
    );

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://rare-trout-29.clerk.accounts.dev/v1/environment",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("shows Apple automatically when Clerk enables oauth_apple", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      clerkEnvironmentResponse({
        oauth_google: { enabled: true },
        oauth_apple: { enabled: true },
      }),
    );

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: true,
    });
  });

  it.each([
    ["an HTTP failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))],
    ["a network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))],
    [
      "a malformed payload",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ user_settings: { social: null } }), { status: 200 }),
      ),
    ],
  ])("fails closed for %s", async (_label, fetchImpl) => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", clerkPublishableKey());

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toBeNull();
  });

  it("does not request Clerk environment when its publishable key is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadClerkSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Supabase social auth provider availability", () => {
  it("reads live settings with the public key and maps Google and Apple", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      settingsResponse({
        google: true,
        apple: false,
        email: true,
      }),
    );

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: true,
      apple: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/settings",
      expect.objectContaining({
        cache: "no-store",
        headers: { apikey: "publishable-key" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports Apple from Supabase's Apple provider flag", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      settingsResponse({
        google: false,
        apple: true,
        email: true,
      }),
    );

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toEqual({
      google: false,
      apple: true,
    });
  });

  it.each([
    ["an HTTP failure", vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))],
    ["a network failure", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))],
    [
      "a malformed payload",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ external: null }), { status: 200 }),
      ),
    ],
  ])("fails closed for %s", async (_label, fetchImpl) => {
    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toBeNull();
  });

  it("does not request settings when browser auth configuration is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(loadSocialAuthProviders(fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("social OAuth provider guard", () => {
  it("does not start Google OAuth when live settings disable it", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider(
        "google",
        start,
        async () => ({ google: false, apple: false }),
      ),
    ).resolves.toEqual({
      availability: { google: false, apple: false },
      result: {
        error: "Google sign-in isn't available right now. Use email instead.",
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start Apple OAuth when provider settings cannot be read", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider("apple", start, async () => null),
    ).resolves.toEqual({
      availability: null,
      result: {
        error: "Apple sign-in isn't available right now. Use email instead.",
      },
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("starts OAuth only after fresh settings enable the selected provider", async () => {
    const start = vi.fn().mockResolvedValue({ error: null });

    await expect(
      guardSocialAuthProvider(
        "google",
        start,
        async () => ({ google: true, apple: false }),
      ),
    ).resolves.toEqual({
      availability: { google: true, apple: false },
      result: { error: null },
    });
    expect(start).toHaveBeenCalledOnce();
  });
});
