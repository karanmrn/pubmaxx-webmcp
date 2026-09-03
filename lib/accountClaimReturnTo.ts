import { safeInviteReturnTo } from "@/lib/inviteReturnTo";
import { isPlanId } from "@/lib/plan";

const RETURN_ORIGIN = "https://pubmax.invalid";

export function safePlanReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#")
  ) {
    return null;
  }
  try {
    const url = new URL(candidate, RETURN_ORIGIN);
    if (url.origin !== RETURN_ORIGIN || url.search || url.hash) return null;
    const planId = url.pathname.slice("/plan/".length);
    return url.pathname.startsWith("/plan/") && isPlanId(planId)
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

export function accountClaimReturnTo(raw: string | null | undefined): string | null {
  return safeInviteReturnTo(raw) ?? safePlanReturnTo(raw);
}

export function accountClaimReturnToFromUrl(rawUrl: string): string | null {
  try {
    return accountClaimReturnTo(new URL(rawUrl).searchParams.get("returnTo"));
  } catch {
    return null;
  }
}
