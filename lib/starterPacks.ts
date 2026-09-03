// A starter pack is a bundle of REAL accounts you can follow in one tap, so a
// new drinker's feed and directory are alive on the first night rather than on
// the tenth. Letterboxd and Bluesky ship the same shape.
//
// This module is the whole policy and it is PURE: what a pack is, which packs
// exist, which accounts belong in one, and the words a pack surface may use.
// Nothing here reads a store, a request or the clock.
//
// THE HONESTY RULE, which every function below serves: a pack contains
// accounts that already exist and already placed themselves there. There is no
// seeded member, no house account, no "suggested for you" inference, and no
// pack assembled from anything but the public profile the owner wrote. A pack
// that cannot reach {@link STARTER_PACK_MEMBER_FLOOR} real members does not
// show at all, because a bundle of one is worse than no bundle.
//
// A BOROUGH pack reads the owner's own public location text (`homeCity`, the
// "Home city" field on the profile editor) and matches the borough's own name
// inside it. It never infers a borough from a district, a postcode or a pub
// they logged: a profile that says "Camden" is in the Camden pack, a profile
// that says "north London" is in no pack at all. Under-inclusive is the safe
// side of that line - the floor simply keeps a thin pack off the screen.
//
// The FOUNDING pack is the first hundred claimed handles in number order,
// which is the same public wall `/founders` already prints. It reads the
// number and nothing else: no capability may ever branch on it
// (`lib/foundingMembers.ts`).

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import { isFoundingMemberNumber } from "@/lib/foundingMembers";
import { normalizeHandle } from "@/lib/profiles";

/** Below this many real members a pack does not show. An empty pack is worse than none. */
export const STARTER_PACK_MEMBER_FLOOR = 3;

/** The most accounts one tap may follow. A pack is an introduction, not a mailing list. */
export const STARTER_PACK_MAX_MEMBERS = 12;

/** How many faces a pack card shows before the count carries the rest. */
export const STARTER_PACK_PREVIEW_FACES = 5;

/**
 * Follow fewer accounts than this and the packs are offered. At or above it the
 * viewer has a lot already and the surface stays out of the way.
 */
export const STARTER_PACK_FOLLOW_FLOOR = 3;

export const FOUNDING_STARTER_PACK_SLUG = "founding-hundred";

export const STARTER_PACK_KINDS = ["borough", "founding"] as const;
export type StarterPackKind = (typeof STARTER_PACK_KINDS)[number];

export type StarterPack = {
  slug: string;
  title: string;
  /**
   * One plain line naming the selection rule. It is a contract field and an
   * accessible description, never a subtitle printed under the card title.
   */
  description: string;
  kind: StarterPackKind;
  /** The canonical London borough a borough pack reads a location against. */
  borough?: string;
};

/**
 * A profile as this policy reads it. Structural on purpose: the store's
 * `ProfileRecord` is projected onto it by the server module, so this file stays
 * pure and backend-free while owning the selection rule.
 */
export type StarterPackCandidate = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  /** The owner's own public location words. Free text, matched, never inferred from. */
  homeCity?: string;
  foundingMemberNumber?: number;
  /** An account owns this handle. An unclaimed row is not a person. */
  claimed: boolean;
  /** The account was deleted. A tombstone never joins a pack. */
  tombstoned: boolean;
};

/** What a pack surface prints for one member. Nothing private crosses here. */
export type StarterPackMember = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  foundingMemberNumber?: number;
};

/**
 * "Drinkers of X" for every borough but one: the City of London is called the
 * City by everyone who drinks in it, and "Drinkers of City of London" is not a
 * sentence anybody says.
 */
const BOROUGH_TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  "City of London": "Drinkers of the City",
};

/**
 * Another name for the SAME borough, never a district inside one. "Kingston"
 * and "Richmond" are what those two boroughs are called; "Fulham" is a place
 * inside Hammersmith and Fulham, so it is not here. Adding a district would
 * make the pack claim a borough the owner never named.
 */
const BOROUGH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Kingston upon Thames": ["kingston"],
  "Richmond upon Thames": ["richmond"],
};

function boroughTitle(borough: string): string {
  return BOROUGH_TITLE_OVERRIDES[borough] ?? `Drinkers of ${borough}`;
}

