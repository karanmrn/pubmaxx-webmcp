import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  verification: { status: "absent" } as
    | { status: "absent" }
    | { status: "invalid" }
    | { status: "unavailable" },
}));

vi.mock("@/lib/authServer", () => ({
  verifyCallerAuth: async () => authState.verification,
}));

vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({
    getByUserId: async () => {
      throw new Error("profile lookup should not run");
    },
  }),
}));

vi.mock("@/lib/privateIdentityStore", () => ({
  privateIdentityStore: () => ({
    read: async () => {
      throw new Error("private identity lookup should not run");
    },
  }),
}));

vi.mock("@/lib/identityHandleStore", () => ({
  identityHandleStore: () => ({
    resolve: async () => {
      throw new Error("handle lookup should not run");
    },
  }),
}));

import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";

const request = new Request("http://localhost/api/contribution");

beforeEach(() => {
  authState.verification = { status: "absent" };
});

describe("resolveContributionIdentity auth verification", () => {
  it("rejects an absent token", async () => {
    await expect(resolveContributionIdentity(request)).resolves.toEqual({
      ok: false,
      body: {
        status: "sign_in_required",
        error: "Sign in to contribute.",
      },
      httpStatus: 401,
    });
  });

  it("rejects a verified-invalid token", async () => {
    authState.verification = { status: "invalid" };

    await expect(resolveContributionIdentity(request)).resolves.toEqual({
      ok: false,
      body: {
        status: "sign_in_required",
        error: "Sign in to contribute.",
      },
      httpStatus: 401,
    });
  });

  it("returns retryable 503 when verification is unavailable", async () => {
    authState.verification = { status: "unavailable" };

    await expect(resolveContributionIdentity(request)).resolves.toEqual({
      ok: false,
      body: {
        code: "AUTH_VERIFICATION_UNAVAILABLE",
        error: "Sign-in verification is unavailable right now. Try again.",
        retryable: true,
      },
      httpStatus: 503,
    });
  });
});
