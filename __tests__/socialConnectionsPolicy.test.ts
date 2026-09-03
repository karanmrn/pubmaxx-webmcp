import { describe, expect, it } from "vitest";

import {
  publicSocialConnection,
  publicSocialLinks,
  SOCIAL_OAUTH_PROVIDERS,
  SOCIAL_PROVIDERS,
  isSocialOAuthProvider,
  validateSocialLink,
  type SocialProvider,
  type StoredSocialConnection,
} from "@/lib/socialConnections";

function stored(
  provider: SocialProvider,
  overrides: Partial<StoredSocialConnection> = {},
): StoredSocialConnection {
  return {
    id: `connection-${provider}`,
    ownerId: "user-1",
    provider,
    mode: "manual",
    accountKind: "personal",
    username: "nightowl",
    profileUrl: `https://example.test/${provider}`,
    scopes: [],
    refreshStatus: "not_applicable",
    consentVersion: "manual-link-v1",
    upstreamRevocationState: "not_applicable",
    connectedAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("linkable social providers", () => {
  it("keeps OAuth as a strict subset of what a person may link", () => {
    for (const provider of SOCIAL_OAUTH_PROVIDERS) {
      expect(SOCIAL_PROVIDERS).toContain(provider);
      expect(isSocialOAuthProvider(provider)).toBe(true);
    }
    // A provider nobody registered an OAuth app for is still linkable by hand.
    for (const provider of ["youtube", "letterboxd", "spotify", "snapchat", "strava", "linkedin", "website"]) {
      expect(SOCIAL_PROVIDERS).toContain(provider as SocialProvider);
      expect(isSocialOAuthProvider(provider)).toBe(false);
    }
  });
});

describe("per-platform link validation", () => {
  const cases: Array<{
    provider: SocialProvider;
    typed: string;
    pasted: string;
    username: string;
    profileUrl: string;
  }> = [
    {
      provider: "x",
      typed: "@night_owl",
      pasted: "https://twitter.com/night_owl",
      username: "night_owl",
      profileUrl: "https://x.com/night_owl",
    },
    {
      provider: "instagram",
      typed: "@night.owl",
      pasted: "https://www.instagram.com/night.owl/",
      username: "night.owl",
      profileUrl: "https://www.instagram.com/night.owl/",
    },
    {
      provider: "tiktok",
      typed: "nightowl",
      pasted: "https://www.tiktok.com/@nightowl",
      username: "nightowl",
      profileUrl: "https://www.tiktok.com/@nightowl",
    },
    {
      provider: "youtube",
      typed: "@nightowl",
      pasted: "https://www.youtube.com/@nightowl",
      username: "nightowl",
      profileUrl: "https://www.youtube.com/@nightowl",
    },
    {
      provider: "letterboxd",
      typed: "nightowl",
      pasted: "https://letterboxd.com/nightowl/",
      username: "nightowl",
      profileUrl: "https://letterboxd.com/nightowl/",
    },
    {
      provider: "spotify",
      typed: "nightowl",
      pasted: "https://open.spotify.com/user/nightowl?si=abc",
      username: "nightowl",
      profileUrl: "https://open.spotify.com/user/nightowl",
    },
    {
      provider: "snapchat",
      typed: "night.owl",
      pasted: "https://www.snapchat.com/add/night.owl",
      username: "night.owl",
      profileUrl: "https://www.snapchat.com/add/night.owl",
    },
    {
      provider: "strava",
      typed: "12345678",
      pasted: "https://www.strava.com/athletes/12345678",
      username: "12345678",
      profileUrl: "https://www.strava.com/athletes/12345678",
    },
    {
      provider: "linkedin",
      typed: "night-owl",
      pasted: "https://uk.linkedin.com/in/night-owl",
      username: "night-owl",
      profileUrl: "https://www.linkedin.com/in/night-owl",
    },
  ];

  it("lands a typed handle and a pasted link on the same canonical URL", () => {
    for (const entry of cases) {
      expect(validateSocialLink({ provider: entry.provider, value: entry.typed })).toEqual({
        ok: true,
        username: entry.username,
        profileUrl: entry.profileUrl,
      });
      expect(validateSocialLink({ provider: entry.provider, value: entry.pasted })).toEqual({
        ok: true,
        username: entry.username,
        profileUrl: entry.profileUrl,
      });
    }
  });

  it("refuses another platform's link and a username the platform cannot hold", () => {
    // A host that is not this platform is never accepted, however plausible.
    expect(
      validateSocialLink({ provider: "instagram", value: "https://evil.example/night.owl" }),
    ).toMatchObject({ ok: false });
    expect(
      validateSocialLink({ provider: "x", value: "https://www.instagram.com/night.owl/" }),
    ).toMatchObject({ ok: false });
    // Shape is per platform: X caps at 15 characters, Letterboxd forbids dots.
    expect(
      validateSocialLink({ provider: "x", value: "@sixteencharacter" }),
    ).toMatchObject({ ok: false });
    expect(
      validateSocialLink({ provider: "letterboxd", value: "night.owl" }),
    ).toMatchObject({ ok: false });
    // A TikTok link without the @ segment is not a TikTok profile.
    expect(
      validateSocialLink({ provider: "tiktok", value: "https://www.tiktok.com/nightowl" }),
    ).toMatchObject({ ok: false });
    expect(validateSocialLink({ provider: "x", value: "" })).toMatchObject({ ok: false });
    expect(validateSocialLink({ provider: "x", value: 42 })).toMatchObject({ ok: false });
  });

  it("takes a website as a free address, http or https only", () => {
    expect(validateSocialLink({ provider: "website", value: "https://nightowl.co.uk/about" })).toEqual({
      ok: true,
      username: "nightowl.co.uk",
      profileUrl: "https://nightowl.co.uk/about",
    });
    expect(validateSocialLink({ provider: "website", value: "nightowl.co.uk" })).toEqual({
      ok: true,
      username: "nightowl.co.uk",
      profileUrl: "https://nightowl.co.uk/",
    });
    for (const bad of ["javascript:alert(1)", "mailto:someone@example.com", "not a url"]) {
      expect(validateSocialLink({ provider: "website", value: bad })).toMatchObject({ ok: false });
    }
  });
});

describe("public projections", () => {
  it("never exposes OAuth credentials in the public connection projection", () => {
    const row = stored("tiktok", {
      mode: "oauth",
      accountKind: "professional",
      providerAccountId: "open-id-1",
      profileUrl: "https://www.tiktok.com/@nightowl",
      scopes: ["user.info.basic"],
      accessTokenCiphertext: "secret-access-token",
      refreshTokenCiphertext: "secret-refresh-token",
      refreshStatus: "current",
      consentVersion: "oauth-identity-v1",
      upstreamRevocationState: "active",
      // Keep this projection test independent of the wall clock. Expiry
      // behavior has its own tests; this fixture exercises secret redaction.
      tokenExpiresAt: "2099-07-16T12:00:00.000Z",
    });

    const projected = publicSocialConnection(row);
    expect(projected).toEqual({
      provider: "tiktok",
      mode: "oauth",
      accountKind: "professional",
      status: "connected",
      username: "nightowl",
      profileUrl: "https://www.tiktok.com/@nightowl",
      scopes: ["user.info.basic"],
      connectedAt: "2026-07-15T12:00:00.000Z",
      updatedAt: "2026-07-15T12:00:00.000Z",
    });
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(JSON.stringify(projected)).not.toContain("providerAccountId");
  });

  it("requires action for an uncertified legacy OAuth grant", () => {
    const projected = publicSocialConnection(stored("instagram", {
      mode: "oauth",
      accessTokenCiphertext: "encrypted-token",
      refreshStatus: "refresh_due",
      consentVersion: "legacy-oauth-v1",
      upstreamRevocationState: "unknown",
      tokenExpiresAt: "2099-07-16T12:00:00.000Z",
    }));

    expect(projected.status).toBe("action_required");
    expect(JSON.stringify(projected)).not.toContain("legacy-oauth-v1");
  });

  it("gives a public card the link and nothing else about the connection", () => {
    const links = publicSocialLinks([
      stored("letterboxd", { profileUrl: "https://letterboxd.com/nightowl/" }),
      stored("x", {
        mode: "oauth",
        providerAccountId: "x-id-1",
        accessTokenCiphertext: "secret-access-token",
        scopes: ["users.read"],
        profileUrl: "https://x.com/nightowl",
      }),
      // No link to follow, so nothing to print.
      stored("spotify", { profileUrl: undefined }),
    ]);

    expect(links.map((link) => link.provider)).toEqual(["x", "letterboxd"]);
    expect(links[0]).toEqual({
      provider: "x",
      label: "X",
      mark: "X",
      username: "nightowl",
      profileUrl: "https://x.com/nightowl",
    });
    const raw = JSON.stringify(links);
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("scopes");
    expect(raw).not.toContain("accountKind");
    expect(raw).not.toContain("ownerId");
  });
});
