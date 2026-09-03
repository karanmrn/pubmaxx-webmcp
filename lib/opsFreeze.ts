// Solo-operator emergency freeze (probe U15, docs/UNKNOWNS_MAP_2026-07-21.md).
//
// One owner, no moderators. When a safety or abuse incident lands overnight the
// owner needs a single switch that makes the social WRITE surfaces read-only
// instantly, driven by one env var, no deploy beyond a redeploy that picks up
// the flipped value. Reads keep working, the rest of the product keeps working,
// and the safety floors (reporting, moderation, account deletion) stay OPEN so a
// freeze can never trap someone or bury an incident.
//
// This is a pure seam: it reads the env at CALL time (never at module scope), so
// it is hermetically testable with vi.stubEnv and honours the repo's env-seam
// doctrine (vitest.setup.ts). No storage, no I/O, no side effects.
//
// Flip procedure and policy live in docs/OPS_FREEZE_RUNBOOK.md.

import { publicApiError } from "@/lib/apiError";

/** The single env var that drives the freeze. */
export const SOCIAL_FREEZE_ENV = "PUBMAX_SOCIAL_FREEZE";

/**
 * Freeze scopes. `off` (or unset / any unknown value) means the product runs
 * normally; `social` freezes the social mutating surfaces. Kept as a closed set
 * so a typo fails safe to `off` rather than silently freezing something new.
 */
export type FreezeScope = "off" | "social";

export type SocialFreezeState = {
  /** True only when the social write surfaces should refuse mutations. */
  frozen: boolean;
  /** The scope the env var selected; `off` whenever not frozen. */
  scope: FreezeScope;
};

/**
 * Pure read of the freeze switch. Defaults to the live `process.env` but takes
 * an explicit env so tests never touch the ambient process. Unknown or empty
 * values fail safe to `off` — the switch only ever freezes on the exact,
 * documented `social` value.
 */
export function readSocialFreeze(
  env: Record<string, string | undefined> = process.env,
): SocialFreezeState {
  const raw = (env[SOCIAL_FREEZE_ENV] ?? "").trim().toLowerCase();
  if (raw === "social") return { frozen: true, scope: "social" };
  return { frozen: false, scope: "off" };
}

// House voice (TASTE DOCTRINE): value first, never apologise first, no em dash.
// State what still works before what is paused.
const FROZEN_LINE = "Reading stays open. Posting is paused for a bit while we sort something out.";

/** Public error code carried by a frozen social mutation. */
export const SOCIAL_FROZEN_CODE = "SOCIAL_FROZEN";

/**
 * Guard for a social MUTATING route. Returns a ready-to-return 503 `Response`
 * (flat public envelope, retryable) when the social freeze is on, or `null` when
 * writes should proceed. Callers do:
 *
 *   const frozen = socialFreezeResponse();
 *   if (frozen) return frozen;
 *
 * GET/read handlers never call this. Reporting, moderation, and account deletion
 * never call this — those are the safety and legal floors that stay open under a
 * freeze.
 */
export function socialFreezeResponse(
  env: Record<string, string | undefined> = process.env,
): Response | null {
  if (!readSocialFreeze(env).frozen) return null;
  return publicApiError(FROZEN_LINE, SOCIAL_FROZEN_CODE, 503, { retryable: true });
}
