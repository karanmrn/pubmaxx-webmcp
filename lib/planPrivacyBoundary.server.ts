import "server-only";

// Server-only by construction: it imports planStore and lazily the
// `server-only` flag reader, so it can never end up in a client bundle.

import type { PlanState } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import {
  buildPlanPrivacyPreview,
  memberProjection,
  type PlanVisibilityProjection,
} from "@/lib/planPrivacy";
import { planMemberIdentityResult } from "@/lib/planStore";
import type { VibeTally } from "@/lib/vibeTally";

// Env name for PUBMAX_FRIEND_MEMBER_REHYDRATION_V2. The trusted-handoff flag
// registry (lib/trustedHandoffFlags.server) remains the source of truth for the
// name and its strict `0|1` parse; it is read directly here (server-side, never
// on the client) so this boundary carries no `server-only` import into a bundle
// or a test runtime. Unknown/absent values mean off, exactly as the registry.
const FRIEND_MEMBER_REHYDRATION_ENV = "PUBMAX_FRIEND_MEMBER_REHYDRATION_V2";

function memberRehydrationFlagEnabled(): boolean {
  return process.env[FRIEND_MEMBER_REHYDRATION_ENV] === "1";
}

/**
 * Sole server seam that decides whether a request may receive the full Plan
 * state or only the anonymous preview (§4.10). It fails CLOSED: the member
 * projection is returned ONLY when the friendMemberRehydrationV2 flag is on AND
 * the request carries a capability that resolves to an active host/guest
 * identity. Every other outcome — flag off, no capability, store error, or a
 * missing/expired/revoked/wrong-plan identity — degrades to the preview. The
 * privacy-safe preview is therefore never flag-disableable.
 */

type IdentityLookup = typeof planMemberIdentityResult;

export type ResolvePlanProjectionInput = {
  request: Request;
  planId: string;
  state: PlanState;
  vibeTally?: VibeTally | null;
  /** Test seam only; defaults to the real store lookup. */
  identityLookup?: IdentityLookup;
  /** Test seam only; defaults to the real flag reader. */
  memberRehydrationEnabled?: boolean;
};

export async function resolvePlanProjection({
  request,
  planId,
  state,
  vibeTally = null,
  identityLookup = planMemberIdentityResult,
  memberRehydrationEnabled,
}: ResolvePlanProjectionInput): Promise<PlanVisibilityProjection> {
  const preview = () => buildPlanPrivacyPreview(state, vibeTally);

  const flagOn = memberRehydrationEnabled ?? memberRehydrationFlagEnabled();
  if (!flagOn) return preview();

  const token = planMemberCapability(request, undefined);
  if (!token) return preview();

  let identity: Awaited<ReturnType<IdentityLookup>>;
  try {
    identity = await identityLookup(planId, token);
  } catch {
    // Any lookup failure is treated as unauthenticated — never leak on error.
    return preview();
  }
  if (!identity.ok || !identity.identity) return preview();

  return memberProjection(state);
}
