import "server-only";

import { verifyCallerAuth } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";

export type ContributionIdentityResolution =
  | {
      ok: true;
      accountId: string;
      actor: string;
      handle: string;
    }
  | {
      ok: false;
      accountId?: string;
      body: {
        status?: "sign_in_required" | "onboarding_required";
        code?: "AUTH_VERIFICATION_UNAVAILABLE";
        error: string;
        retryable?: true;
      };
      httpStatus: 401 | 409 | 503;
    };

export async function resolveContributionIdentity(
  request: Request,
): Promise<ContributionIdentityResolution> {
  const verification = await verifyCallerAuth(request);
  if (
    verification.status === "absent" ||
    verification.status === "invalid"
  ) {
    return {
      ok: false,
      body: { status: "sign_in_required", error: "Sign in to contribute." },
      httpStatus: 401,
    };
  }
  if (verification.status === "unavailable") {
    return {
      ok: false,
      body: {
        code: "AUTH_VERIFICATION_UNAVAILABLE",
        error: "Sign-in verification is unavailable right now. Try again.",
        retryable: true,
      },
      httpStatus: 503,
    };
  }
  const userId = verification.identity.id;
  try {
    const [profile, privateIdentity] = await Promise.all([
      profileStore().getByUserId(userId),
      privateIdentityStore().read(userId),
    ]);
    if (!profile || !privateIdentity?.dateOfBirth) {
      return {
        ok: false,
        accountId: userId,
        body: {
          status: "onboarding_required",
          error:
            "Choose a public handle and add your date of birth before contributing.",
        },
        httpStatus: 409,
      };
    }
    const handleResolution = await identityHandleStore().resolve(profile.handle);
    const handle =
      handleResolution?.profileId === profile.id
        ? handleResolution.currentHandle
        : profile.handle;
    return {
      ok: true,
      accountId: userId,
      actor: `profile:${profile.id}`,
      handle,
    };
  } catch {
    return {
      ok: false,
      accountId: userId,
      body: { error: "Contribution identity is unavailable right now." },
      httpStatus: 503,
    };
  }
}
