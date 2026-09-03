import { describe, expect, it, vi } from "vitest";

import {
  requireVerifiedSocialActor,
  resolveSocialAccess,
  type SocialAccessServerDependencies,
} from "@/lib/socialAccessServer";

const USER_ID = "44444444-4444-4444-8444-444444444444";

function dependencies(
  overrides: Partial<SocialAccessServerDependencies> = {},
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: true,
    now: () => new Date("2026-08-29T20:00:00.000Z"),
    verifySupabaseSession: async () => ({ status: "verified", userId: USER_ID }),
    readFriendsLaunchAccess: async () => ({
      account: {
        id: "account-1",
        ownershipState: "active",
      },
      profile: { id: "profile-1", handle: "alice" },
      dateOfBirth: "1990-01-01",
    }),
    ...overrides,
  };
}

describe("server Social access resolution", () => {
  it("returns preview without identity work during explicit rollback", async () => {
    const verify = vi.fn(async () => ({ status: "verified" as const, userId: USER_ID }));
    await expect(resolveSocialAccess(undefined, dependencies({
      friendsLaunchEnabled: false,
      verifySupabaseSession: verify,
    }))).resolves.toEqual({ available: true, state: "preview" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("requires a Supabase session before reading account state", async () => {
    const readAccess = vi.fn(async () => {
      throw new Error("must not run");
    });
    await expect(resolveSocialAccess(undefined, dependencies({
      verifySupabaseSession: async () => ({ status: "absent" }),
      readFriendsLaunchAccess: readAccess,
    }))).resolves.toEqual({ available: true, state: "sign_in_required" });
    expect(readAccess).not.toHaveBeenCalled();
  });

  it("returns a verified actor from Supabase identity and onboarding DOB", async () => {
    await expect(resolveSocialAccess(undefined, dependencies())).resolves.toEqual({
      available: true,
      state: "verified",
      actor: { accountId: "account-1", profileId: "profile-1", handle: "alice" },
    });
    await expect(requireVerifiedSocialActor(undefined, dependencies())).resolves.toEqual({
      ok: true,
      actor: { accountId: "account-1", profileId: "profile-1", handle: "alice" },
    });
  });

  it("fails closed when Supabase session checking is unavailable", async () => {
    await expect(resolveSocialAccess(undefined, dependencies({
      verifySupabaseSession: async () => ({ status: "unavailable" }),
    }))).resolves.toMatchObject({
      available: false,
      code: "SOCIAL_ACCESS_UNAVAILABLE",
      retryable: true,
    });
  });

  it("offers one adult tap only for a claimed handle with no age answer", async () => {
    await expect(resolveSocialAccess(undefined, dependencies({
      readFriendsLaunchAccess: async () => ({
        account: { id: "account-1", ownershipState: "active" },
        profile: { id: "profile-1", handle: "night_owl" },
        dateOfBirth: null,
        adultSelfAssertedAt: null,
      }),
    }))).resolves.toMatchObject({
      available: true,
      state: "age_verification_required",
      adultPrompt: true,
    });
  });

  it("does not offer the adult tap before a handle is claimed", async () => {
    await expect(resolveSocialAccess(undefined, dependencies({
      readFriendsLaunchAccess: async () => ({
        account: null,
        profile: null,
        dateOfBirth: null,
      }),
    }))).resolves.toEqual({
      available: true,
      state: "age_verification_required",
      adultPrompt: false,
    });
  });

  it("maps suspended accounts to a protected-route refusal", async () => {
    const result = await requireVerifiedSocialActor(undefined, dependencies({
      readFriendsLaunchAccess: async () => ({
        account: {
          id: "account-1",
          ownershipState: "suspended",
        },
        profile: { id: "profile-1", handle: "alice" },
        dateOfBirth: "1990-01-01",
      }),
    }));
    expect(result).toMatchObject({
      ok: false,
      status: 403,
      code: "SOCIAL_ACCOUNT_SUSPENDED",
      error: "Social access is suspended.",
    });
  });

  it("fails closed when private Social storage is unavailable", async () => {
    await expect(resolveSocialAccess(undefined, dependencies({
      readFriendsLaunchAccess: async () => {
        throw new Error("offline");
      },
    }))).resolves.toMatchObject({
      available: false,
      code: "SOCIAL_ACCESS_UNAVAILABLE",
    });
  });
});
