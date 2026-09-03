"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import ShareBar from "@/components/share/ShareBar";
import { useAuth } from "@/components/auth/AuthProvider";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import { normalizeHandle } from "@/lib/profiles";
import { formatSavedVenueCount } from "@/lib/savedListPresentation";
import { savedListPath } from "@/lib/savedListUrl";
import { buildSavedListShareText } from "@/lib/shareArtifacts";
import type { ListType, SavedPubDTO } from "@/lib/savedPubs";
import { authedActionFetch } from "@/lib/authedFetch";
import { creatorListMapHref } from "@/lib/creatorListMap";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

type SavedListCounts = {
  followers: number | null;
  savedPubs: number;
};

type SavedListDetailProps = {
  ownerHandle: string;
  listType: ListType;
  venues: SavedPubDTO[];
  initialCounts: SavedListCounts;
  initialFollowing?: boolean;
  viewerHandle?: string;
};

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readCounts(value: unknown): { followers: number | null; savedPubs: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { followers?: unknown; savedPubs?: unknown };
  const followers =
    typeof raw.followers === "number" && Number.isFinite(raw.followers) && raw.followers >= 0
      ? raw.followers
      : null;
  const savedPubs =
    typeof raw.savedPubs === "number" && Number.isFinite(raw.savedPubs) && raw.savedPubs >= 0
      ? raw.savedPubs
      : null;
  return { followers, savedPubs };
}

function ownerProfileUrl(ownerHandle: string): string {
  return `/u/${encodeURIComponent(ownerHandle)}`;
}

export default function SavedListDetail({
  ownerHandle,
  listType,
  venues,
  initialCounts,
  initialFollowing = false,
}: SavedListDetailProps) {
  const owner = normalizeHandle(ownerHandle);
  const { accountRevision, user } = useAuth();
  const liveViewerHandle = useViewerHandle();
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const viewer = user ? normalizeHandle(liveViewerHandle ?? "") : "";
  const viewerKey = `${accountRevision}:${viewer}`;
  const [following, setFollowing] = useState(initialFollowing);
  const [followStateKey, setFollowStateKey] = useState(viewerKey);
  const viewerKeyRef = useRef(viewerKey);
  const [counts, setCounts] = useState(initialCounts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerStateReady = followStateKey === viewerKey;
  const canFollow = socialFriendsLaunchEnabled && viewerStateReady && viewer !== "" && viewer !== owner;
  const shareUrl = savedListPath(owner, listType);
  const mapHref = creatorListMapHref(venues);
  const shareText = buildSavedListShareText({
    owner,
    listType,
    venueCount: counts.savedPubs,
  });

  useEffect(() => {
    viewerKeyRef.current = viewerKey;
    void Promise.resolve().then(() => {
      setFollowStateKey(viewerKey);
      setFollowing(false);
      setBusy(false);
      setError(null);
    });
  }, [viewerKey]);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled || !canFollow) return;
    const controller = new AbortController();

    async function loadState() {
      try {
        const res = await fetch(
          `/api/saved-pubs/list-follows?follower=${encodeURIComponent(viewer)}&owner=${encodeURIComponent(
            owner,
          )}&listType=${encodeURIComponent(listType)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { following?: unknown; counts?: unknown };
        if (!controller.signal.aborted && viewerKeyRef.current === viewerKey) {
          if (typeof body.following === "boolean") setFollowing(body.following);
          const nextCounts = readCounts(body.counts);
          if (nextCounts) {
            setCounts((current) => ({
              followers: nextCounts.followers,
              savedPubs: nextCounts.savedPubs ?? current.savedPubs,
            }));
          }
        }
      } catch {
        // Follow state is additive UI; the static page remains useful if it fails.
      }
    }

    void loadState();
    return () => controller.abort();
  }, [canFollow, listType, owner, socialFriendsLaunchEnabled, viewer, viewerKey]);

  async function toggleFollow() {
    if (busy || !canFollow || !socialFriendsLaunchEnabled) return;
    setBusy(true);
    setError(null);

    const next = !following;
    const previousCounts = counts;
    setFollowing(next);
    setCounts({
      ...counts,
      followers:
        counts.followers === null
          ? null
          : Math.max(0, counts.followers + (next ? 1 : -1)),
    });

    try {
      const res = await authedActionFetch("/api/saved-pubs/list-follows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower: viewer,
          owner,
          listType,
          action: next ? "follow" : "unfollow",
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFollowing(!next);
        setCounts(previousCounts);
        setError(
          offlineOrMessage(errorMessageFrom(body, "Could not update this list. Try again."))
        );
        return;
      }

      if (body && typeof body === "object") {
        const b = body as { following?: unknown; counts?: unknown };
        if (typeof b.following === "boolean") setFollowing(b.following);
        const nextCounts = readCounts(b.counts);
        if (nextCounts) {
          setCounts((current) => ({
            followers: nextCounts.followers,
            savedPubs: nextCounts.savedPubs ?? current.savedPubs,
          }));
        }
      }
    } catch {
      setFollowing(!next);
      setCounts(previousCounts);
      setError(
        offlineOrMessage("Could not update this list. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="listDetailHero" aria-labelledby="listDetailHeading">
        <div className="listDetailTitleBlock">
          <p className="listDetailEyebrow">Saved list</p>
          <h1 id="listDetailHeading" className="listDetailTitle">
            {listType}
          </h1>
          <Link className="listDetailAuthor" href={ownerProfileUrl(owner)}>
            By @{owner}
          </Link>
        </div>
        <div className="listDetailMeta" aria-label="List counts">
          <span>{formatSavedVenueCount(counts.savedPubs)}</span>
          {socialFriendsLaunchEnabled && counts.followers !== null ? (
            <span>{formatCount(counts.followers, "follower", "followers")}</span>
          ) : null}
        </div>
        {canFollow ? (
          <div className="listFollowControl">
            <button
              type="button"
              className={`followBtn${following ? " isFollowing" : ""}`}
              aria-pressed={following}
              disabled={busy}
              onClick={toggleFollow}
            >
              {following ? "Following list" : "Follow list"}
            </button>
            {error ? (
              <span className="followError" role="status">
                {error}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="listDetailShare" aria-label={shareText}>
          <ShareBar
            url={shareUrl}
            title={`${listType} by @${owner}`}
            text={shareText}
          />
        </div>
        {mapHref ? (
          <Link className="listMapAction" href={mapHref}>
            View list on Map
          </Link>
        ) : null}
      </section>

      <section className="savedSection" aria-labelledby="listVenuesHeading">
        <h2 id="listVenuesHeading" className="savedHeading">
          Venues in this list
        </h2>
        {venues.length === 0 ? (
          <p className="profileEmpty">@{owner} has not saved any venues to this list yet.</p>
        ) : (
          <ul className="savedListItems listDetailItems">
            {venues.map((venue) => (
              <li className="savedItem listDetailItem" key={`${venue.venueId}:${venue.listType}`}>
                <Link className="savedItemVenue" href={venue.venueMapUrl}>
                  {venue.venueName}
                </Link>
                {venue.note ? <span className="savedItemNote">{venue.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
