// Founding members. The first hundred claimed handles carry a number, and the
// number buys BELONGING and nothing else.
//
// THE LAW THIS FILE EXISTS TO KEEP: no product capability is ever founding-only.
// A founding member sees the same map, the same prices, the same planner and the
// same everything as the person who arrives tomorrow. What they get is a mark on
// their card, a place on the wall, and a room to talk in. The one exception the
// captain allows is an early-access preview of something not finished yet, which
// is a queue position rather than a capability: nothing a founding member can DO
// stays out of anybody else's hands.
//
// So this module holds a status, its copy and the door to the room. It holds no
// entitlement, no tier and no gate. If a future change wants to read a founding
// number to decide whether a feature runs, that change is the wrong shape.
//
// Presentation-free on purpose: the number rules, the copy and the invite check
// are all testable without a DOM, a network or a database.

/**
 * How many founding numbers exist. Ever. The cap is the whole point of the
 * status, so it is a constant here and a literal in migration 0097's grant
 * helper, and `__tests__/foundingMembersMigration.test.ts` holds the two to the
 * same figure.
 */
export const FOUNDING_MEMBER_CAP = 100;

/**
 * A granted founding number: a whole number from 1 to the cap. Anything else
 * (a float, a zero, 101, a string that looks like a number) is not a founding
 * number and never becomes one.
 */
export function isFoundingMemberNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= FOUNDING_MEMBER_CAP
  );
}

/**
 * Read an untrusted value (a database row, a JSON body, a query string) into a
 * founding number or nothing. Never throws, never guesses.
 */
export function parseFoundingMemberNumber(value: unknown): number | null {
  if (isFoundingMemberNumber(value)) return value;
  if (typeof value === "string" && /^[0-9]{1,3}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return isFoundingMemberNumber(parsed) ? parsed : null;
  }
  return null;
}

/**
 * The mark itself. One line, said the same way on every surface it appears on,
 * so a reader who sees it on a profile card and again on the wall knows it is
 * the same thing. An invalid number gets no mark rather than a broken one.
 */
export function foundingMemberMark(value: unknown): string | null {
  const number = parseFoundingMemberNumber(value);
  return number === null ? null : `Founding member · No. ${number}`;
}

/**
 * What the mark is for, in the reader's words. This is the accessible name and
 * the hover title, so it says the fact and stops: a number, and what it is not.
 */
export function foundingMemberMarkDetail(value: unknown): string | null {
  const number = parseFoundingMemberNumber(value);
  if (number === null) return null;
  return `One of the first ${FOUNDING_MEMBER_CAP} handles on PUBMAXX. Number ${number}. It unlocks nothing.`;
}

/** The wall's heading and its one honest line. */
export const FOUNDERS_WALL_TITLE = "The first hundred";

export const FOUNDERS_WALL_LEDE =
  "The first hundred people to claim a handle here. There are no perks and nothing is gated behind it. Just their number, kept on the record.";

/** What the wall says before anybody has claimed a handle. */
export const FOUNDERS_WALL_EMPTY =
  "Nobody has claimed a handle yet. The first hundred who do get a number.";

/** What the wall says when the read failed. Never worded as an empty city. */
export const FOUNDERS_WALL_UNAVAILABLE =
  "Couldn't load the founders list just now. Give it a moment and try again.";

/**
 * The wall's address, and the one label a surface may give it.
 *
 * A link, never a lure: no count, no slots-remaining line, and no branch on
 * whether the reader has a number. The wall is PUBLIC and already sitemapped,
 * but until now nothing in the app pointed at it, so the only people who ever
 * saw it were crawlers. Reaching a public list of people is not a perk, and
 * saying how many places are left would be exactly the hurry-up this whole
 * model refuses.
 */
export const FOUNDERS_WALL_HREF = "/founders";
export const FOUNDERS_WALL_LINK_LABEL = "Founding members";

