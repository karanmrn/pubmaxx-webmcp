import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";

/**
 * Spending a moderator token, and PROVING the cookie landed before the reload.
 *
 * THE DEFECT THIS EXISTS FOR: the session cookie is `Secure` under
 * NODE_ENV=production, so a deployment served without TLS drops it while the
 * POST still answers 200. The form reloaded on that 200, met the same token
 * form again, and said nothing, which reads as a correct token being ignored.
 *
 * The outcome is THREE-WAY, like every other read here: a session GoTrue-style
 * answer of `false` is a cookie the browser REFUSED to keep, while a confirm we
 * could not run is a fact about us and says so rather than blaming the browser.
 */

export const ADMIN_SESSION_UNREACHABLE_MESSAGE =
  "Could not reach the server. Try again.";
export const ADMIN_SESSION_REFUSED_FALLBACK = "Not authorised.";
// The route's own 403 body is the bare "Not authorised.", which tells a
// moderator nothing to do. A refused token has exactly one remedy, so this door
// says it; every other status still carries the route's own honest line (the
// 429 has to stay "Too many attempts, slow down.").
export const ADMIN_SESSION_NOT_AUTHORISED_MESSAGE =
  "Not authorised. Check the admin token.";
export const ADMIN_SESSION_NOT_KEPT_MESSAGE =
  "Sign-in did not stick - this page needs HTTPS.";
export const ADMIN_SESSION_UNCONFIRMED_MESSAGE =
  "Could not confirm the sign-in. Try again.";
export const ADMIN_SESSION_MISSING_TOKEN_MESSAGE = "Enter the admin token.";

export const ADMIN_SESSION_PATH = "/api/admin/session";

export type AdminSessionSubmitOutcome =
  | { status: "open" }
  | { status: "refused"; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The global under a name, because a detached `fetch` is an illegal call. */
export const browserFetch: FetchLike = (input, init) => fetch(input, init);

/**
 * What the session route says this browser holds. TRI-STATE on purpose: a read
 * we could not run says nothing about the cookie, and each door names its own
 * refusal for `anonymous` - after a POST that is a cookie the browser refused
 * to keep, and with no token typed it is simply nobody signed in yet.
 */
export type AdminSessionState = "authenticated" | "anonymous" | "unknown";

export async function readAdminSessionState(
  fetchImpl: FetchLike,
): Promise<AdminSessionState> {
  let res: Response;
  try {
    res = await fetchImpl(ADMIN_SESSION_PATH, {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
  } catch {
    return "unknown";
  }
  if (!res.ok) {
    discardBody(res);
    return "unknown";
  }
  const body = await readApiJson(res).catch(() => null);
  discardBody(res);
  const authenticated =
    body && typeof body === "object"
      ? (body as { authenticated?: unknown }).authenticated
      : undefined;
  if (authenticated === true) return "authenticated";
  if (authenticated === false) return "anonymous";
  return "unknown";
}

/** Whether the browser kept the session cookie the POST just handed it. */
export async function confirmAdminSession(
  fetchImpl: FetchLike,
): Promise<AdminSessionSubmitOutcome> {
  const state = await readAdminSessionState(fetchImpl);
  if (state === "authenticated") return { status: "open" };
  if (state === "anonymous") {
    return { status: "refused", message: ADMIN_SESSION_NOT_KEPT_MESSAGE };
  }
  return { status: "refused", message: ADMIN_SESSION_UNCONFIRMED_MESSAGE };
}

export async function submitAdminToken(
  token: string,
  fetchImpl: FetchLike,
): Promise<AdminSessionSubmitOutcome> {
  const trimmed = token.trim();
  // The route rate-limits per IP BEFORE it looks at the token, so a stray empty
  // submit spends the moderator's own budget on a request that cannot succeed.
  if (!trimmed) {
    return { status: "refused", message: ADMIN_SESSION_MISSING_TOKEN_MESSAGE };
  }
  let res: Response;
  try {
    res = await fetchImpl(ADMIN_SESSION_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: trimmed }),
    });
  } catch {
    return { status: "refused", message: ADMIN_SESSION_UNREACHABLE_MESSAGE };
  }
  if (!res.ok) {
    const refusedToken = res.status === 403;
    const body = await readApiJson(res).catch(() => null);
    discardBody(res);
    return {
      status: "refused",
      message: refusedToken
        ? ADMIN_SESSION_NOT_AUTHORISED_MESSAGE
        : errorMessageFrom(body, ADMIN_SESSION_REFUSED_FALLBACK),
    };
  }
  discardBody(res);
  return confirmAdminSession(fetchImpl);
}