/** One pack per London borough, plus the founders. Ordered founders first. */
export function listStarterPacks(): StarterPack[] {
  const founding: StarterPack = {
    slug: FOUNDING_STARTER_PACK_SLUG,
    title: "Founding hundred",
    description: "The first hundred accounts here, in number order.",
    kind: "founding",
  };
  const boroughs = LONDON_BOROUGHS.map((borough): StarterPack => ({
    slug: slugifyBorough(borough),
    title: boroughTitle(borough),
    description: `Accounts whose profile says ${borough}.`,
    kind: "borough",
    borough,
  }));
  return [founding, ...boroughs];
}

/** The pack a slug names, or null. Never guesses a near miss. */
export function starterPackBySlug(slug: string): StarterPack | null {
  const key = slugifyBorough(slug);
  if (!key) return null;
  return listStarterPacks().find((pack) => pack.slug === key) ?? null;
}

/**
 * Fold free text down to space-separated alphanumeric words, so "Camden Town,
 * London" and "camden-town" read the same and "&" reads as "and".
 */
function normalizeLocation(value: string | undefined): string {
  if (typeof value !== "string") return "";
  return ` ${value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Does this location text name that borough? A whole-word phrase match against
 * the borough's own name (or one of its own other names), so "Camden Town"
 * counts and "Camberwell" does not. Never a substring: a pack that matched
 * inside words would put a Camberwell drinker in Camden.
 */
export function locationNamesBorough(
  location: string | undefined,
  borough: string,
): boolean {
  const haystack = normalizeLocation(location);
  if (haystack.trim() === "") return false;
  const names = [borough, ...(BOROUGH_ALIASES[borough] ?? [])];
  return names.some((name) => {
    const needle = normalizeLocation(name);
    return needle.trim() !== "" && haystack.includes(needle);
  });
}

/** Claimed, alive, and a real handle. The gate every pack member passes first. */
function isRealAccount(candidate: StarterPackCandidate): boolean {
  return (
    candidate.claimed &&
    !candidate.tombstoned &&
    normalizeHandle(candidate.handle) !== ""
  );
}

function toMember(candidate: StarterPackCandidate): StarterPackMember {
  return {
    handle: normalizeHandle(candidate.handle),
    ...(candidate.displayName ? { displayName: candidate.displayName } : {}),
    ...(candidate.avatarUrl ? { avatarUrl: candidate.avatarUrl } : {}),
    ...(isFoundingMemberNumber(candidate.foundingMemberNumber)
      ? { foundingMemberNumber: candidate.foundingMemberNumber }
      : {}),
  };
}

/**
 * The accounts a borough pack holds: claimed, alive, and placed there by their
 * own public location. Handle order, so the pack is the same for everybody who
 * opens it and no invented ranking decides who a new drinker meets first.
 */
export function selectBoroughPackMembers(
  candidates: readonly StarterPackCandidate[],
  borough: string,
): StarterPackMember[] {
  return candidates
    .filter(
      (candidate) =>
        isRealAccount(candidate) &&
        locationNamesBorough(candidate.homeCity, borough),
    )
    .map(toMember)
    .sort((a, b) => a.handle.localeCompare(b.handle))
    .slice(0, STARTER_PACK_MAX_MEMBERS);
}

/** The founders, in number order. A departed founder is simply not here. */
export function selectFoundingPackMembers(
  candidates: readonly StarterPackCandidate[],
): StarterPackMember[] {
  return candidates
    .filter(
      (candidate) =>
        isRealAccount(candidate) &&
        isFoundingMemberNumber(candidate.foundingMemberNumber),
    )
    .map(toMember)
    .sort((a, b) => (a.foundingMemberNumber ?? 0) - (b.foundingMemberNumber ?? 0))
    .slice(0, STARTER_PACK_MAX_MEMBERS);
}

/** The one dispatch, so a caller never picks the rule for a pack itself. */
export function selectStarterPackMembers(
  pack: StarterPack,
  candidates: readonly StarterPackCandidate[],
): StarterPackMember[] {
  if (pack.kind === "founding") return selectFoundingPackMembers(candidates);
  return pack.borough
    ? selectBoroughPackMembers(candidates, pack.borough)
    : [];
}

/** A pack shows only once it holds real people worth meeting. */
export function starterPackShows(memberCount: number): boolean {
  return memberCount >= STARTER_PACK_MEMBER_FLOOR;
}

/**
 * Does this viewer get offered the packs? TRI-STATE on purpose: `null` means
 * the follow count has not answered yet, and a read that could not answer may
 * never tell somebody with a full lot that they have nobody.
 */
export function viewerNeedsStarterPacks(followingCount: number | null): boolean {
  return followingCount !== null && followingCount < STARTER_PACK_FOLLOW_FLOOR;
}

/**
 * Whether the packs surface renders at all. ONE owner, because the decision has
 * four parts and a surface that re-derived any of them would drift from this:
 *
 * - `viewer` null means the live session has not answered, and nothing may act
 *   as somebody nobody has identified yet.
 * - `loaded` false means the read has not answered, so there is no honest thing
 *   to paint.
 * - `packCount` zero means no pack reached the floor, and offering an empty
 *   shelf is worse than offering nothing.
 * - `followedAny` keeps the surface up after a follow-all, because it is the
 *   thing reporting what the tap did. Hiding it the moment the count crossed
 *   the floor would eat the answer.
 */
export function starterPacksSurfaceVisible(input: {
  viewer: string | null;
  loaded: boolean;
  packCount: number;
  viewerFollowing: number | null;
  followedAny: boolean;
}): boolean {
  if (!input.viewer || !input.loaded || input.packCount === 0) return false;
  return viewerNeedsStarterPacks(input.viewerFollowing) || input.followedAny;
}

/**
 * Whether somebody with NO account may see the packs.
 *
 * A stranger meeting the sign-in door is shown who is already here, and is
 * offered nothing: following is an account action, and a pack card carrying a
 * button that would answer 401 is a second sign-in door beside the one they are
 * already reading. So this asks only whether there is anything to show.
 *
 * starterPacksSurfaceVisible stays the SIGNED-IN question - whether this viewer
 * still needs packs - and neither predicate is restated at a call site.
 */
export function starterPacksVisibleToStranger(input: {
  loaded: boolean;
  packCount: number;
}): boolean {
  return input.loaded && input.packCount > 0;
}

/** What happened to one member of a pack, in one word. */
export const STARTER_PACK_FOLLOW_OUTCOMES = [
  "followed",
  "already",
  "self",
  // The member is gone (deleted). It is its own word, because rounding a
  // permanent refusal into `failed` reads as a fault the drinker could retry.
  "unavailable",
  "failed",
] as const;
export type StarterPackFollowOutcome =
  (typeof STARTER_PACK_FOLLOW_OUTCOMES)[number];

export type StarterPackFollowResult = {
  handle: string;
  outcome: StarterPackFollowOutcome;
};

/** Copy the surface may print. Visible words live here so two cards cannot drift. */
export const STARTER_PACKS_TITLE = "Start with your lot";
export const STARTER_PACK_FOLLOW_LABEL = "Follow all";
export const STARTER_PACK_FOLLOW_WORKING_LABEL = "Following…";

/** The accessible name on a follow-all button, which follows several people at once. */
export function starterPackFollowAccessibleLabel(pack: StarterPack): string {
  return `Follow everyone in ${pack.title}`;
}

export function starterPackMemberCountLabel(count: number): string {
  return count === 1 ? "1 account" : `${count} accounts`;
}

/**
 * One honest line about what a follow-all actually did. A part-failure says so
 * with its own number rather than reporting the whole tap as a success.
 */
export function starterPackFollowSummary(
  results: readonly StarterPackFollowResult[],
): string {
  const attempted = results.filter((result) => result.outcome !== "self");
  if (attempted.length === 0) return "Nobody here to follow yet.";
  const failed = attempted.filter((result) => result.outcome === "failed").length;
  const gone = attempted.filter((result) => result.outcome === "unavailable").length;
  const joined = attempted.length - failed - gone;
  if (failed === 0 && gone === 0) return `Following all ${attempted.length}.`;
  const failedLine = failed === 0 ? "" : `${failed} didn't go through.`;
  const goneLine =
    gone === 0 ? "" : `${gone} ${gone === 1 ? "is" : "are"} no longer here.`;
  if (joined === 0) {
    if (gone === 0) return "That didn't go through. Try again.";
    return [failedLine, goneLine].filter(Boolean).join(" ");
  }
  return `Following ${joined} of ${attempted.length}.${failedLine ? ` ${failedLine}` : ""}${goneLine ? ` ${goneLine}` : ""}`;
}
