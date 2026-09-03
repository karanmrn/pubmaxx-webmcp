import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { isHandleClaimLimited } from "@/lib/identityHandleClaimRateLimit";
import { cleanDateOfBirth } from "@/lib/privateIdentity";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

// Owner-only payload: this route requires the caller's verified JWT, so the
// private fields (date of birth, gender, sex, full name) may appear here and
// nowhere public. Public profile payloads must never carry them —
// __tests__/profilesRoutePrivacy.test.ts pins that.
type PrivateIdentityView = {
  dateOfBirth: string;
  fullName?: string;
  sex?: string;
  gender?: string;
  genderSelfDescribed?: string;
};

function privateDetails(
  privateIdentity: PrivateIdentityView | null,
): Record<string, string> {
  if (!privateIdentity) return {};
  return {
    ...(privateIdentity.dateOfBirth
      ? { dateOfBirth: privateIdentity.dateOfBirth }
      : {}),
    ...(privateIdentity.fullName ? { fullName: privateIdentity.fullName } : {}),
    ...(privateIdentity.sex ? { sex: privateIdentity.sex } : {}),
    ...(privateIdentity.gender ? { gender: privateIdentity.gender } : {}),
    ...(privateIdentity.genderSelfDescribed
      ? { genderSelfDescribed: privateIdentity.genderSelfDescribed }
      : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to finish setting up your account.", "UNAUTHENTICATED", 401);
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
    ]);
    if (!profile) return jsonNoStore({ complete: false });
    return jsonNoStore({
      complete: Boolean(privateIdentity?.dateOfBirth),
      handle: profile.handle,
      ...privateDetails(privateIdentity),
    });
  } catch {
    return publicApiError("Account details are unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to finish setting up your account.", "UNAUTHENTICATED", 401);
  }
  if (await isHandleClaimLimited(request, userId)) {
    return publicApiError("Too many handle attempts. Try again shortly.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const result = await privateIdentityStore().completeOnboarding({
    userId,
    handle: typeof body.handle === "string" ? body.handle : "",
    dateOfBirth: body.dateOfBirth,
    fullName: body.fullName,
    sex: body.sex,
  });
  if (!result.ok) {
    const status =
      result.code === "storage"
        ? 503
        : result.code === "taken" || result.code === "already_has_handle"
          ? 409
          : 400;
    return publicApiError(result.error, result.code, status, {
      retryable: status >= 500,
    });
  }
  return jsonNoStore(
    {
      complete: true,
      handle: result.handle,
      // Public status, returned here so the claim surface can mark the moment
      // once rather than re-reading its own account to find out.
      ...(result.foundingMemberNumber === undefined
        ? {}
        : { foundingMemberNumber: result.foundingMemberNumber }),
      ...privateDetails(result.privateIdentity),
    },
    { status: 201 },
  );
}

export async function PATCH(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to update your account details.", "UNAUTHENTICATED", 401);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  let dateOfBirth: string | undefined;
  if ("dateOfBirth" in body) {
    const cleaned = cleanDateOfBirth(body.dateOfBirth);
    if (!cleaned) {
      return publicApiError("Enter a valid date of birth.", "INVALID", 400);
    }
    dateOfBirth = cleaned;
  }
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().updateDetails(userId, {
        ...("fullName" in body ? { fullName: body.fullName } : {}),
        ...("sex" in body ? { sex: body.sex } : {}),
        ...("gender" in body
          ? {
              gender: body.gender,
              genderSelfDescribed: body.genderSelfDescribed,
            }
          : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
      }),
    ]);
    // An owner may save private details whatever their onboarding status says:
    // the save CREATES the identity row. What is left is two real refusals, and
    // they are two findings rather than one. A signed-in account with no
    // profile has nothing to attach details to, and a first save has to carry
    // the date of birth the row is built around.
    if (!profile) {
      return publicApiError("Claim your handle before saving private details.", "CONFLICT", 409);
    }
    if (!privateIdentity) {
      return publicApiError("Add your date of birth to save private details.", "INVALID", 400);
    }
    return jsonNoStore({
      complete: true,
      handle: profile.handle,
      ...privateDetails(privateIdentity),
    });
  } catch {
    return publicApiError("Account details could not be saved.", "UNAVAILABLE", 503, { retryable: true });
  }
}
