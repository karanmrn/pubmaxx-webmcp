import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => false,
  requireSupabaseAdmin: () => { throw new Error("not configured"); },
}));

import {
  completeSocialOAuth,
  createSocialOAuthStart,
  readSocialOAuthState,
  socialProviderAvailability,
} from "@/lib/socialOAuth";

describe("social OAuth state", () => {
  afterEach(() => {
    delete process.env.X_CLIENT_ID;
    delete process.env.X_CLIENT_SECRET;
    delete process.env.INSTAGRAM_CLIENT_ID;
    delete process.env.INSTAGRAM_CLIENT_SECRET;
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    delete process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY;
  });

  it("refuses OAuth before provider certification even when credentials exist", async () => {
    process.env.X_CLIENT_ID = "client-id";
    process.env.X_CLIENT_SECRET = "client-secret";
    process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY = "e".repeat(32);
    await expect(
      createSocialOAuthStart({
        ownerId: "user-1",
        provider: "x",
        origin: "https://pubmaxxing.com",
      }),
    ).rejects.toThrow("x OAuth is not configured");
    await expect(readSocialOAuthState("unused", "x")).rejects.toThrow(
      "Expired or mismatched OAuth state",
    );
    await expect(
      completeSocialOAuth({ provider: "x", code: "code", state: "stale-state" }),
    ).rejects.toThrow("x OAuth is not certified");
  });

  it("does not let environment credentials grant an uncertified capability", () => {
    process.env.X_CLIENT_ID = "x-id";
    process.env.X_CLIENT_SECRET = "x-secret";
    process.env.INSTAGRAM_CLIENT_ID = "instagram-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "instagram-secret";

    // Manual is never gated on an app registration: typing your own handle
    // needs nobody's client id. Only the OAuth arm waits on configuration.
    expect(socialProviderAvailability()).toMatchObject({
      x: { oauth_identity: false, manual_link: true },
      instagram: { oauth_identity: false, manual_link: true },
      tiktok: { oauth_identity: false, manual_link: true },
      letterboxd: { oauth_identity: false, manual_link: true },
      website: { oauth_identity: false, manual_link: true },
    });

    process.env.SOCIAL_CONNECTION_ENCRYPTION_KEY = "e".repeat(32);
    expect(socialProviderAvailability()).toMatchObject({
      x: { oauth_identity: false },
      instagram: { oauth_identity: false, manual_link: true },
      tiktok: { oauth_identity: false },
      letterboxd: { oauth_identity: false, manual_link: true },
    });
  });
});
