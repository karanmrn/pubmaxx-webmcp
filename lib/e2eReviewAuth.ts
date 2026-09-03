/**
 * Local-only switch for the signed-in review harness.
 *
 * A production-style Next server sets NODE_ENV=production even when it runs
 * on a reviewer's laptop. The explicit VERCEL_ENV=development marker keeps
 * that local process distinct from a deployed production process.
 */

export type E2EReviewEnvironment = Record<string, string | undefined>;

export function isE2ELoginEnabled(
  env: E2EReviewEnvironment = process.env,
): boolean {
  return env.PUBMAX_E2E_LOGIN === "1";
}

export function assertE2ELoginSafe(
  env: E2EReviewEnvironment = process.env,
): void {
  if (!isE2ELoginEnabled(env)) return;

  if (env.VERCEL_ENV === "production") {
    throw new Error(
      "PUBMAX_E2E_LOGIN=1 is forbidden on a VERCEL_ENV=production process.",
    );
  }

  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "development") {
    throw new Error(
      "PUBMAX_E2E_LOGIN=1 requires VERCEL_ENV=development for a local production-style process.",
    );
  }
}
