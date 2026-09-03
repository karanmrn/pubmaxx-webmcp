import { PLAN_TITLE_MAX } from "@/lib/plan";
import type { NightContext } from "@/lib/nightPlanning";
import { inferNightContext } from "@/lib/nightPlanning";
import { cleanText } from "@/lib/textClean";

const SOFT_TITLE_PATTERN =
  /\bquiet\b|\bcoffee\b|\bchill\b|alcohol[ -]?free|zero[ -]?proof|soft drinks?|not drinking/i;

/** Honest invite-page line when a plan reads as soft / alcohol-optional. */
export const PLAN_ALCOHOL_OPTIONAL_INVITE_LINE =
  "Drinks are alcohol-optional on this plan.";

/**
 * Whether a plan's stored context or title names a soft social occasion.
 * Silence when nothing in the record supports the claim.
 */
export function planReadsAsAlcoholOptional(input: {
  title?: string;
  context?: NightContext | null;
}): boolean {
  const context = input.context;
  if (context?.zeroProof) return true;
  if (context?.atmosphere?.includes("quiet")) return true;

  const title = cleanText(input.title, PLAN_TITLE_MAX);
  if (!title) return false;

  const lower = title.toLowerCase();
  if (SOFT_TITLE_PATTERN.test(lower)) return true;
  return inferNightContext(title).context.zeroProof;
}

export function planAlcoholOptionalInviteLine(input: {
  title?: string;
  context?: NightContext | null;
}): string | null {
  return planReadsAsAlcoholOptional(input) ? PLAN_ALCOHOL_OPTIONAL_INVITE_LINE : null;
}
