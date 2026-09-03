export const E2E_QA_HANDLE = "e2e_qa";
export const E2E_QA_DISPLAY_NAME = "QA (automated)";
export const E2E_QA_EMAIL = "e2e-qa@pubmaxxing.com";

export type E2ESeedEnvironment = Record<string, string | undefined>;

function isRemoteProductionUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "pubmaxxing.com" ||
      host.endsWith(".pubmaxxing.com") ||
      host.endsWith(".vercel.app") ||
      host.endsWith(".supabase.co")
    );
  } catch {
    return false;
  }
}

export function assertSeedEnvironment(
  env: E2ESeedEnvironment,
  targetUrls: readonly string[],
): void {
  if (env.PUBMAX_E2E_LOGIN !== "1") {
    throw new Error("E2E seed requires PUBMAX_E2E_LOGIN=1.");
  }
  if (env.VERCEL_ENV === "production") {
    throw new Error("E2E seed refuses VERCEL_ENV=production.");
  }
  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "development") {
    throw new Error(
      "E2E seed requires VERCEL_ENV=development for a local production-style process.",
    );
  }
  if (
    (env.CI === "1" || env.CI === "true") &&
    targetUrls.some(isRemoteProductionUrl)
  ) {
    throw new Error("E2E seed refuses a production target from CI.");
  }
}

export function buildQaProfileInsert(userId: string): {
  user_id: string;
  handle: string;
  display_name: string;
} {
  return {
    user_id: userId,
    handle: E2E_QA_HANDLE,
    display_name: E2E_QA_DISPLAY_NAME,
  };
}

export function assertSeedProfileSafety(input: {
  foundingCountBefore: number;
  foundingCountAfter: number;
  profile: { founding_member_number?: unknown };
}): void {
  if (input.foundingCountBefore !== input.foundingCountAfter) {
    throw new Error(
      `E2E seed changed founding-member count from ${input.foundingCountBefore} to ${input.foundingCountAfter}.`,
    );
  }

  if (
    input.profile.founding_member_number !== null &&
    input.profile.founding_member_number !== undefined
  ) {
    throw new Error(
      `E2E seed gave @${E2E_QA_HANDLE} a founding-member number.`,
    );
  }
}
