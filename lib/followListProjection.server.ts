import "server-only";

import type { FollowListEntry } from "@/lib/followList";
import { log } from "@/lib/log";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore, type ProfilePublicCard } from "@/lib/profileStore";

/**
 * Public projection for the handles in a followers/following list.
 *
 * TWO rules, both learned the hard way on a route that is public, unpaginated
 * and unauthenticated:
 *
 * 1. ONE round trip. A point read per handle fanned out one PostgREST call per
 *    follower, all concurrent, on a profile anybody can ask about.
 * 2. Enrichment is DECORATION, so a read that could not answer costs the caller
 *    a name and a face, never the list. A projection failure that emptied the
 *    list would reach the feed's Friends lane and the followers page as "you
 *    follow nobody", which is the tri-state confusion this repo forbids. It is
 *    invisible to the reader by design, so it names itself once in the log
 *    rather than degrading in silence.
 */
export async function followListEntries(handles: string[]): Promise<FollowListEntry[]> {
  const rows: FollowListEntry[] = [];
  for (const raw of handles) {
    const handle = normalizeHandle(raw);
    if (handle) rows.push({ handle });
  }
  if (rows.length === 0) return rows;

  let cards: ReadonlyMap<string, ProfilePublicCard>;
  try {
    cards = await profileStore().getPublicCardsByHandles(rows.map((row) => row.handle));
  } catch (error) {
    log("warn", "follow_list.enrichment_failed", {
      handles: rows.length,
      detail: error instanceof Error ? error.message : String(error),
    });
    return rows;
  }

  return rows.map((row) => {
    const card = cards.get(row.handle);
    return card ? { ...row, ...card } : row;
  });
}
