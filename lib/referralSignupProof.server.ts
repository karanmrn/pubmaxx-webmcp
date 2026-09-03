import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { isAuthAttemptId } from "@/lib/authRedirect";
import { REFERRAL_SIGNUP_PROOF_TTL_MS } from "@/lib/referrals";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";

const TOKEN_VERSION = 1;
const TOKEN_MAX_LENGTH = 1_000;

type ReferralSignupProofClaims = {
  v: typeof TOKEN_VERSION;
  attemptId: string;
  issuedAt: number;
  expiresAt: number;
};

export type VerifiedReferralSignupProof = {
  attemptId: string;
  issuedAt: number;
};

function signature(encoded: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`referral-signup-proof:v${TOKEN_VERSION}:${encoded}`)
    .digest();
}

export function mintReferralSignupProof(
  attemptId: string,
  now = Date.now(),
): string {
  if (
    !isAuthAttemptId(attemptId) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(now + REFERRAL_SIGNUP_PROOF_TTL_MS)
  ) {
    throw new Error("Referral signup proof needs a valid auth attempt.");
  }
  const claims: ReferralSignupProofClaims = {
    v: TOKEN_VERSION,
    attemptId,
    issuedAt: now,
    expiresAt: now + REFERRAL_SIGNUP_PROOF_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

export function verifyReferralSignupProof(
  token: unknown,
  expectedAttemptId: string,
  now = Date.now(),
): VerifiedReferralSignupProof | null {
  if (
    typeof token !== "string" ||
    !token ||
    token.length > TOKEN_MAX_LENGTH ||
    !isAuthAttemptId(expectedAttemptId)
  ) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }
    const claims = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    ) as Partial<ReferralSignupProofClaims>;
    if (
      claims.v !== TOKEN_VERSION ||
      claims.attemptId !== expectedAttemptId ||
      !isAuthAttemptId(claims.attemptId) ||
      typeof claims.issuedAt !== "number" ||
      !Number.isSafeInteger(claims.issuedAt) ||
      typeof claims.expiresAt !== "number" ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.expiresAt !== claims.issuedAt + REFERRAL_SIGNUP_PROOF_TTL_MS ||
      claims.issuedAt > now ||
      now >= claims.expiresAt
    ) {
      return null;
    }
    return {
      attemptId: claims.attemptId,
      issuedAt: claims.issuedAt,
    };
  } catch {
    return null;
  }
}
