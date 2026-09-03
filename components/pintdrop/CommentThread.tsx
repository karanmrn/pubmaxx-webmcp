"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { displayHandle } from "@/lib/handleDisplay";
import HandleAvatar from "@/components/profile/HandleAvatar";
import { subscribeToComments } from "@/lib/realtime";
import { relativeTime } from "@/lib/relativeTime";
import { readCommentDraft, subscribeCommentDraft, writeCommentDraft } from "@/lib/socialDrafts";
import { authedActionFetch } from "@/lib/authedFetch";

// The comment thread under a Pint Drop — where a drop's story continues after
// the night (cc_plan2 §4), now with one-level THREADED replies (issue #37) and
// LIVE updates. Collapsed by default so it stays out of the way on a mobile
// feed; expanding lazily fetches the thread (visible-only, thread-ordered) and
// reveals a compact composer.
//
// Resilience contract: this component NEVER crashes its host page. A failed
// fetch or post shows a quiet inline message and leaves the drop card intact —
// the feed treats "no comments" and "comments unavailable" the same way.
//
// LIVE (issue #37): while open, we subscribe to new comments on this drop. The
// subscription is a SIGNAL ONLY — on any event we REFETCH through the existing
// GET /api/pint-drops/comments (visible-only, thread-ordered), never rendering
// the raw realtime payload (which could leak a hidden/anonymous row). With no
// Supabase env the helper degrades to a 30s poll; if the channel drops it falls
// back to polling too — either way the thread stays fresh without a crash.
//
// React 19 hygiene: fetch happens inside an effect (with AbortController
// cleanup); setState only ever runs in async handlers / effect callbacks, never
// synchronously during render (react-hooks/set-state-in-effect). The remembered
// handle is read once via lazy useState init and written only in a handler.

type Comment = {
  id: string;
  handle: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  avatarUrl?: string;
};

// Wave I1: same key as feed / profile / composer so comments don't invent a
// second identity lane beside `pubmax_handle`.
const HANDLE_STORAGE_KEY = "pubmax_handle";
const LEGACY_HANDLE_STORAGE_KEY = "pubmax:comment:handle";
const MAX_BODY = 500;

// Lazy, guarded localStorage read — runs once in useState init, never in an
// effect. Any access error (private mode / disabled storage) → empty handle.
// Migrates the pre-Wave-I comment-only key so existing commenters keep identity.
function readStoredHandle(): string {
  if (typeof window === "undefined") return "";
  try {
    const current = window.localStorage.getItem(HANDLE_STORAGE_KEY);
    if (current) return current;
    const legacy = window.localStorage.getItem(LEGACY_HANDLE_STORAGE_KEY);
    if (legacy) {
      window.localStorage.setItem(HANDLE_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_HANDLE_STORAGE_KEY);
      return legacy;
    }
    return "";
  } catch {
    return "";
  }
}

function writeStoredHandle(handle: string): void {
  try {
    window.localStorage.setItem(HANDLE_STORAGE_KEY, handle);
  } catch {
    // Storage full / denied — best-effort persistence; the in-memory value the
    // user typed still drives this session.
  }
}

