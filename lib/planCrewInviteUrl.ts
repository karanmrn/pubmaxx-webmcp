// Crew-join share URLs for a Plan. The classic multi-use invite_token is a
// bearer capability (not the plan UUID): WhatsApp / ShareBar must attach it as
// #invite= so PlanCrew can POST /join without reopening the bare-UUID IDOR.
// Collaboration one-use invites keep the same hash shape (PlanCollaborationPanel).

import { isPlanId } from "@/lib/plan";

/** Classic plans.invite_token (32 hex). Distinct from 64-hex collaboration invites. */
export const CLASSIC_PLAN_INVITE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function isClassicPlanInviteToken(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  return CLASSIC_PLAN_INVITE_TOKEN_PATTERN.test(raw.trim().toLowerCase());
}

/**
 * Site-relative plan path a guest can open and tap "I'm in" on.
 * Query (e.g. ?vibe=) stays before the hash so crawlers and ShareBar agree.
 */
export function planCrewSharePath(
  planId: string,
  inviteToken: string,
  vibeSlug?: string | null,
): string {
  if (!isPlanId(planId) || !isClassicPlanInviteToken(inviteToken)) {
    return isPlanId(planId) ? `/plan/${planId}` : "/plan";
  }
  const token = inviteToken.trim().toLowerCase();
  const query = vibeSlug ? `?vibe=${encodeURIComponent(vibeSlug)}` : "";
  return `/plan/${planId}${query}#invite=${encodeURIComponent(token)}`;
}
