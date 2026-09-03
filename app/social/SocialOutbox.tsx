"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { authedActionFetch } from "@/lib/authedFetch";
import type { SocialPostDTO } from "@/lib/socialPosts";
import { discardBody } from "@/lib/responseBody";

import {
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";
import SocialComposer from "./SocialComposer";

type LegacyOutboxItem = {
  id: string;
  moderationState: "pending" | "needs_review";
  revision: number;
  createdAt: string;
};
type OutboxItem = SocialPostDTO | LegacyOutboxItem;

function isPost(item: OutboxItem): item is SocialPostDTO {
  return "body" in item && "ownedByViewer" in item;
}

function mergeItems(
  current: OutboxItem[],
  incoming: OutboxItem[],
): OutboxItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || item.revision >= existing.revision) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function stateLabel(item: OutboxItem): string {
  if (item.moderationState === "needs_review") return "Held for review";
  if (item.moderationState === "pending") return "Moderation pending";
  if (!isPost(item)) return "Moderation approved";
  return {
    private: "Private",
    friends: "Friends",
    public: "Public",
  }[item.visibility];
}

export default function SocialOutbox({
  draftScope,
  submittedPost,
  onPostChanged,
}: {
  draftScope: string | null;
  submittedPost: SocialPostDTO | null;
  onPostChanged: (post?: SocialPostDTO) => void;
}) {
  const { identityResolved, user } = useAuth();
  const viewerPhase: SocialViewerPhase =
    !identityResolved ? "unresolved" : user ? "resolved" : "signed-out";
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (
    cursor: string | null = null,
    signal?: AbortSignal,
  ) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (cursor) {
        params.set("cursor", cursor);
        params.set("limit", "20");
      }
      const response = await authedActionFetch(
        `/api/social/outbox${params.size ? `?${params}` : ""}`,
        { cache: "no-store", signal },
      );
      if (!response.ok) {
        discardBody(response);
        throw new Error("Outbox read failed");
      }
      const value = (await response.json()) as {
        posts?: OutboxItem[];
        nextCursor?: string | null;
      };
      if (signal?.aborted) return;
      setItems((current) => mergeItems(current, value.posts ?? []));
      setNextCursor(value.nextCursor ?? null);
    } catch {
      if (signal?.aborted) return;
      setError(cursor
        ? "Older posts are unavailable right now."
        : "Posts are unavailable right now.");
    } finally {
      if (!signal?.aborted) {
        if (cursor) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (viewerPhase !== "resolved") return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadPage(null, controller.signal));
    return () => controller.abort();
  }, [loadPage, submittedPost?.id, submittedPost?.revision, viewerPhase]);

  const visibleItems = submittedPost
    ? mergeItems(items, [submittedPost])
    : items;
  if (viewerPhase !== "resolved") {
    return (
      <section
        className="socialOutbox"
        aria-labelledby="social-outbox-title"
      >
        <h2 id="social-outbox-title">Outbox</h2>
        <SocialViewerState
          phase={viewerPhase}
          loadingLabel="Loading your outbox"
          inviteMessage="See your posts."
        />
      </section>
    );
  }
  if (visibleItems.length === 0 && !error) return null;
  return (
    <section
      className="socialOutbox"
      aria-labelledby="social-outbox-title"
      aria-busy={loading || loadingMore}
    >
      <h2 id="social-outbox-title">Outbox</h2>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {visibleItems.map((item) => (
          <li key={item.id} className="socialOutboxItem">
            <strong>{stateLabel(item)}</strong>
            {isPost(item) ? (
              <>
                {item.body ? <p>{item.body}</p> : null}
                {draftScope && item.ownedByViewer ? (
                  <SocialComposer
                    post={item}
                    draftScope={draftScope}
                    triggerLabel={
                      item.visibility === "private"
                        ? "Edit private post"
                        : "Edit outbox post"
                    }
                    onSaved={(updated) => {
                      if (updated) {
                        setItems((current) => mergeItems(current, [updated]));
                      }
                      onPostChanged(updated);
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {error && !loading ? (
        <button
          className="socialOutboxRetry"
          type="button"
          onClick={() => void loadPage()}
        >
          Retry
        </button>
      ) : null}
      {nextCursor ? (
        <button
          className="socialOutboxMore"
          type="button"
          aria-busy={loadingMore}
          aria-label="Load more"
          disabled={loadingMore}
          onClick={() => void loadPage(nextCursor)}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}
