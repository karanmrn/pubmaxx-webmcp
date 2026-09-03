// Demo profile model + pure helpers for public profiles (/u/[handle]).
//
// Handle-based identity is a DEMO stance: there is no auth or stored profile
// table yet (real Supabase Auth is a later epic). A profile is therefore
// SYNTHESIZED from a handle's public Pint Drops — display name from the handle,
// simple stats from the drops. Everything here is pure and backend-free so it
// unit-tests without a DOM, a network, or a database.

import { normalizeHandle as normalizeHandleCore } from "@/lib/handleNormalize";

// A profile drop is the public Pint Drop DTO shape, kept loose so this module
// never depends on the store's internal types. Only the fields the profile
// actually reads are named; unknown extras (era, note, photos, provenance...)
// ride along untouched.
export type ProfileDrop = {
  handle: string;
  priceGbp?: number | null;
  venueId?: string;
  // A period label ("Victorian", "1980s"…) when the memory is pinned to an era.
  // Used by computeBadges to award the Heritage Walker badge.
  era?: string | null;
  // Where the drop came from. An "anecdote" is a passed-down memory (heritage
  // signal); "sourced"/"contributor"/"demo" are not. See lib/curation.ts.
  provenance?: string | null;
  // Forward-compatible: drops don't carry a borough today, but if a future DTO
  // does, profileStats surfaces it. Absent → boroughs is omitted, never [].
  borough?: string | null;
  [key: string]: unknown;
};

export type Profile = {
  handle: string;
  displayName: string;
  homeCity?: string;
  bio?: string;
  avatarUrl?: string;
  /** Approved cover photo serve path; absent profiles wear the brass treatment. */
  coverUrl?: string;
  /**
   * The whole rotation, in the owner's order, when a surface carried it. Cover
   * #1 is {@link coverUrl}, so a reader that got only the single cover is not
   * missing a backdrop - it is missing the rest of one. `lib/profileCovers`
   * `profileCoverUrls` is the ONE resolution of the two.
   */
  coverUrls?: string[];
  /** Public by choice: the drink this person orders. */
  favouriteDrink?: string;
  /** Public by choice: what this person is into on a night out. */
  interests?: string;
  /** Public by choice: where this person works. Display text, never a page. */
  workplace?: string;
  /**
   * Position among the first hundred claimed handles, when this account holds
   * one. A mark on the card and nothing more: see `lib/foundingMembers.ts` for
   * why no capability may ever read it.
   */
  foundingMemberNumber?: number;
};

/**
 * The profile row as it crosses the public wire. This is what
 * `/api/profiles/[handle]` returns and what the profile page holds: the stored,
 * owner-authored identity minus every internal key (ownership, tombstone,
 * storage object keys, moderation state). The private set - email, date of
 * birth, gender, full legal name - is not here and never was; it lives behind
 * the owner-authenticated onboarding read.
 */
