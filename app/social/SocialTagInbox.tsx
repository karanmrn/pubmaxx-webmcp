"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  AuthActionSessionError,
  authedActionFetch,
} from "@/lib/authedFetch";
import type { SocialPostVisibility } from "@/lib/socialPosts";
import { discardBody } from "@/lib/responseBody";

import {
  SocialViewerState,
  type SocialViewerPhase,
} from "@/components/social/SocialViewerState";

type Proposal = {
  id: string;
  postId: string;
  mediaId: string | null;
  authorHandle: string;
  state: "proposed" | "approved";
  visibility: SocialPostVisibility;
  photoAltText: string | null;
  reviewRevision: number;
  audienceAtApproval: {
    visibility: SocialPostVisibility;
    revision: number;
    shownAt: string;
  } | null;
};
type Lane = "proposed" | "approved";
type LaneState = {
  items: Proposal[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  retryCursor: string | null;
};

const EMPTY_LANE: LaneState = {
  items: [],
  nextCursor: null,
  loading: false,
  error: null,
  retryCursor: null,
};
const LANE_LABEL: Record<Lane, string> = {
  proposed: "Tags to review",
  approved: "Approved tags",
};
const AUDIENCE_LABEL: Record<SocialPostVisibility, string> = {
  private: "Private audience",
  friends: "Friends audience",
  public: "Public audience",
};

function mergeProposals(current: Proposal[], incoming: Proposal[]): Proposal[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export default function SocialTagInbox() {
  const { identityResolved, user } = useAuth();
  const viewerPhase: SocialViewerPhase =
    !identityResolved ? "unresolved" : user ? "resolved" : "signed-out";
  const [lanes, setLanes] = useState<Record<Lane, LaneState>>({
    proposed: EMPTY_LANE,
    approved: EMPTY_LANE,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLane = useCallback(
    async (lane: Lane, cursor: string | null = null) => {
      setLanes((current) => ({
        ...current,
        [lane]: { ...current[lane], loading: true, error: null },
      }));
      const params = new URLSearchParams({ lane, limit: "20" });
      if (cursor) params.set("cursor", cursor);
      try {
        const response = await authedActionFetch(`/api/social/tags?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          discardBody(response);
          throw new Error("Tag lane read failed");
        }
        const value = (await response.json()) as {
          proposals?: Proposal[];
          nextCursor?: string | null;
        };
        setLanes((current) => ({
          ...current,
          [lane]: {
            items: cursor
              ? mergeProposals(current[lane].items, value.proposals ?? [])
              : value.proposals ?? [],
            nextCursor: value.nextCursor ?? null,
            loading: false,
            error: null,
            retryCursor: null,
          },
        }));
      } catch (caught) {
        setLanes((current) => ({
          ...current,
          [lane]: {
            ...current[lane],
            loading: false,
            error:
              caught instanceof AuthActionSessionError
                ? caught.message
                : `${LANE_LABEL[lane]} are unavailable right now.`,
            retryCursor: cursor,
          },
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (viewerPhase !== "resolved") return;
    void Promise.resolve().then(() =>
      Promise.all([loadLane("proposed"), loadLane("approved")]),
    );
  }, [loadLane, viewerPhase]);

  async function act(
    item: Proposal,
    action: "approve" | "decline" | "withdraw",
  ) {
    setBusyId(item.id);
    setError(null);
    try {
      const response = await authedActionFetch("/api/social/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: item.id,
          action,
          ...(action === "approve"
            ? { expectedAudienceRevision: item.reviewRevision }
            : {}),
        }),
      });
      if (!response.ok) {
        discardBody(response);
        if (action === "approve") {
          setError("Photo tag changed. Review it again.");
          await Promise.all([loadLane("proposed"), loadLane("approved")]);
        } else {
          setError("Photo tag choice was not saved.");
        }
        return;
      }
      await Promise.all([loadLane("proposed"), loadLane("approved")]);
    } catch (caught) {
      setError(
        caught instanceof AuthActionSessionError
          ? caught.message
          : "Photo tag choice was not saved.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const hasLaneContent = (Object.keys(lanes) as Lane[]).some((lane) =>
    lanes[lane].items.length > 0 || lanes[lane].loading || lanes[lane].error,
  );
  if (viewerPhase !== "resolved") {
    return (
      <section className="socialTagInbox" aria-labelledby="social-tags-title">
        <h2 id="social-tags-title">Photo tags</h2>
        <SocialViewerState
          phase={viewerPhase}
          loadingLabel="Loading photo tags"
          inviteMessage="Review your photo tags."
        />
      </section>
    );
  }
  if (!hasLaneContent && !error) return null;
  return (
    <section className="socialTagInbox" aria-labelledby="social-tags-title">
      <h2 id="social-tags-title">Photo tags</h2>
      {error ? <p role="alert">{error}</p> : null}
      {(["proposed", "approved"] as const).map((lane) => {
        const state = lanes[lane];
        if (state.items.length === 0 && !state.loading && !state.error) return null;
        return (
          <section
            key={lane}
            className="socialTagLane"
            aria-label={LANE_LABEL[lane]}
            aria-busy={state.loading}
          >
            {state.loading ? <p role="status">Loading {LANE_LABEL[lane].toLowerCase()}…</p> : null}
            {state.error ? <p role="alert">{state.error}</p> : null}
            {state.items.map((item) => {
              const audience = item.state === "approved"
                ? item.audienceAtApproval?.visibility ?? item.visibility
                : item.visibility;
              return (
                <article key={item.id} className="socialTagItem">
                  <strong>@{item.authorHandle}</strong>
                  {item.mediaId && item.photoAltText ? (
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element -- private consent-review delivery route. */}
                      <img
                        src={`/api/social/media/${item.mediaId}`}
                        alt={item.photoAltText}
                      />
                    </figure>
                  ) : null}
                  <p>{AUDIENCE_LABEL[audience]}</p>
                  <div>
                    {lane === "proposed" ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void act(item, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void act(item, "decline")}
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void act(item, "withdraw")}
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {state.error ? (
              <button
                className="socialTagRetry"
                type="button"
                onClick={() => void loadLane(lane, state.retryCursor)}
              >
                Retry {LANE_LABEL[lane].toLowerCase()}
              </button>
            ) : null}
            {state.nextCursor ? (
              <button
                className="socialTagMore"
                type="button"
                onClick={() => void loadLane(lane, state.nextCursor)}
              >
                Load more
              </button>
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
