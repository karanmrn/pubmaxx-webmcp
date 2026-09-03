export const MAGIC_LINK_SENT_MESSAGE =
  "If that email can receive a sign-in link, it is on its way. Check your inbox and spam folder.";
export const MAGIC_LINK_RATE_LIMIT_MESSAGE =
  "Too many sign-in attempts. Wait a few minutes, then try again.";
export const MAGIC_LINK_ERROR_MESSAGE =
  "We could not send a sign-in link right now. Try again shortly.";

export type MagicLinkResult = {
  status: "sent" | "rate_limited" | "error";
  message: string;
};

type OtpError = { message?: string; status?: number; code?: string } | null;

const ACCOUNT_STATE_ERROR_CODES = new Set([
  "email_exists",
  "identity_already_exists",
  "signup_disabled",
  "user_banned",
  "user_not_found",
]);

const ACTIONABLE_AUTH_ERROR_CODES = new Set([
  "bad_json",
  "captcha_failed",
  "email_address_not_authorized",
  "email_provider_disabled",
  "hook_timeout",
  "hook_timeout_after_retry",
  "request_timeout",
  "unexpected_failure",
  "validation_failed",
]);

export type PasswordlessAuthClient = {
  signInWithOtp: (input: {
    email: string;
    options: { emailRedirectTo: string; shouldCreateUser: true };
  }) => Promise<{ error: OtpError }>;
};

function isRateLimited(error: Exclude<OtpError, null>): boolean {
  const searchable = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    /too many|over.*limit/.test(searchable)
  );
}

function couldRevealAccountState(error: Exclude<OtpError, null>): boolean {
  // Auth error prose is not an API. Prefer stable GoTrue codes/statuses and keep
  // the message fallback only for older deployments that omit `code`.
  if (error.code && ACCOUNT_STATE_ERROR_CODES.has(error.code)) return true;
  const searchable = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return /user.*(not found|exists)|already.*registered|signup|signups|account.*exists/.test(searchable);
}

function isActionableFailure(error: Exclude<OtpError, null>): boolean {
  if (error.code && ACTIONABLE_AUTH_ERROR_CODES.has(error.code)) return true;
  if (error.status === 401 || error.status === 403) return true;
  if (error.status === 408 || error.status === 425) return true;
  return typeof error.status === "number" && error.status >= 500;
}

/**
 * Request a Supabase magic link without returning provider/account-specific
 * errors to the UI. The same success copy is used for every address.
 */
export async function requestMagicLink(
  auth: PasswordlessAuthClient,
  email: string,
  emailRedirectTo: string,
): Promise<MagicLinkResult> {
  try {
    const { error } = await auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo, shouldCreateUser: true },
    });
    if (!error) return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
    if (isRateLimited(error)) {
      return { status: "rate_limited", message: MAGIC_LINK_RATE_LIMIT_MESSAGE };
    }
    // Treat account/existence policy failures exactly like a send. Revealing a
    // different state for existing vs. first-time addresses creates an oracle.
    if (couldRevealAccountState(error)) {
      return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
    }
    if (isActionableFailure(error)) {
      return { status: "error", message: MAGIC_LINK_ERROR_MESSAGE };
    }
    // Unknown policy-style 4xx responses remain neutral: future GoTrue account
    // states must not silently become enumeration oracles.
    if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
      return { status: "sent", message: MAGIC_LINK_SENT_MESSAGE };
    }
    return { status: "error", message: MAGIC_LINK_ERROR_MESSAGE };
  } catch {
    return { status: "error", message: MAGIC_LINK_ERROR_MESSAGE };
  }
}
