import { publicApiError } from "@/lib/apiError";
import { callerAuthIdentity } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_CHANGE_GENERIC_ERROR,
} from "@/lib/passwordPolicy";
import { isLimited } from "@/lib/pintDrops";
import { signInWithEmailPassword } from "@/lib/handlePasswordSignIn";
import { assertServerEnv } from "@/lib/serverEnv";
import { isCrossSiteRequest } from "@/lib/crossSiteRequest";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const VERIFY_RATE_LIMIT = 8;
const VERIFY_RATE_WINDOW_MS = 15 * 60 * 1000;

function invalidPassword(): Response {
  return publicApiError(
    PASSWORD_CHANGE_GENERIC_ERROR,
    "INVALID_CREDENTIALS",
    401,
  );
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSiteRequest(request)) {
    return publicApiError("Cross-site requests are not accepted.", "FORBIDDEN", 403);
  }

  const limitKey = `auth-change-password:${hashIp(clientIp(request))}`;
  if (
    await isLimited(limitKey, limitKey, VERIFY_RATE_LIMIT, VERIFY_RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError(
      "Too many password attempts. Try again shortly.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  const identity = await callerAuthIdentity(request);
  if (!identity?.email) return invalidPassword();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return invalidPassword();
  }

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  if (currentPassword.length < MIN_PASSWORD_LENGTH) return invalidPassword();

  const session = await signInWithEmailPassword(identity.email, currentPassword);
  if (!session) return invalidPassword();

  // The password grant is used only as proof of the old password. Its tokens
  // are deliberately discarded. The browser keeps using its existing session
  // and performs the actual change through GoTrue's owner-bound updateUser.
  return jsonNoStore({ verified: true });
}
