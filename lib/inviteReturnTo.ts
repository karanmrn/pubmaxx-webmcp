const INVITE_ORIGIN = "https://pubmax.invalid";
const INVITE_PATH = /^\/add\/[a-z0-9_]{3,30}$/;
/**
 * The ONE search parameter an invite return may carry: `?auto=1`, which asks
 * the add page to perform the add the person already chose before they went off
 * to make an account. Everything else is still refused, so this stays a fixed
 * pair of shapes rather than an open redirect with a query on it.
 */
const INVITE_SEARCH = "?auto=1";

/**
 * Keep invite continuation inside one add-link path. The value is carried in
 * the URL during account setup and is never written to device storage.
 */
export function safeInviteReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("#")
  ) {
    return null;
  }
  try {
    const url = new URL(candidate, INVITE_ORIGIN);
    if (
      url.origin !== INVITE_ORIGIN ||
      url.hash ||
      (url.search && url.search !== INVITE_SEARCH) ||
      !INVITE_PATH.test(url.pathname)
    ) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function inviteReturnToFromUrl(rawUrl: string): string | null {
  try {
    return safeInviteReturnTo(new URL(rawUrl).searchParams.get("returnTo"));
  } catch {
    return null;
  }
}
