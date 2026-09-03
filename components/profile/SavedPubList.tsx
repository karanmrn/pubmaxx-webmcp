"use client";

import Link from "next/link";

import EmptyState from "@/components/EmptyState";
import { normalizeHandle } from "@/lib/profiles";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";
import { BUILT_IN_LIST_TYPES } from "@/lib/savedListPolicy";
import { savedListPath } from "@/lib/savedListUrl";
import {
  type FollowedSavedListDTO,
  type ListType,
  type SavedPubDTO,
} from "@/lib/savedPubs";

// Presentational saved-venue lists, grouped by list type. Prop-driven: the page
// resolves saves (durable API when a handle exists, else localStorage) into
// SavedPubDTO groups and passes the grouped map. Each item renders the resolved
// venue name (never a raw "venue-…" id) linking to the venue on the map, filed under
// each list heading. Empty lists are skipped; a fully-empty state shows a
// friendly hint.
type SavedPubListProps = {
  ownerHandle?: string;
  groups: Partial<Record<ListType, SavedPubDTO[]>>;
  followedLists?: FollowedSavedListDTO[];
};

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function SavedPubList({
  ownerHandle,
  groups,
  followedLists = [],
}: SavedPubListProps) {
  const owner = normalizeHandle(ownerHandle);
  // Render built-ins in canonical order, then any custom list names the handle has
  // actually used. Custom lists are first-class B3 list names, not filtered out.
  const builtIns = BUILT_IN_LIST_TYPES.filter((t) => (groups[t]?.length ?? 0) > 0);
  const builtInSet = new Set<string>(BUILT_IN_LIST_TYPES);
  const custom = Object.keys(groups)
    .filter((t) => !builtInSet.has(t) && (groups[t]?.length ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b));
  const populated = [...builtIns, ...custom];

  if (populated.length === 0) {
    return (
      <>
        <section className="savedSection" aria-labelledby="savedHeading">
          <h2 id="savedHeading" className="savedHeading">
            Saved venues
          </h2>
          <EmptyState
            eyebrow="Your lists"
            title="No saved venues yet."
            body="Save a venue from the map to start a list. Favourites, want-to-try, whatever you call it."
            action={<Link href="/map">Open the map</Link>}
          />
        </section>
        <FollowedLists lists={followedLists} />
      </>
    );
  }

  return (
    <>
      <section className="savedSection" aria-labelledby="savedHeading">
        <h2 id="savedHeading" className="savedHeading">
          Saved venues
        </h2>
        <div className="savedLists">
          {populated.map((listType) => {
            const venues = groups[listType] ?? [];
            return (
              <div className="savedList" key={listType}>
                <h3 className="savedListName">
                  {owner ? (
                    <Link
                      className="savedListNameLink"
                      href={savedListPath(owner, listType)}
                    >
                      {listType}
                    </Link>
                  ) : (
                    listType
                  )}
                  <span className="savedListCount" aria-hidden="true">
                    {" "}
                    · {venues.length}
                  </span>
                </h3>
                <ul className="savedListItems">
                  {venues.map((venue) => (
                    <li className="savedItem" key={`${venue.venueId}:${listType}`}>
                      <Link className="savedItemVenue" href={venue.venueMapUrl}>
                        {venue.venueName}
                      </Link>
                      {venue.note ? <span className="savedItemNote">{venue.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
      <FollowedLists lists={followedLists} />
    </>
  );
}

function FollowedLists({ lists }: { lists: FollowedSavedListDTO[] }) {
  if (lists.length === 0) return null;

  return (
    <section className="followedListsSection" aria-labelledby="followedListsHeading">
      <h2 id="followedListsHeading" className="savedHeading">
        Followed lists
      </h2>
      <div className="followedLists">
        {lists.map((list) => (
          <article className="followedList" key={`${list.ownerHandle}:${list.listType}`}>
            <div className="followedListTop">
              <Link className="followedListName" href={list.listUrl}>
                {list.listType}
              </Link>
              <Link className="followedListAuthor" href={list.ownerProfileUrl}>
                By @{list.ownerHandle}
              </Link>
            </div>
            <p className="followedListCounts">
              {formatSavedVenueCount(list.savedCount)} ·{" "}
              {formatCount(list.followerCount, "follower", "followers")}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
