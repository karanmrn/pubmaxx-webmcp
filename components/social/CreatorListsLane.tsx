"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerSession } from "@/components/auth/useViewerSession";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import HandleAvatar from "@/components/profile/HandleAvatar";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { authedActionFetch } from "@/lib/authedFetch";
import type { CreatorListDiscoveryItem } from "@/lib/creatorListDiscovery";
import { normalizeHandle } from "@/lib/profiles";
import { discardBody } from "@/lib/responseBody";

type CreatorListsLoadStatus = "loading" | "ready" | "unavailable";

function CreatorListFollowAction({
  list,
  viewerHandle,
}: {
  list: CreatorListDiscoveryItem;
  viewerHandle: string | null;
}): React.JSX.Element | null {
  const viewer = normalizeHandle(viewerHandle ?? "");
  const owner = normalizeHandle(list.ownerHandle);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (viewerHandle === null) return null;
  if (viewer === owner) return null;
  if (!viewer) {
    return (
      <Link href={`/login?mode=signin&from=${encodeURIComponent(list.listUrl)}`}>
        Follow list
      </Link>
    );
  }

  async function follow(): Promise<void> {
    if (busy || following) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authedActionFetch("/api/saved-pubs/list-follows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower: viewer,
          owner,
          listType: list.listType,
          action: "follow",
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessageFrom(body, "Could not follow this list. Try again."));
        return;
      }
      setFollowing(true);
      trackEvent("creator_list_followed");
    } catch {
      setError(
        offlineOrMessage("Could not follow this list. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="creatorListFollowAction">
      <button type="button" disabled={busy || following} onClick={follow}>
        {following ? "Following" : "Follow list"}
      </button>
      {error ? <span role="status">{error}</span> : null}
    </span>
  );
}

export type CreatorListsSettleResult =
  | { outcome: "aborted" }
  | { outcome: "unavailable" }
  | { outcome: "ready"; lists: CreatorListDiscoveryItem[] };

export function parseCreatorListsResponse(
  value: unknown,
): CreatorListDiscoveryItem[] | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { status?: unknown; lists?: unknown };
  if (body.status !== "ready" && body.status !== "degraded") return null;
  const rows = body.lists;
  if (!Array.isArray(rows)) return null;
  const lists: CreatorListDiscoveryItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return null;
    const item = row as Partial<CreatorListDiscoveryItem>;
    const valid =
      typeof item.ownerHandle === "string" &&
      typeof item.listType === "string" &&
      typeof item.listUrl === "string" &&
      typeof item.mapUrl === "string" &&
      typeof item.planUrl === "string" &&
      typeof item.savedCount === "number" &&
      Array.isArray(item.previewVenues) &&
      item.previewVenues.every(
        (venue) =>
          Boolean(venue) &&
          typeof venue.venueId === "string" &&
          typeof venue.venueName === "string" &&
          typeof venue.venueMapUrl === "string",
      );
    if (!valid) return null;
    lists.push(item as CreatorListDiscoveryItem);
  }
  if (body.status === "degraded" && lists.length === 0) return null;
  return lists;
}

export async function settleCreatorListsResponse(
  response: Response,
  signal: { aborted: boolean },
): Promise<CreatorListsSettleResult> {
  if (!response.ok) {
    discardBody(response);
    if (signal.aborted) return { outcome: "aborted" };
    return { outcome: "unavailable" };
  }
  const next = parseCreatorListsResponse(
    await response.json().catch(() => null),
  );
  if (signal.aborted) return { outcome: "aborted" };
  if (!next) return { outcome: "unavailable" };
  return { outcome: "ready", lists: next };
}

export function CreatorListsContent({
  status,
  lists,
  onRetry,
  viewerHandle = "",
}: {
  status: CreatorListsLoadStatus;
  lists: CreatorListDiscoveryItem[];
  onRetry?: () => void;
  viewerHandle?: string | null;
}): React.JSX.Element {
  return (
    <section className="creatorListsLane" aria-labelledby="creator-lists-title">
      <h2 id="creator-lists-title">Creator lists</h2>
      {status === "loading" ? (
        <p className="creatorListsState" role="status">
          Loading creator lists…
        </p>
      ) : status === "unavailable" ? (
        <div className="creatorListsState" role="status">
          <p>We could not reach creator lists.</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : lists.length === 0 ? (
        <div className="creatorListsState">
          <p>No creators have shared a list yet.</p>
          <Link href="/map">Find venues on Map</Link>
        </div>
      ) : (
        <ul className="creatorListsGrid">
          {lists.map((list) => {
            const creatorName = list.ownerDisplayName || `@${list.ownerHandle}`;
            return (
              <li
                className="creatorListCard"
                key={`${list.ownerHandle}:${list.listType}`}
              >
                <Link className="creatorListOwner" href={`/u/${encodeURIComponent(list.ownerHandle)}`}>
                  <HandleAvatar
                    className="creatorListAvatar"
                    imageClassName="creatorListAvatar"
                    handle={list.ownerHandle}
                    displayName={list.ownerDisplayName}
                    avatarUrl={list.ownerAvatarUrl}
                    size={40}
                  />
                  <span>{creatorName}</span>
                </Link>
                <h3>
                  <Link
                    href={list.listUrl}
                    onClick={() => trackEvent("creator_list_viewed")}
                  >
                    {list.listType}
                  </Link>
                </h3>
                <p className="creatorListCount">
                  {list.savedCount} {list.savedCount === 1 ? "venue" : "venues"}
                </p>
                <ul className="creatorListVenues" aria-label={`${list.listType} preview`}>
                  {list.previewVenues.map((venue) => (
                    <li key={venue.venueId}>{venue.venueName}</li>
                  ))}
                </ul>
                <div className="creatorListActions">
                  <Link href={list.listUrl}>View list</Link>
                  <Link
                    href={list.mapUrl}
                    onClick={() => trackEvent("creator_list_map_opened")}
                  >
                    Open Map
                  </Link>
                  <Link
                    className="creatorListPlanAction"
                    href={list.planUrl}
                    onClick={() => trackEvent("creator_list_plan_started")}
                  >
                    Plan night
                  </Link>
                  <CreatorListFollowAction list={list} viewerHandle={viewerHandle} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function CreatorListsLane(): React.JSX.Element {
  const [status, setStatus] = useState<CreatorListsLoadStatus>("loading");
  const [lists, setLists] = useState<CreatorListDiscoveryItem[]>([]);
  const [attempt, setAttempt] = useState(0);
  const viewerSession = useViewerSession();
  const resolvedViewerHandle = useViewerHandle();
  const viewerHandle = viewerSession.unresolved
    ? null
    : viewerSession.signedIn
      ? resolvedViewerHandle
      : "";

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch("/api/creator-lists", {
          signal: controller.signal,
        });
        const result = await settleCreatorListsResponse(
          response,
          controller.signal,
        );
        if (result.outcome === "aborted") return;
        if (result.outcome === "unavailable") {
          setStatus("unavailable");
          return;
        }
        setLists(result.lists);
        setStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("unavailable");
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  return (
    <CreatorListsContent
      status={status}
      lists={lists}
      viewerHandle={viewerHandle}
      onRetry={() => {
        setStatus("loading");
        setAttempt((value) => value + 1);
      }}
    />
  );
}
