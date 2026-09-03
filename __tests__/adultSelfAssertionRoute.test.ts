import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

import { POST } from "@/app/api/identity/adult-assertion/route";
import {
  __resetMemoryAdultSelfAssertions,
  adultSelfAssertionStore,
} from "@/lib/adultSelfAssertionStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { accountIsAdult, isRecordedAdultAssertion } from "@/lib/socialLaunch";

function request(): Request {
  return new Request("http://localhost/api/identity/adult-assertion", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.7" },
  });
}

beforeEach(() => {
  authState.userId = null;
  __resetMemoryAdultSelfAssertions();
  __resetPintDrops();
});

describe("/api/identity/adult-assertion", () => {
  it("requires a verified account", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHENTICATED",
      error: "Sign in to confirm your age.",
    });
  });

  it("records the tap against the caller's own account and passes the gate", async () => {
    authState.userId = "user-claim-path";
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assertedAt?: string };
    expect(isRecordedAdultAssertion(body.assertedAt)).toBe(true);

    const stored = await adultSelfAssertionStore().read("user-claim-path");
    expect(stored).toBe(body.assertedAt);
    // No date of birth anywhere, and the account is admitted.
    expect(
      accountIsAdult({ dateOfBirth: null, adultSelfAssertedAt: stored }),
    ).toBe(true);
    // Nobody else is asserted by it.
    await expect(
      adultSelfAssertionStore().read("user-other"),
    ).resolves.toBeNull();
  });

  it("keeps the first instant when the same account taps twice", async () => {
    authState.userId = "user-claim-path";
    const first = (await (await POST(request())).json()) as { assertedAt: string };
    const second = (await (await POST(request())).json()) as { assertedAt: string };
    expect(second.assertedAt).toBe(first.assertedAt);
  });
});
