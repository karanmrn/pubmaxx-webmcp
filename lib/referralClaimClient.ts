import {
  REFERRAL_SIGNUP_PROOF_PARAM,
  type AuthAttemptStart,
  type AuthCallbackAttempt,
} from "@/lib/authRedirect";
import { storeReferralFollowHandle } from "@/lib/referralFollowBack";
import { referralSignupClaimFromUrl } from "@/lib/referrals";
import { normalizeHandle } from "@/lib/profiles";

type ReferralClaimRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type SuccessfulAuthAttempt = Extract<AuthAttemptStart, { ok: true }>;

const MAX_CLAIM_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const REFERRAL_PROOF_TIMEOUT_MS = 3_000;
const FALLBACK_RETRY_DELAYS_MS = [250, 750] as const;

async function responseIsRetryable(response: Response): Promise<boolean> {
  if (response.status === 429 || response.status >= 500) return true;
  const body = await response.clone().json().catch(() => null) as
    | { retryable?: unknown }
    | null;
  return body?.retryable === true;
}

function retryAfterMs(response: Response, now: number): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(raw) - now;
  if (!Number.isFinite(delay) || delay < 0) return null;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function claimSignupReferral(
  code: string,
  authAttemptId: string,
  signupProof: string,
  request: ReferralClaimRequest,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    let delayMs: number = FALLBACK_RETRY_DELAYS_MS[attempt] ?? 0;
    try {
      const response = await request("/api/referrals/claim-attribution", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, authAttemptId, signupProof }),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { inviterHandle?: unknown }
          | null;
        const handle = normalizeHandle(
          typeof body?.inviterHandle === "string" ? body.inviterHandle : "",
        );
        if (handle) storeReferralFollowHandle(handle);
        return;
      }
      if (!(await responseIsRetryable(response))) return;
      delayMs = retryAfterMs(response, Date.now()) ?? delayMs;
    } catch {
      if (attempt === MAX_CLAIM_ATTEMPTS - 1) return;
    }
    if (attempt < MAX_CLAIM_ATTEMPTS - 1) await wait(delayMs);
  }
}

export async function withReferralSignupProof(
  attempt: SuccessfulAuthAttempt,
  currentUrl: string,
  request: ReferralClaimRequest,
): Promise<SuccessfulAuthAttempt> {
  const referral = referralSignupClaimFromUrl(currentUrl);
  if (!referral?.code) return attempt;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, REFERRAL_PROOF_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      request(
        `/api/auth/referral-signup-proof?attempt=${encodeURIComponent(attempt.id)}`,
        { cache: "no-store", signal: controller.signal },
      ),
      timeout,
    ]);
    if (!response) return attempt;
    const body = await response.json().catch(() => null) as
      | { proof?: unknown }
      | null;
    if (
      !response.ok ||
      typeof body?.proof !== "string" ||
      !body.proof
    ) {
      return attempt;
    }
    const callbackUrl = new URL(attempt.callbackUrl);
    callbackUrl.searchParams.set(REFERRAL_SIGNUP_PROOF_PARAM, body.proof);
    return { ...attempt, callbackUrl: callbackUrl.toString() };
  } catch {
    return attempt;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function claimSignupReferralFromAuthCallback(input: {
  currentUrl: string;
  callback: AuthCallbackAttempt;
  request: ReferralClaimRequest;
  replaceUrl: (cleanUrl: string) => void;
}): Promise<void> {
  const referral = referralSignupClaimFromUrl(input.currentUrl);
  if (!referral) return;
  try {
    input.replaceUrl(referral.cleanUrl);
  } catch {
    return;
  }
  if (
    referral.code &&
    input.callback.attemptId &&
    input.callback.signupProof
  ) {
    await claimSignupReferral(
      referral.code,
      input.callback.attemptId,
      input.callback.signupProof,
      input.request,
    );
  }
}
