import { afterEach, describe, expect, it, vi } from "vitest";

import {
  claimSignupReferral,
  claimSignupReferralFromAuthCallback,
  withReferralSignupProof,
} from "@/lib/referralClaimClient";

const AUTH_ATTEMPT = {
  ok: true,
  id: "a".repeat(32),
  callbackUrl:
    "https://pubmaxxing.com/auth/callback?_authAttempt=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} as const;

describe("same-journey referral claim", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for Retry-After before retrying the live handoff", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retryable: true }), {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ attributed: true }), { status: 200 }),
      );

    const claim = claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "/api/referrals/claim-attribution",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          code: "opaque_code_123456789",
          authAttemptId: "a".repeat(32),
          signupProof: "signed-proof",
        }),
      }),
    );
  });

  it("uses bounded backoff for retryable responses without Retry-After", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const claim = claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );

    await vi.advanceTimersByTimeAsync(249);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops after a terminal response", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ attributed: false }), { status: 200 }),
    );

    await claimSignupReferral(
      "opaque_code_123456789",
      "a".repeat(32),
      "signed-proof",
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("preserves auth when optional proof issuance fails", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ retryable: true }), { status: 503 }),
    );

    await expect(
      withReferralSignupProof(
        AUTH_ATTEMPT,
        "https://pubmaxxing.com/#referral=opaque_code_123456789",
        request,
      ),
    ).resolves.toEqual(AUTH_ATTEMPT);
  });

  it("abandons stalled proof issuance after a short timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const request = (
      _input: string,
      init?: RequestInit,
    ): Promise<Response> => {
      signal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(signal?.reason),
          { once: true },
        );
      });
    };

    const prepared = withReferralSignupProof(
      AUTH_ATTEMPT,
      "https://pubmaxxing.com/#referral=opaque_code_123456789",
      request,
    );

    await vi.advanceTimersByTimeAsync(3_000);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    await expect(prepared).resolves.toEqual(AUTH_ATTEMPT);
  });

  it("scrubs the referral fragment before retry backoff", async () => {
    vi.useFakeTimers();
    const replacements: string[] = [];
    const request = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const claim = claimSignupReferralFromAuthCallback({
      currentUrl:
        "https://pubmaxxing.com/?city=london#referral=opaque_code_123456789&section=prices",
      callback: {
        attemptId: AUTH_ATTEMPT.id,
        tokens: { accessToken: "header.payload.signature", refreshToken: "refresh-token-1" },
        providerError: false,
        signupProof: "signed-proof",
      },
      request,
      replaceUrl: (url) => replacements.push(url),
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(replacements).toEqual(["/?city=london#section=prices"]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(claim).resolves.toBeUndefined();
    expect(replacements).toEqual(["/?city=london#section=prices"]);
  });
});