export type PublicProfile = {
  id: string;
  handle: string;
  displayName?: string;
  /** Approved avatar serve path only; never a hotlinked remote URL. */
  avatarUrl?: string;
  /** Approved cover serve path only. Cover #1 of the rotation below. */
  coverUrl?: string;
  /**
   * The ordered rotation of approved cover serve paths, when the surface that
   * answered carried it. Absent means "not asked", never "no covers".
   */
  coverUrls?: string[];
  homeCity?: string;
  bio?: string;
  favouriteDrink?: string;
  interests?: string;
  workplace?: string;
  /** Public by design: the founding number, when this account holds one. */
  foundingMemberNumber?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * The stored fields a public projection reads. Structural on purpose: the
 * store's `ProfileRecord` satisfies it, so this module stays pure and
 * backend-free while owning the field list.
 */
export type PublicProfileSource = {
  id: string;
  handle: string;
  displayName?: string;
  homeCity?: string;
  bio?: string;
  favouriteDrink?: string;
  interests?: string;
  workplace?: string;
  foundingMemberNumber?: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * The ONE public projection of a profile row. Every surface that returns a
 * profile over the wire - the public read AND every image write, which returns
 * the whole profile because the composer replaces its held row with the reply -
 * comes through here, so a field can never be public on one and missing on the
 * other. A second copy of this list is what dropped `foundingMemberNumber` off
 * an avatar or cover write and took a founding member's brass mark away until
 * they reloaded.
 *
 * Image URLs are passed in already resolved: only an approved served path may
 * cross this wire, never a hotlinked remote URL and never an unscanned image.
 * `lib/profileStore.publicProfileFromRecord` is the single caller that wires
 * them.
 *
 * The card fields (favourite drink, what you're into, where you work) are
 * PUBLIC BY CHOICE, exactly like the bio and the face. The private set - email,
 * date of birth, gender, full legal name - is not here and stays behind the
 * owner-authenticated onboarding read
 * (`__tests__/profilesRoutePrivacy.test.ts`).
 */
export function toPublicProfile(
  profile: PublicProfileSource | null | undefined,
  images: {
    avatarUrl?: string;
    coverUrl?: string;
    coverUrls?: readonly string[];
  } = {},
): PublicProfile | null {
  if (!profile) return null;
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(images.avatarUrl ? { avatarUrl: images.avatarUrl } : {}),
    ...(images.coverUrl ? { coverUrl: images.coverUrl } : {}),
    // Omitted when the caller did not read the rotation, because an empty list
    // would say "this profile chose no backdrop" about a question nobody asked.
    ...(images.coverUrls ? { coverUrls: [...images.coverUrls] } : {}),
    ...(profile.homeCity ? { homeCity: profile.homeCity } : {}),
    ...(profile.bio ? { bio: profile.bio } : {}),
    ...(profile.favouriteDrink ? { favouriteDrink: profile.favouriteDrink } : {}),
    ...(profile.interests ? { interests: profile.interests } : {}),
    ...(profile.workplace ? { workplace: profile.workplace } : {}),
    // The founding number is public by design: it is a visible mark on a public
    // card and a line on a public wall, so hiding it here would only mean the
    // card had to ask twice for something already published.
    ...(profile.foundingMemberNumber !== undefined
      ? { foundingMemberNumber: profile.foundingMemberNumber }
      : {}),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/**
 * How far the public read of one handle has got. TRI-STATE for the same reason
 * `identityResolved` is: "we asked and nobody owns this" and "we could not ask"
 * are different answers, and only one of them may be acted on.
 */
export type PublicProfileReadState = "asking" | "answered" | "failed";

/**
 * Whether a signed-out visitor may adopt this handle as their own device
 * identity (the legacy self-asserted claim, `pubmax_handle`).
 *
 * The rule is the narrow one: ONLY a handle the public read has ANSWERED about
 * and reported as belonging to nobody. A handle with a durable profile row has
 * an owner - a face, a bio, sometimes a founding number - and offering a
 * stranger the word "claim" under that person's name is the loudest way an
 * interface can say the wrong thing. A tombstoned handle is not free either:
 * recycling it would mean the same mark named two people. And a read that
 * FAILED may never be reported as an empty handle, because the offer is only
 * ever made on evidence.
 */
export function handleIsAdoptable(input: {
  read: PublicProfileReadState;
  /** The durable profile row the public read returned, or null for none. */
  ownerProfile: PublicProfile | null;
  /** The handle's account was tombstoned; its number stays spent. */
  tombstoned: boolean;
}): boolean {
  if (input.read !== "answered") return false;
  if (input.tombstoned) return false;
  return input.ownerProfile === null;
}

export type ProfileStats = {
  pintsLogged: number;
  // Cheapest priced pint in GBP, or null when the handle has no priced drops
  // (notes-only / anecdote drops carry a null price).
  cheapestPintGbp: number | null;
  // How many crawls this handle has posted. There's no crawl-authorship data on
  // this page yet, so callers pass it in explicitly; it defaults to 0 and is
  // always a finite, non-negative integer.
  crawlsPosted: number;
  // Passed-down / era-tagged memories (golden-days signal). Counted from drops
  // with a non-empty era or anecdote/heritage provenance.
  memoriesPosted: number;
  boroughs?: string[];
};

/**
 * What a stat grid prints where a cheapest pint would go when the handle has
 * not logged one.
 *
 * The two profile grids each carried their own copy of
 * `value == null ? "–" : ...`, so a fresh account was greeted by a bare en dash
 * (U+2013): a SEPARATOR standing in for a sentence, saying nothing about why
 * the cell is empty. `docs/VOICE.md` answers it directly - "No price logged
 * here yet" beats "0 observations" - and the profile is the surface whose job
 * is to make somebody want an account. One formatter, one absence, no dash of
 * either width.
 */
export const NO_CHEAPEST_PINT = "None yet";

export function formatCheapestPint(gbp: number | null): string {
  return gbp == null ? NO_CHEAPEST_PINT : `£${gbp.toFixed(2)}`;
}

/**
 * What a stat face says when the read behind it could not answer. "None" and
 * "we could not look" are two findings, and a tile printing 0 for the second
 * one states a fact nobody measured, about somebody's own record.
 */
export const UNCOUNTED_STAT = "Not counted";

/**
 * One owner for how a TRI-STATE count reaches a stat face, shared by the
 * passport grid and the profile header so the two cannot drift. A real number
 * prints; a null prints {@link UNCOUNTED_STAT}, never a zero.
 */
export function formatStatCount(value: number | null): number | string {
  return typeof value === "number" && Number.isFinite(value) ? value : UNCOUNTED_STAT;
}

// An earned-or-not achievement badge. Pure data — the UI decides how to render.
// `earned` lets callers keep the full catalogue (for a "locked" preview) or
// filter to just the earned set; computeBadges returns the whole catalogue.
export type Badge = {
  id: string;
  label: string;
  description: string;
  earned: boolean;
};

export { HANDLE_MAX } from "@/lib/handleNormalize";

/**
 * The public identity normaliser. The leaf is runtime-total (`unknown`), while
 * this re-export keeps the narrower argument type every caller was written
 * against, so a wrong value is still a compile error here.
 */
export const normalizeHandle: (raw: string | null | undefined) => string =
  normalizeHandleCore;

/**
 * Initials for a handle-backed surface. Never leaks withheld handles.
 *
 * It lives in this leaf module, not beside the avatar URL resolver, because
 * client avatars call it: `lib/avatarResolve.ts` reaches the profile store and
 * therefore `node:crypto`, which a browser bundle cannot build.
 */
export function avatarInitialFromHandle(handle: string, displayName?: string): string {
  const source = (displayName?.trim() || normalizeHandle(handle)).trim();
  return (source.charAt(0) || "?").toUpperCase();
}

// Turn a normalized handle into a friendly display name for the demo. We split
// on underscores and title-case the words: "cheap_pint_ken" → "Cheap Pint Ken".
// A handle that normalizes to empty falls back to a stable placeholder.
function displayNameFromHandle(handle: string): string {
  const words = handle
    .split("_")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : "Anonymous Drinker";
}

// Provenance values that mark a drop as a passed-down memory (a heritage
// signal), as opposed to a live/sourced/seeded log.
const HERITAGE_PROVENANCE = new Set(["anecdote", "heritage"]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Pure stats over a handle's drops. Order-independent and null-safe:
// - pintsLogged is the number of drops.
// - cheapestPintGbp is the min of finite, positive prices, or null when none.
// - crawlsPosted is passed in (this page has no crawl-authorship data), coerced
//   to a finite, non-negative integer; junk / missing → 0.
// - memoriesPosted counts era-tagged or anecdote/heritage drops.
// - boroughs is a sorted unique list, OMITTED entirely when no drop names one.
export function profileStats(
  drops: readonly ProfileDrop[] | null | undefined,
  crawlsPosted?: number | null,
): ProfileStats {
  const list = Array.isArray(drops) ? drops : [];

  const prices = list
    .map((d) => d.priceGbp)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  const cheapestPintGbp = prices.length ? Math.min(...prices) : null;

  const crawls =
    typeof crawlsPosted === "number" && Number.isFinite(crawlsPosted) && crawlsPosted > 0
      ? Math.floor(crawlsPosted)
      : 0;

  const boroughs = Array.from(
    new Set(
      list
        .map((d) => (typeof d.borough === "string" ? d.borough.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  // Memories = golden-days signal: era-tagged or anecdote/heritage provenance.
  const memoriesPosted = list.filter((d) => {
    if (hasText(d.era)) return true;
    const provenance =
      typeof d.provenance === "string" ? d.provenance.trim().toLowerCase() : "";
    return HERITAGE_PROVENANCE.has(provenance);
  }).length;

  const stats: ProfileStats = {
    pintsLogged: list.length,
    cheapestPintGbp,
    crawlsPosted: crawls,
    memoriesPosted,
  };
  if (boroughs.length) stats.boroughs = boroughs;
  return stats;
}

// Pint tiers for the "regular → local legend" ladder. A drinker becomes a
// Regular at 25 logged pints and a Local Legend at 100 — round, aspirational
// numbers that stay reachable in the demo while still marking a milestone.
export const REGULAR_THRESHOLD = 25;
export const LOCAL_LEGEND_THRESHOLD = 100;

// Under this price a pint is a genuine bargain worth a badge. Strictly under —
// £4.00 exactly is not "under £4", so it does NOT earn Cheap Legend.
const CHEAP_LEGEND_MAX_GBP = 4;

// Pure, deterministic badge catalogue for a handle. Turns activity into
// identity (the Letterboxd pattern): each badge is returned with `earned` so
// the UI can either show the full ladder or filter to the earned set. Never
// throws — a null/empty drop list yields the catalogue with everything unearned.
//
// Badges:
//  • First Pint      — ≥1 drop logged.
//  • Cheap Legend    — any drop priced strictly under £4.
//  • Heritage Walker — any drop carrying an era, or an anecdote/heritage
//                      provenance (a passed-down memory).
//  • Regular         — ≥25 pints logged.
//  • Local Legend    — ≥100 pints logged.
export function computeBadges(
  drops: readonly ProfileDrop[] | null | undefined,
  stats: ProfileStats,
): Badge[] {
  const list = Array.isArray(drops) ? drops : [];
  const pints = stats.pintsLogged;

  const cheapLegend = list.some(
    (d) =>
      typeof d.priceGbp === "number" &&
      Number.isFinite(d.priceGbp) &&
      d.priceGbp > 0 &&
      d.priceGbp < CHEAP_LEGEND_MAX_GBP,
  );

  const heritageWalker = list.some(
    (d) =>
      hasText(d.era) ||
      (hasText(d.provenance) && HERITAGE_PROVENANCE.has(d.provenance.trim().toLowerCase())),
  );

  return [
    {
      id: "first-pint",
      label: "First Pint",
      description: "Logged your first Pint Drop.",
      earned: pints >= 1,
    },
    {
      id: "cheap-legend",
      label: "Cheap Legend",
      description: "Found a pint under £4.",
      earned: cheapLegend,
    },
    {
      id: "heritage-walker",
      label: "Heritage Walker",
      description: "Logged a pint tied to an era or a passed-down memory.",
      earned: heritageWalker,
    },
    {
      id: "regular",
      label: "Regular",
      description: `Logged ${REGULAR_THRESHOLD}+ pints.`,
      earned: pints >= REGULAR_THRESHOLD,
    },
    {
      id: "local-legend",
      label: "Local Legend",
      description: `Logged ${LOCAL_LEGEND_THRESHOLD}+ pints.`,
      earned: pints >= LOCAL_LEGEND_THRESHOLD,
    },
  ];
}

// Progress toward one unearned badge — pure data for a "quest chip". `current`
// and `target` are honest counts (a binary badge like Cheap Legend is a 0-of-1
// action, not a fake percentage); `label` is ready-to-render honest copy.
export type BadgeProgress = {
  badge: Badge;
  current: number;
  target: number;
  label: string;
};

// Forward-looking companion to computeBadges (IDEAS B2-lite quest chips): the
// UNEARNED badges, nearest-first, each with progress toward its threshold.
// Same inputs as computeBadges, pure and deterministic:
//  • "nearest" = highest current/target completion; ties keep catalogue order.
//  • Count badges (First Pint, Regular, Local Legend) report real pint counts.
//  • Binary badges (Cheap Legend, Heritage Walker) are 0-of-1 with an action
//    label — no invented percentages.
//  • Zero stats → the full catalogue, all at zero (First Pint leads).
//  • Everything earned → an empty array; the caller renders nothing.
export function nextBadgeProgress(
  drops: readonly ProfileDrop[] | null | undefined,
  stats: ProfileStats,
): BadgeProgress[] {
  const pints =
    typeof stats.pintsLogged === "number" && Number.isFinite(stats.pintsLogged) && stats.pintsLogged > 0
      ? Math.floor(stats.pintsLogged)
      : 0;

  // Per-badge quest shape: the threshold plus honest copy for the chip.
  const quests: Record<string, { current: number; target: number; label: string }> = {
    "first-pint": {
      current: Math.min(pints, 1),
      target: 1,
      label: "Log your first pint for First Pint",
    },
    "cheap-legend": {
      current: 0, // unearned means the sub-£4 pint hasn't happened yet
      target: 1,
      label: "Find a pint under £4 for Cheap Legend",
    },
    "heritage-walker": {
      current: 0, // unearned means no era / passed-down memory yet
      target: 1,
      label: "Log an era or passed-down memory for Heritage Walker",
    },
    regular: {
      current: Math.min(pints, REGULAR_THRESHOLD),
      target: REGULAR_THRESHOLD,
      label: `${Math.min(pints, REGULAR_THRESHOLD)} of ${REGULAR_THRESHOLD} pints to Regular`,
    },
    "local-legend": {
      current: Math.min(pints, LOCAL_LEGEND_THRESHOLD),
      target: LOCAL_LEGEND_THRESHOLD,
      label: `${Math.min(pints, LOCAL_LEGEND_THRESHOLD)} of ${LOCAL_LEGEND_THRESHOLD} pints to Local Legend`,
    },
  };

  const progress = computeBadges(drops, stats)
    .filter((badge) => !badge.earned)
    .map((badge, index) => {
      const quest = quests[badge.id] ?? { current: 0, target: 1, label: badge.description };
      return { badge, index, ...quest };
    });

  // Nearest-first by completion ratio; catalogue order breaks ties so the
  // result is stable and deterministic.
  progress.sort((a, b) => {
    const ratio = b.current / b.target - a.current / a.target;
    return ratio !== 0 ? Math.sign(ratio) : a.index - b.index;
  });

  return progress.map(({ badge, current, target, label }) => ({ badge, current, target, label }));
}

// Synthesize a demo Profile for a handle from its drops. There is no stored
// profile, so the display name comes from the handle and the bio is a light
// summary derived from the stats. Callers pass the handle they already
// normalized; we normalize again defensively so this is safe standalone.
/**
 * Overlay the durable, owner-authored row on top of the identity synthesized
 * from a handle's drops. Name, bio and city fall back to the synthesized
 * placeholder; the images and the card fields do not, because there is no
 * honest placeholder for what somebody drinks.
 */
export function withStoredProfile(
  base: Profile,
  stored: PublicProfile | null | undefined,
): Profile {
  return {
    ...base,
    displayName: stored?.displayName ?? base.displayName,
    bio: stored?.bio ?? base.bio,
    homeCity: stored?.homeCity ?? base.homeCity,
    avatarUrl: stored?.avatarUrl ?? base.avatarUrl,
    coverUrl: stored?.coverUrl,
    coverUrls: stored?.coverUrls,
    favouriteDrink: stored?.favouriteDrink,
    interests: stored?.interests,
    workplace: stored?.workplace,
    // Granted by the store, never synthesized: a handle with no stored row has
    // claimed nothing, so it is not a founding member of anything.
    foundingMemberNumber: stored?.foundingMemberNumber,
  };
}

export function deriveProfileFromDrops(
  rawHandle: string,
  drops: readonly ProfileDrop[] | null | undefined,
): Profile {
  const handle = normalizeHandle(rawHandle);
  const stats = profileStats(drops);

  const bio = stats.pintsLogged
    ? `${stats.pintsLogged} ${stats.pintsLogged === 1 ? "pint" : "pints"} logged` +
      (stats.cheapestPintGbp != null
        ? ` · cheapest £${stats.cheapestPintGbp.toFixed(2)}`
        : "")
    : undefined;

  return {
    handle,
    displayName: displayNameFromHandle(handle),
    bio,
  };
}
