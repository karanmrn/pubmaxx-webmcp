import { describe, expect, it } from "vitest";

import {
  mintReferralSignupProof,
  verifyReferralSignupProof,
} from "@/lib/referralSignupProof.server";
import { GET as issueReferralSignupProof } from "@/app/api/auth/referral-signup-proof/route";

const START = Date.parse("2026-07-28T10:00:00.000Z");
const ATTEMPT = "a".repeat(32);

describe("referral signup proof", () => {
  it("issues a no-store proof before auth starts", async () => {
    const response = await issueReferralSignupProof(
      new Request(
        `https://pubmaxxing.com/api/auth/referral-signup-proof?attempt=${ATTEMPT}`,
      ),
    );
    const body = await response.json() as { proof: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(verifyReferralSignupProof(body.proof, ATTEMPT)).not.toBeNull();
  });

  it("verifies the server-minted auth attempt and issue time", () => {
    const proof = mintReferralSignupProof(ATTEMPT, START);

    expect(verifyReferralSignupProof(proof, ATTEMPT, START + 1_000)).toEqual({
      attemptId: ATTEMPT,
      issuedAt: START,
    });
  });

  it("rejects another attempt, tampering, and expiry", () => {
    const proof = mintReferralSignupProof(ATTEMPT, START);

    expect(
      verifyReferralSignupProof(proof, "b".repeat(32), START + 1_000),
    ).toBeNull();
    expect(
      verifyReferralSignupProof(`${proof}x`, ATTEMPT, START + 1_000),
    ).toBeNull();
    expect(
      verifyReferralSignupProof(proof, ATTEMPT, START + 60 * 60 * 1_000),
    ).toBeNull();
  });
});