export default function CommentThread({
  dropId,
  variant = "default",
}: {
  dropId: string;
  // Taste fix (feed card slim, 2026-07): the feed card folds this thread's
  // toggle into its single compact action row — a small tappable count pill
  // instead of the always-full-width bar the standalone permalink still uses.
  // "compact" only changes the OUTER shape (button + where the panel breaks to
  // its own line); the fetch/post/live-subscribe behaviour above is identical.
  variant?: "default" | "compact";
}) {
  const [restoredDraft] = useState(() => readCommentDraft(dropId));
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle is read from storage exactly once (lazy init); the textarea below is
  // the working draft.
  const [handle, setHandle] = useState<string>(() => readStoredHandle());
  const [body, setBody] = useState(restoredDraft.body);
  const [posting, setPosting] = useState(false);
  // Which top-level comment the reply composer is currently attached to (null =
  // the top-level composer). One reply composer is open at a time.
  const [replyTo, setReplyTo] = useState<string | null>(restoredDraft.replyTo);
  const [replyBody, setReplyBody] = useState(restoredDraft.replyBody);

  useEffect(() => {
    writeCommentDraft(dropId, { body, replyTo, replyBody });
  }, [body, dropId, replyBody, replyTo]);

  useEffect(() => subscribeCommentDraft(dropId, () => {
    const next = readCommentDraft(dropId);
    setBody(next.body);
    setReplyTo(next.replyTo);
    setReplyBody(next.replyBody);
  }), [dropId]);

  // A ref to the latest fetch routine so the realtime subscription (set up in a
  // separate effect keyed only on open/dropId) can trigger a refetch without
  // re-subscribing on every state change.
  const refetchRef = useRef<() => void>(() => {});

  // Fetch the thread when the panel first opens (or the drop changes while
  // open). AbortController cleanup cancels an in-flight request so a fast
  // collapse/re-expand can't land a stale response. Extracted callback so both
  // the open-effect and the live subscription can invoke it.
  const fetchThread = useCallback(
    (signal?: AbortSignal) => {
      Promise.resolve()
        .then(() => {
          setLoading(true);
          setError(null);
          return fetch(`/api/pint-drops/comments?dropId=${encodeURIComponent(dropId)}`, {
            signal,
          });
        })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { comments?: Comment[] }) => {
          setComments(Array.isArray(data.comments) ? data.comments : []);
          setLoaded(true);
        })
        .catch((err: unknown) => {
          if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
            return; // expected on unmount / collapse — not an error to surface
          }
          setError("Couldn't load comments.");
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [dropId],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    // Keep the ref pointed at a signal-less refetch for the live path (a live
    // refetch shouldn't be cancelled by this effect's cleanup).
    refetchRef.current = () => fetchThread();
    fetchThread(controller.signal);
    return () => controller.abort();
  }, [open, dropId, fetchThread]);

  // LIVE subscription (issue #37) — signal only, refetch through the filtered
  // API. Only active while the panel is open. Degrades to a 30s poll with no
  // Supabase env / on a dropped channel (subscribeToComments handles both).
  useEffect(() => {
    if (!open || !dropId) return;
    const nudge = () => refetchRef.current();
    const unsubscribe = subscribeToComments(dropId, nudge, { poll: nudge });
    return unsubscribe;
  }, [open, dropId]);

  // Post a comment or a reply. `parentId` null → top-level; a comment id → a
  // one-level reply. Reconciles from the server response (server-cleaned +
  // real id/timestamp) rather than trusting the optimistic copy; the live
  // subscription also re-syncs, so a lost response still catches up.
  const post = useCallback(
    async (text: string, parentId: string | null) => {
      const trimmedHandle = handle.trim();
      const trimmedBody = text.trim();
      if (!trimmedHandle || !trimmedBody || posting) return;

      setPosting(true);
      setError(null);
      writeStoredHandle(trimmedHandle);

      try {
        const res = await authedActionFetch("/api/pint-drops/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dropId,
            handle: trimmedHandle,
            body: trimmedBody,
            ...(parentId ? { parentId } : {}),
          }),
        });
        if (!res.ok) {
          discardBody(res);
          setError(
            res.status === 429
              ? "You're commenting too fast. Give it a sec."
              : res.status === 400
                ? "Couldn't post that reply."
                : "Couldn't post that comment.",
          );
          return;
        }
        const data = (await res.json()) as { comment?: Comment };
        if (data.comment) {
          const posted = data.comment;
          // Insert in thread order: a reply goes right after the last comment
          // belonging to its parent's group; a top-level comment appends.
          setComments((prev) => insertThreaded(prev, posted));
          if (parentId) {
            setReplyBody("");
            setReplyTo(null);
          } else {
            setBody("");
          }
        }
      } catch {
        setError("Couldn't post that comment.");
      } finally {
        setPosting(false);
      }
    },
    [handle, posting, dropId],
  );

  const submitTop = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void post(body, null);
    },
    [post, body],
  );

  const submitReply = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (replyTo) void post(replyBody, replyTo);
    },
    [post, replyBody, replyTo],
  );

  const count = comments.length;
  const isCompact = variant === "compact";

  // Compact toggle (feed card): a small tappable count pill — "💬" alone until
  // the thread has ever loaded a number, then "💬 N". The full sentence stays
  // in aria-label so it still reads correctly to a screen reader.
  const toggleButton = isCompact ? (
    <button
      type="button"
      className="commentToggleCompact"
      aria-expanded={open}
      aria-label={
        open ? "Hide comments" : loaded && count ? `${count} comments` : "Comments"
      }
      onClick={() => setOpen((v) => !v)}
    >
      <span aria-hidden="true">💬</span>
      {loaded && count > 0 ? <span className="commentToggleCompactCount">{count}</span> : null}
    </button>
  ) : (
    <button
      type="button"
      className="commentToggle"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      {open ? "Hide comments" : loaded && count ? `Comments (${count})` : "Comments"}
    </button>
  );

  const panelBody = open ? (
        <div className="commentPanel">
          {loading && !loaded ? <p className="commentStatus">Loading comments…</p> : null}

          {!loading && loaded && count === 0 ? (
            <p className="commentEmpty">No comments yet. Start the story.</p>
          ) : null}

          {count > 0 ? (
            <ul className="commentList">
              {comments.map((c) => {
                const ago = relativeTime(c.createdAt);
                const isReply = Boolean(c.parentId);
                return (
                  <li
                    key={c.id}
                    className={isReply ? "commentItem commentItemReply" : "commentItem"}
                  >
                    <HandleAvatar
                      handle={c.handle}
                      avatarUrl={c.avatarUrl}
                      className="commentAvatar"
                      imageClassName="commentAvatar"
                      size={28}
                    />
                    <span className="commentHandle">{displayHandle(c.handle)}</span>
                    {ago ? (
                      <time className="commentTime" dateTime={c.createdAt}>
                        {ago}
                      </time>
                    ) : null}
                    <p className="commentBody">{c.body}</p>
                    {/* Reply is a one-level affordance: only top-level comments
                        can be replied to (a reply has no reply button). */}
                    {!isReply ? (
                      <button
                        type="button"
                        className="commentReplyToggle"
                        aria-expanded={replyTo === c.id}
                        onClick={() => {
                          setReplyTo((cur) => (cur === c.id ? null : c.id));
                          setReplyBody("");
                        }}
                      >
                        {replyTo === c.id ? "Cancel" : "Reply"}
                      </button>
                    ) : null}

                    {replyTo === c.id ? (
                      <form className="commentForm commentReplyForm" onSubmit={submitReply}>
                        <textarea
                          className="commentBodyInput"
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder={`Reply to ${displayHandle(c.handle)}…`}
                          aria-label={`Reply to ${displayHandle(c.handle)}`}
                          maxLength={MAX_BODY}
                          rows={2}
                        />
                        <button
                          type="submit"
                          className="commentSubmit"
                          disabled={posting || !handle.trim() || !replyBody.trim()}
                        >
                          {posting ? "Posting…" : "Reply"}
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <form className="commentForm" onSubmit={submitTop}>
            <input
              className="commentHandleInput"
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="Your handle"
              aria-label="Your handle"
              maxLength={40}
              autoComplete="off"
            />
            <textarea
              className="commentBodyInput"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add to the story…"
              aria-label="Your comment"
              maxLength={MAX_BODY}
              rows={2}
            />
            <button
              type="submit"
              className="commentSubmit"
              disabled={posting || !handle.trim() || !body.trim()}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </form>

          {error ? (
            <p className="commentError" role="status">
              {error}
            </p>
          ) : null}
        </div>
  ) : null;

  if (isCompact) {
    // No wrapping <section> — this renders as a direct flex child inside the
    // feed card's single action row, with the panel (when open) carrying
    // `flex: 1 1 100%` in CSS so it honestly breaks to its own full-width line
    // under the row instead of squeezing into whatever space is left.
    return (
      <>
        {toggleButton}
        {panelBody ? <div className="commentPanelWrap">{panelBody}</div> : null}
      </>
    );
  }

  return (
    <section className="commentThread" aria-label="Comments">
      {toggleButton}
      {panelBody}
    </section>
  );
}

// Insert a freshly-posted comment into a thread-ordered list at the right spot:
// a reply lands right after the last comment in its parent's group (the parent
// then its existing replies); a top-level comment appends at the end. Keeps the
// on-screen order consistent with what a refetch would return (threadOrder),
// so the optimistic insert and the live refetch never disagree. Pure.
function insertThreaded(list: Comment[], posted: Comment): Comment[] {
  // De-dupe: the live refetch may have already added it.
  if (list.some((c) => c.id === posted.id)) return list;
  if (!posted.parentId) return [...list, posted];
  const out: Comment[] = [];
  let inserted = false;
  for (let i = 0; i < list.length; i += 1) {
    out.push(list[i]);
    const isLastOfGroup =
      list[i].id === posted.parentId || list[i].parentId === posted.parentId;
    const nextBelongs =
      i + 1 < list.length &&
      (list[i + 1].id === posted.parentId || list[i + 1].parentId === posted.parentId);
    if (!inserted && isLastOfGroup && !nextBelongs) {
      out.push(posted);
      inserted = true;
    }
  }
  if (!inserted) out.push(posted); // parent not found in view — append (orphan)
  return out;
}
