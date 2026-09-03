import "server-only";

// Reading the accounts a starter pack is made of.
//
// The policy lives in `lib/starterPacks.ts` and stays pure; this is the one
// place that asks the profile store for candidates and hands them to it. It
// adds no rule of its own - if a pack shows here, `starterPackShows` said so.
//
// The scan reuses the SAME closed row set the people directory reads
// (`listClaimedProfiles`: claimed handle, no tombstone), so a pack can never
// surface an account the directory would refuse to. The founders come through
// `listFoundingMembers`, which is bounded by the cohort itself, so the founding
// pack does not depend on the paged scan reaching number 97.
//
// The scan is BOUNDED, and a bounded scan that stopped early is a fact rather
// than a silence: `truncated` rides back with the packs. Truncation can only
// leave real members out, never add an invented one, so a truncated read still
// answers honestly - it just answers about fewer people.

import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
  type ProfileRecord,
} from "@/lib/profileStore";
import {
  listStarterPacks,
  selectStarterPackMembers,
  starterPackShows,
  type StarterPack,
  type StarterPackCandidate,
  type StarterPackMember,
} from "@/lib/starterPacks";

/** One page of the directory scan. Matches the directory route's own ceiling. */
const SCAN_PAGE_SIZE = 48;
/** How many pages one read may spend. Past this the answer is `truncated`. */
const SCAN_MAX_PAGES = 10;

export type StarterPackView = StarterPack & {
  members: StarterPackMember[];
  memberCount: number;
};

export type StarterPackScan = {
  packs: StarterPackView[];
  /** The account scan hit its page budget, so a thin pack may be thinner here. */
  truncated: boolean;
};

function toCandidate(profile: ProfileRecord): StarterPackCandidate {
  const avatarUrl = publicOwnedImageUrl(profile, "avatar");
  return {
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(profile.homeCity ? { homeCity: profile.homeCity } : {}),
    ...(profile.foundingMemberNumber !== undefined
      ? { foundingMemberNumber: profile.foundingMemberNumber }
      : {}),
    claimed: Boolean(profile.userId),
    tombstoned: isProfileTombstoned(profile),
  };
}

/**
 * Every claimed, live account this read may see, deduped by handle. The founders
 * lane is merged in so the founding pack is complete even when the paged scan
 * stops short of them.
 */
async function readCandidates(): Promise<{
  candidates: StarterPackCandidate[];
  truncated: boolean;
}> {
  const store = profileStore();
  const byHandle = new Map<string, StarterPackCandidate>();

  for (const founder of await store.listFoundingMembers()) {
    byHandle.set(founder.handle, toCandidate(founder));
  }

  let afterHandle = "";
  let truncated = false;
  for (let page = 0; page < SCAN_MAX_PAGES; page += 1) {
    const rows = await store.listClaimedProfiles({
      limit: SCAN_PAGE_SIZE,
      ...(afterHandle ? { afterHandle } : {}),
    });
    for (const row of rows) byHandle.set(row.handle, toCandidate(row));
    if (rows.length < SCAN_PAGE_SIZE) break;
    afterHandle = rows[rows.length - 1]!.handle;
    // A full last page means the budget ran out with rows still unread.
    if (page === SCAN_MAX_PAGES - 1) truncated = true;
  }

  return { candidates: [...byHandle.values()], truncated };
}

/** Every pack that has enough real members to show, in policy order. */
export async function loadStarterPacks(): Promise<StarterPackScan> {
  const { candidates, truncated } = await readCandidates();
  const packs: StarterPackView[] = [];
  for (const pack of listStarterPacks()) {
    const members = selectStarterPackMembers(pack, candidates);
    if (!starterPackShows(members.length)) continue;
    packs.push({ ...pack, members, memberCount: members.length });
  }
  return { packs, truncated };
}

/** One pack, or null when its slug names nothing or it is too thin to show. */
export async function loadStarterPack(
  pack: StarterPack,
): Promise<StarterPackView | null> {
  const { candidates } = await readCandidates();
  const members = selectStarterPackMembers(pack, candidates);
  if (!starterPackShows(members.length)) return null;
  return { ...pack, members, memberCount: members.length };
}
