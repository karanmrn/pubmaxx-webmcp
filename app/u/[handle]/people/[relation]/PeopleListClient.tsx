"use client";

// Followers and Following for one handle, and who among them is a mate.
//
// Both directions read the same shape (a list of `FollowListEntry` rows) from
// their own public route, through the ONE parser in lib/followList.ts, and the
// mutual overlay is the intersection with this handle's /lot.
// That matters because the two lists look identical otherwise: a follower who
// is also followed back is a MATE, and a list that cannot say so is a list of
// strangers. The relation word comes from lib/followRelation.ts so this file
// holds no policy.
//
// Public projection only. A handle plus, when the profile read offers it, a
// display name and an owned avatar. Nothing else about a person travels here.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { followRelationHint, resolveFollowRelation } from "@/lib/followRelation";
import { displayHandle } from "@/lib/handleDisplay";
import { type FollowListEntry, parseFollowListEntry } from "@/lib/followList";
import { normalizeHandle } from "@/lib/profiles";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import { SocialAccessBoundary } from "@/app/social/SocialPageClient";

import "@/components/social/peopleDirectory.css";

export type PeopleRelation = "followers" | "following";

type LoadState = "loading" | "ready" | "error";

const TITLE: Record<PeopleRelation, string> = {
  followers: "Followers",
  following: "Following",
};

const EMPTY: Record<PeopleRelation, string> = {
  followers: "Nobody follows this handle yet.",
  following: "This handle follows nobody yet.",
};

const PEOPLE_SNAPSHOT_MAX_AGE_MS = 60_000;
const OFFLINE_ERROR = "You look offline. We will retry when you are back.";

type PeopleListResponse = Record<string, unknown>;
type PeopleLotResponse = { lot?: unknown };

function initial(handle: string): string {
  const clean = normalizeHandle(handle);
  return clean ? clean.slice(0, 1).toUpperCase() : "?";
}

export default function PeopleListClient({
  handle,
  relation,
}: {
  handle: string;
  relation: PeopleRelation;
}) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [status, setStatus] = useState<LoadState>("loading");
  const [people, setPeople] = useState<FollowListEntry[]>([]);
  const [mutuals, setMutuals] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!socialFriendsLaunchEnabled) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => setStatus("loading"));
    void (async () => {
      const listKey = `/api/profiles/${encodeURIComponent(handle)}/${relation}`;
      const lotKey = `/api/profiles/${encodeURIComponent(handle)}/lot`;
      const listPromise = loadSurfaceJson<PeopleListResponse>(
        listKey,
        {
          signal: controller.signal,
          maxAgeMs: PEOPLE_SNAPSHOT_MAX_AGE_MS,
          validate: (body) => Array.isArray(body?.[relation]),
        },
        (body) => {
          const rows = body[relation];
          if (!Array.isArray(rows)) return false;
          setPeople(
            rows
              .map((row) => parseFollowListEntry(row))
              .filter((row): row is FollowListEntry => row !== null),
          );
          setStatus("ready");
          return true;
        },
      );
      const lotPromise = loadSurfaceJson<PeopleLotResponse>(
        lotKey,
        {
          signal: controller.signal,
          maxAgeMs: PEOPLE_SNAPSHOT_MAX_AGE_MS,
          validate: (body) => Boolean(body && typeof body === "object"),
        },
        (body) => {
          if (Array.isArray(body.lot)) setMutuals(new Set(body.lot.filter((entry): entry is string => typeof entry === "string")));
        },
      );
      const [listOutcome] = await Promise.all([listPromise, lotPromise]);
      if (listOutcome === "failed" && !controller.signal.aborted) {
        setPeople([]);
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [attempt, handle, relation, socialFriendsLaunchEnabled]);

  const retry = useCallback(() => {
    if (!socialFriendsLaunchEnabled) return;
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, [socialFriendsLaunchEnabled]);

  useReconnectRecovery(status === "error", retry);

  const offline = typeof window !== "undefined" && window.navigator?.onLine === false;

  if (!socialFriendsLaunchEnabled) {
    return <SocialAccessBoundary state="preview" friendsLaunchEnabled={false} />;
  }

  return (
    <section className="peopleDir" aria-labelledby="people-list-title">
      <h1 id="people-list-title" className="peopleDir__title">
        {TITLE[relation]}
      </h1>
      <p className="peopleDir__body">
        <Link className="peopleDir__handle" href={`/u/${encodeURIComponent(handle)}`}>
          {displayHandle(handle)}
        </Link>
      </p>

      {status === "loading" ? (
        <div className="peopleDir__skeletons" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : status === "error" ? (
        <div className="peopleDir__notice" role="alert">
          <p>{offline ? OFFLINE_ERROR : "Could not load this list. That is us, not you."}</p>
          <button
            type="button"
            className="peopleDir__button"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : people.length === 0 ? (
        <p className="peopleDir__body" role="status">
          {EMPTY[relation]}
        </p>
      ) : (
        <ul className="peopleDir__grid">
          {people.map((entry) => {
            const clean = entry.handle;
            // Seen from THIS profile: a row in Followers already follows it, a
            // row in Following is already followed by it, and /lot decides the
            // other edge.
            const rowRelation = resolveFollowRelation({
              viewerFollowing:
                relation === "following" || mutuals.has(clean),
              followsViewer: relation === "followers" || mutuals.has(clean),
            });
            const hint = followRelationHint(rowRelation);
            return (
              <li key={clean} className="peopleDir__card">
                <Link
                  className="peopleDir__identity"
                  href={`/u/${encodeURIComponent(clean)}`}
                >
                  <span className="peopleDir__avatar" aria-hidden="true">
                    {entry.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- owned avatar path
                      <img src={entry.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      initial(clean)
                    )}
                  </span>
                  <span className="peopleDir__names">
                    <span className="peopleDir__handle">{displayHandle(clean)}</span>
                    {entry.displayName ? (
                      <span className="peopleDir__display">{entry.displayName}</span>
                    ) : hint ? (
                      <span className="peopleDir__display">{hint}</span>
                    ) : null}
                  </span>
                </Link>
                {mutuals.has(clean) ? (
                  <span className="peopleDir__self">Mates</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
