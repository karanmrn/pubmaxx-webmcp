// WP7: after a referral claim lands, the invitee can follow the inviter.
// Session-scoped only — never a durable attribution cookie. Cleared once the
// follow affordance is dismissed or the follow succeeds.

import { normalizeHandle } from "@/lib/profiles";

export const REFERRAL_FOLLOW_HANDLE_KEY = "pubmax:referral-follow-handle";

export function storeReferralFollowHandle(handle: string): void {
  const clean = normalizeHandle(handle);
  if (!clean || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(REFERRAL_FOLLOW_HANDLE_KEY, clean);
  } catch {
    // Storage blocked — follow-back is optional.
  }
}

export function readReferralFollowHandle(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeHandle(
      window.sessionStorage.getItem(REFERRAL_FOLLOW_HANDLE_KEY) ?? "",
    ) || null;
  } catch {
    return null;
  }
}

export function clearReferralFollowHandle(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(REFERRAL_FOLLOW_HANDLE_KEY);
  } catch {
    // ignore
  }
}
