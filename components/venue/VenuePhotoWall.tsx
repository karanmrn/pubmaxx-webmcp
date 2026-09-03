"use client";

// A pub's photo wall: what everybody put on it, newest first, and the one
// button that adds to it.
//
// IT LOADS WHEN IT IS LOOKED AT. The venue sheet renders every tab panel and
// hides the inactive ones, so a wall that fetched on mount would pull a page of
// photos for a reader who opened the pub to check the last train. `active` is
// the gate, and it is the whole reason this component takes one.
//
// IT PAGES RATHER THAN TRUNCATING. A wall is browsed, so "Show more" asks for
// the next keyset page. A cap on the first read would quietly hide the older
// half of a busy pub's wall with nothing on screen saying so.
//
// AN EMPTY WALL AND AN UNREAD WALL ARE TWO SENTENCES. `status` comes back from
// the store's own read, and `venuePhotoWallEmptyLine` says which one this is:
// a failed lookup may never be worded as a pub nobody has photographed.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { categoryLabel } from "@/lib/drinks";

import { useAuth } from "@/components/auth/AuthProvider";
import FoundingMemberMark from "@/components/founding/FoundingMemberMark";
import { authedFetch } from "@/lib/authedFetch";
import {
  venuePhotoAltText,
  venuePhotoWallEmptyLine,
  VENUE_PHOTO_OUTPUT_HEIGHT,
  VENUE_PHOTO_OUTPUT_WIDTH,
  VENUE_PHOTO_SIGN_IN_LINE,
  venuePhotoSignInHref,
  type VenuePhotoDTO,
  type VenuePhotoPage,
  type VenuePhotoReadStatus,
} from "@/lib/venuePhotos";

import VenuePhotoComposer from "./VenuePhotoComposer";
import "./venuePhotoWall.css";

type VenuePhotoWallProps = {
  venueId: string;
  venueName: string;
  /** The tab or section is on screen. Nothing is fetched until it is. */
  active?: boolean;
};

type WallState = {
  photos: VenuePhotoDTO[];
  nextCursor: string | null;
  status: VenuePhotoReadStatus;
};

const EMPTY: WallState = { photos: [], nextCursor: null, status: "ready" };

function isPage(value: unknown): value is VenuePhotoPage {
  return Boolean(value) && Array.isArray((value as VenuePhotoPage).photos);
}

export default function VenuePhotoWall({
  venueId,
  venueName,
  active = true,
}: VenuePhotoWallProps) {
  const { user, handle, configured } = useAuth();
  // Where the sign-in door comes back to. The wall reads from three places, so
  // a hardcoded landing would send a bar-tab reader to the map.
  const pathname = usePathname();
  const [wall, setWall] = useState<WallState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The panel is not remounted between pubs, so a stale wall could linger.
  // Adjust-state-during-render (the repo idiom) resets it when the venue
  // changes - never an effect.
  const [wallVenueId, setWallVenueId] = useState(venueId);
  if (wallVenueId !== venueId) {
    setWallVenueId(venueId);
    setWall(EMPTY);
    setLoaded(false);
    setComposerOpen(false);
    setNote(null);
  }

  const load = useCallback(
    async (cursor: string | null) => {
      try {
        const params = new URLSearchParams({ venueId });
        if (cursor) params.set("cursor", cursor);
        const response = await authedFetch(`/api/venue-photos?${params.toString()}`);
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !isPage(body)) {
          setWall((current) => ({ ...current, status: "degraded" }));
          return;
        }
        setWall((current) => ({
          photos: cursor ? [...current.photos, ...body.photos] : body.photos,
          nextCursor: body.nextCursor,
          status: body.status,
        }));
      } catch {
        setWall((current) => ({ ...current, status: "degraded" }));
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [venueId],
  );

  // The first read starts off a microtask rather than in the effect body: a
  // setState called synchronously from an effect cascades a render, which the
  // repo's lint treats as an error rather than a style note.
  useEffect(() => {
    if (!active || loaded) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      await load(null);
    });
    return () => {
      cancelled = true;
    };
  }, [active, loaded, load]);

  function loadMore(cursor: string): void {
    setLoading(true);
    void load(cursor);
  }

  const canPost = !configured || Boolean(user && handle);
  const empty = loaded && wall.photos.length === 0;

  return (
    <section className="venuePhotoWall" aria-label={`Photos of ${venueName}`}>
      <div className="venuePhotoWallHead">
        <h3 className="venuePhotoWallTitle">Photo wall</h3>
        {wall.photos.length > 0 ? (
          <span className="venuePhotoWallCount">
            {wall.photos.length} {wall.photos.length === 1 ? "photo" : "photos"}
          </span>
        ) : null}
      </div>

      {empty ? (
        <p className="venuePhotoWallEmpty">{venuePhotoWallEmptyLine(wall.status)}</p>
      ) : null}

      {wall.photos.length > 0 ? (
        <div className="venuePhotoGrid">
          {wall.photos.map((photo) => (
            <figure key={photo.id} className="venuePhotoTile">
              <Image
                src={photo.url}
                alt={venuePhotoAltText(photo)}
                width={photo.width || VENUE_PHOTO_OUTPUT_WIDTH}
                height={photo.height || VENUE_PHOTO_OUTPUT_HEIGHT}
                sizes="(max-width: 699px) 50vw, 33vw"
                loading="lazy"
                unoptimized
              />
              {photo.drinkCategory ? (
                <span className="venuePhotoTag">{categoryLabel(photo.drinkCategory)}</span>
              ) : null}
              <figcaption className="venuePhotoByline">
                {photo.author.avatarUrl ? (
                  <Image
                    className="venuePhotoBylineAvatar"
                    src={photo.author.avatarUrl}
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                  />
                ) : null}
                <span className="venuePhotoBylineHandle">@{photo.author.handle}</span>
                {photo.author.foundingMemberNumber !== undefined ? (
                  <FoundingMemberMark
                    number={photo.author.foundingMemberNumber}
                    className="venuePhotoBylineFounding"
                  />
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {wall.nextCursor ? (
        <button
          type="button"
          className="venuePhotoWallButton venuePhotoWallMore"
          disabled={loading}
          onClick={() => loadMore(wall.nextCursor!)}
        >
          {loading ? "Loading…" : "Show more"}
        </button>
      ) : null}

      {note ? (
        <p className="venuePhotoWallStatus" role="status">
          {note}
        </p>
      ) : null}

      {composerOpen ? (
        <VenuePhotoComposer
          venueId={venueId}
          venueName={venueName}
          onCancel={() => setComposerOpen(false)}
          onPosted={(photo, message) => {
            setComposerOpen(false);
            setNote(message);
            setWall((current) => ({ ...current, photos: [photo, ...current.photos] }));
          }}
        />
      ) : (
        <div className="venuePhotoWallActions">
          {canPost ? (
            <button
              type="button"
              className="venuePhotoWallButton"
              onClick={() => setComposerOpen(true)}
            >
              Add a photo
            </button>
          ) : (
            <Link
              className="venuePhotoWallButton venuePhotoWallSignIn"
              href={venuePhotoSignInHref(pathname)}
            >
              {VENUE_PHOTO_SIGN_IN_LINE}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
