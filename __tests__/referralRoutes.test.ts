import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  id: null as string | null,
  createdAt: null as string | null,
}));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.id,
    callerAuthIdentity: async () =>
      authState.id
        ? { id: authState.id, email: "person@example.com", createdAt: authState.createdAt }
        : null,
  };
});

import { POST as claimAttribution } from "@/app/api/referrals/claim-attribution/route";
import { POST as inviteLink } from "@/app/api/referrals/invite-link/route";
import { GET as referralStatus } from "@/app/api/referrals/status/route";
import { GET as followInvite } from "@/app/r/[code]/route";
import { mintReferralSignupProof } from "@/lib/referralSignupProof.server";
import {
  __resetMemoryReferrals,
  memoryReferralStore,
} from "@/lib/referralStore";

const ORIGIN = "https://pubmaxxing.com";
const START = Date.parse("2026-07-28T10:00:00.000Z");

function request(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  authState.id = null;
  authState.createdAt = null;
  __resetMemoryReferrals();
  vi.useRealTimers();
});

describe("referral routes", () => {
  it("blocks invite-link minting during the full Social rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";
    authState.id = "inviter-private";

    const response = await inviteLink(
      request("/api/referrals/invite-link", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Social is in preview right now.",
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
  });

  it("blocks signup attribution during the full Social rollback", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";
    authState.id = "new-account";

    const response = await claimAttribution(
      request("/api/referrals/claim-attribution", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Social is in preview right now.",
      code: "SOCIAL_PREVIEW",
      retryable: false,
    });
  });

  it("rejects account APIs without verified auth", async () => {
    expect((await inviteLink(request("/api/referrals/invite-link", { method: "POST" }))).status).toBe(401);
    expect((await referralStatus(request("/api/referrals/status"))).status).toBe(401);
    const response = await claimAttribution(
      request("/api/referrals/claim-attribution", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to record an invite.",
      code: "AUTH_REQUIRED",
      retryable: false,
    });
  });

  it("creates an opaque account-owned invite link without returning an account id", async () => {
    authState.id = "inviter-private";
    authState.createdAt = new Date(START - 10_000).toISOString();

    const response = await inviteLink(
      request("/api/referrals/invite-link", { method: "POST" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.url).toMatch(/^https:\/\/pubmaxxing\.com\/r\/[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(body)).not.toContain("inviter-private");
  });

  it("redirects with the invite code and writes no attribution state", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const response = await followInvite(
      request(`/r/${code}`),
      { params: Promise.resolve({ code }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/#referral=${code}`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("records attribution directly from a code for a new account", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const authAttemptId = "a".repeat(32);
    const signupProof = mintReferralSignupProof(authAttemptId, START - 2_000);
    authState.id = "new-account";
    authState.createdAt = new Date(START - 1_000).toISOString();
    const claimed = await claimAttribution(
      request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, authAttemptId, signupProof }),
      }),
    );

    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ attributed: true });
    expect(claimed.headers.get("set-cookie")).toBeNull();
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
    });
  });

  it("does not credit an existing account from an invite code", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const authAttemptId = "a".repeat(32);
    const signupProof = mintReferralSignupProof(
      authAttemptId,
      START - 60 * 1_000,
    );
    authState.id = "old-account";
    authState.createdAt = new Date(START - 30 * 60 * 1_000).toISOString();

    const response = await claimAttribution(
      request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, authAttemptId, signupProof }),
      }),
    );
    expect(await response.json()).toEqual({
      attributed: false,
      reason: "account_not_new",
    });
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
    });
  });

  it("rejects a claim without the server-minted callback proof", async () => {
    vi.setSystemTime(START);
    const { code } = await memoryReferralStore.getOrCreateInviteCode("inviter");
    const authAttemptId = "a".repeat(32);
    const signupProof = mintReferralSignupProof(authAttemptId, START - 2_000);
    authState.id = "new-account";
    authState.createdAt = new Date(START - 1_000).toISOString();

    const response = await claimAttribution(
      request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          authAttemptId,
          signupProof: `${signupProof}x`,
        }),
      }),
    );

    expect(await response.json()).toEqual({
      attributed: false,
      reason: "invalid_signup_proof",
    });
    expect(await memoryReferralStore.privateStatus("inviter")).toMatchObject({
      attributedCount: 0,
    });
  });

  it("returns only aggregate viewer-owned status", async () => {
    authState.id = "inviter-secret";
    authState.createdAt = new Date(START).toISOString();
    await memoryReferralStore.recordEdge("inviter-secret", "invitee-secret", START);

    const response = await referralStatus(request("/api/referrals/status"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      attributedCount: 1,
      qualifiedCount: 0,
      mark: null,
    });
    // Recognition only. The route answers no entitlement of any kind, so a
    // caller has nothing here to branch a capability on.
    expect(Object.keys(body).sort()).toEqual([
      "attributedCount",
      "earned",
      "mark",
      "nextMilestone",
      "qualifiedCount",
    ]);
    expect(JSON.stringify(body)).not.toContain("inviter-secret");
    expect(JSON.stringify(body)).not.toContain("invitee-secret");
  });
});
