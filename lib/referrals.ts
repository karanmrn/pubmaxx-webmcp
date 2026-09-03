// Referrals. A milestone is a MARK OF HONOUR, and the mark buys nothing.
//
// THE LAW THIS FILE EXISTS TO KEEP: no product capability is ever referral-only.
// A person who has invited five mates sees the same map, the same prices, the
// same planner and the same everything as somebody who has invited nobody. What
// they get is a line on their own profile saying they brought people in. This is
// the founding-member law (`lib/foundingMembers.ts`) applied to a second status,
// deliberately worded the same way so the two cannot drift apart.
//
// So this module holds a status, its copy and the rules for reaching it. It
// holds no entitlement, no feature key, no tier and no gate. If a future change
// wants to read a referral count to decide whether a feature runs, that change
// is the wrong shape.
//
// What this replaced: milestones 1, 3 and 5 each named a PRO FEATURE
// (`collaborative_night_credit`, `continuing_memories`, `post_trial_collaboration`)
// held behind a `REFERRAL_GRANT_GATE` that was closed until person-level
// anti-abuse landed. A closed gate is a mute button, not a decision: the model
// still existed and one flag stood between it and shipping. Captain decision
// 2026-08-10 deleted the model instead. The abuse argument dissolves with it -
// a person who games the count wins a sentence about themselves and nothing
// else, which is why recognition may ship where a grant could not.
//
// Presentation-free on purpose: the milestone rules and the copy are testable
// without a DOM, a network or a database.

const REFERRAL_CAPTURE_KEY = "referral";
const REFERRAL_CODE = /^[A-Za-z0-9_-]{20,80}$/;
export const REFERRAL_SIGNUP_PROOF_TTL_MS = 60 * 60 * 1_000;

/**
 * The counts that earn a mark, ascending. A qualified referral is an invited
 * account that signed up and logged a first accepted contribution.
 */
export const REFERRAL_MILESTONES = [1, 3, 5] as const;
export type ReferralMilestone = (typeof REFERRAL_MILESTONES)[number];

/**
 * The marks themselves, one closed table so the line printed on a profile and
 * the line read out by a screen reader cannot drift. Every detail ends on the
 * same sentence the founders' wall ends on, because it is the same promise.
 */
const REFERRAL_MARKS = {
  1: {
    mark: "Brought a mate in",
    detail:
      "One person they invited signed up and logged a first contribution. Nothing is gated behind it.",
  },
  3: {
    mark: "Brought 3 mates in",
    detail:
      "Three people they invited signed up and logged a first contribution. Nothing is gated behind it.",
  },
  5: {
    mark: "Brought 5 mates in",
    detail:
      "Five people they invited signed up and logged a first contribution. Nothing is gated behind it.",
  },
} as const satisfies Record<ReferralMilestone, { mark: string; detail: string }>;

/**
 * What the invite card says the mark is worth, said once so no surface has to
 * invent its own version of the promise.
 */
export const REFERRAL_RECOGNITION_NOTE =
  "A milestone is a mark on your own profile. Nothing here is gated behind it.";

/**
 * One recorded milestone. There is one event and it records recognition. The
 * shape stays a tagged object rather than a bare number so a durable row and an
 * in-memory row read identically.
 */
export type ReferralMilestoneEvent = {
  event: "milestone_earned";
  milestone: ReferralMilestone;
  permanent: true;
};

export type ReferralSignupClaim = {
  code: string | null;
  cleanUrl: string;
};

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE.test(value);
}

export function referralSignupClaimFromUrl(
  currentUrl: string,
): ReferralSignupClaim | null {
  try {
    const url = new URL(currentUrl);
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (!params.has(REFERRAL_CAPTURE_KEY)) return null;
    const rawCode = params.get(REFERRAL_CAPTURE_KEY)?.trim() ?? "";
    params.delete(REFERRAL_CAPTURE_KEY);
    const remainingHash = params.toString();
    url.hash = remainingHash ? `#${remainingHash}` : "";
    return {
      code: isReferralCode(rawCode) ? rawCode : null,
      cleanUrl: `${url.pathname}${url.search}${url.hash}` || "/",
    };
  } catch {
    return null;
  }
}

/** A milestone this product recognises. Anything else is not one. */
export function isReferralMilestone(value: unknown): value is ReferralMilestone {
  return REFERRAL_MILESTONES.some((milestone) => milestone === value);
}

/**
 * Read an untrusted value (a database row, a JSON body) into a milestone or
 * nothing. Never throws, never guesses.
 */
export function parseReferralMilestone(
  value: unknown,
): ReferralMilestone | null {
  if (isReferralMilestone(value)) return value;
  if (typeof value === "string" && /^[0-9]{1,2}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return isReferralMilestone(parsed) ? parsed : null;
  }
  return null;
}

/** The highest milestone a qualified count has reached, or none. */
export function referralMilestoneReached(
  qualifiedCount: unknown,
): ReferralMilestone | null {
  const count =
    typeof qualifiedCount === "number" && Number.isInteger(qualifiedCount)
      ? qualifiedCount
      : 0;
  let reached: ReferralMilestone | null = null;
  for (const milestone of REFERRAL_MILESTONES) {
    if (count >= milestone) reached = milestone;
  }
  return reached;
}

/** The next milestone above a qualified count, or none once all are recorded. */
export function nextReferralMilestone(
  qualifiedCount: unknown,
): ReferralMilestone | null {
  const count =
    typeof qualifiedCount === "number" && Number.isInteger(qualifiedCount)
      ? qualifiedCount
      : 0;
  return REFERRAL_MILESTONES.find((milestone) => milestone > count) ?? null;
}

/**
 * The mark itself. One line, said the same way on every surface it appears on.
 * An invalid milestone gets no mark rather than a broken one.
 */
export function referralMark(value: unknown): string | null {
  const milestone = parseReferralMilestone(value);
  return milestone === null ? null : REFERRAL_MARKS[milestone].mark;
}

/**
 * What the mark is for, in the reader's words. This is the accessible name and
 * the hover title, so it says the fact and stops: what happened, and what it is
 * not.
 */
export function referralMarkDetail(value: unknown): string | null {
  const milestone = parseReferralMilestone(value);
  return milestone === null ? null : REFERRAL_MARKS[milestone].detail;
}

/** The mark a qualified count has earned, or none. */
export function referralMarkForCount(qualifiedCount: unknown): string | null {
  return referralMark(referralMilestoneReached(qualifiedCount));
}