/** The one door, and the only place a founding member is invited anywhere. */
export const FOUNDERS_DISCORD_CTA = "Join the founders’ Discord";

/**
 * How long the arrival greeting stays when it carries the founders' door. It is
 * longer than the plain greeting because it now holds something a person may
 * want to tap, and a link that retires before it can be read is worse than no
 * link at all.
 */
export const FOUNDERS_WELCOME_VISIBLE_MS = 12_000;

/**
 * How many are left, said plainly, for the wall alone. It is a count of a public
 * numbered list, so it reveals nothing the list did not, and it is never shown
 * to somebody who missed it as a reason to hurry: a person who is not a founding
 * member sees no founding surface at all.
 */
export function foundingSlotsRemainingLine(claimed: number): string {
  const taken = Number.isInteger(claimed) && claimed > 0 ? Math.min(claimed, FOUNDING_MEMBER_CAP) : 0;
  const left = FOUNDING_MEMBER_CAP - taken;
  if (left <= 0) return `All ${FOUNDING_MEMBER_CAP} numbers are taken.`;
  if (left === 1) return `${taken} of ${FOUNDING_MEMBER_CAP} taken. One number left.`;
  return `${taken} of ${FOUNDING_MEMBER_CAP} taken.`;
}

/**
 * Hosts a Discord invite may live on. A link that is not a Discord invite is not
 * rendered at all: a founding member tapping "Join the founders' Discord" and
 * landing somewhere else is worse than no link, because they cannot tell there
 * is anything to disbelieve.
 */
const DISCORD_INVITE_HOSTS = new Set([
  "discord.gg",
  "www.discord.gg",
  "discord.com",
  "www.discord.com",
]);

/**
 * The invite, read from the environment and never from a component. An unset,
 * malformed or non-Discord value yields null, and every surface renders nothing
 * rather than a dead door.
 *
 * The default argument is the literal `process.env.NEXT_PUBLIC_DISCORD_INVITE_URL`
 * member expression on purpose: that is what Next inlines into a browser bundle
 * at build time. Reading it through a computed key would ship `undefined`.
 */
export function foundersDiscordInviteUrl(
  raw: string | undefined = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL,
): string | null {
  const candidate = typeof raw === "string" ? raw.trim() : "";
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!DISCORD_INVITE_HOSTS.has(url.hostname.toLowerCase())) return null;
  // An invite is a path. A bare host is a home page, not a room.
  if (url.pathname.replace(/\/+$/, "").length === 0) return null;
  return url.toString();
}

/**
 * The one-shot marker for the founders' door shown on arrival. It stores the
 * founding NUMBER it was already shown for, not a flag, so a second founding
 * account signing in on the same browser still meets its own welcome. That also
 * keeps it out of the closed device-identity set in `lib/deviceAccountIdentity.ts`:
 * reading this can never name, route or act as a person, and it self-corrects on
 * an account switch instead of needing to be cleared.
 */
export const FOUNDERS_WELCOME_SHOWN_KEY = "pubmax:founders-discord:v1";

type MarkerStorage = Pick<Storage, "getItem" | "setItem">;

/** True when this browser has already shown the door to this exact number. */
export function foundersWelcomeShown(
  storage: MarkerStorage | null,
  number: number,
): boolean {
  if (!storage || !isFoundingMemberNumber(number)) return true;
  try {
    return storage.getItem(FOUNDERS_WELCOME_SHOWN_KEY) === String(number);
  } catch {
    // Blocked storage cannot promise "once", so it stays quiet rather than
    // greeting the same person on every page.
    return true;
  }
}

/** Record that the door has been shown to this number. */
export function markFoundersWelcomeShown(
  storage: MarkerStorage | null,
  number: number,
): void {
  if (!storage || !isFoundingMemberNumber(number)) return;
  try {
    storage.setItem(FOUNDERS_WELCOME_SHOWN_KEY, String(number));
  } catch {
    // The welcome is a courtesy, never a step in the flow.
  }
}
