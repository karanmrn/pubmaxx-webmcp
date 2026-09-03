// Comments on Pint Drops — "stories continue after the night" (cc_plan2 §4).
//
// ONE store interface, TWO implementations, same seam pattern as the other
// stores (reactions/pint drops): Supabase (public.pint_drop_comments) when
// env keys exist, process-memory otherwise. Every handler talks to the
// interface via commentsStore() so the backend is chosen in exactly one place.
//
// A comment is attributed to an `actor_hash` — the salted hash of the viewer's
// request IP (lib/supabase.ts hashIp), never a raw IP and never a real user id.
// The actor_hash is stored for rate-limiting / future moderation but is NEVER
// part of the public DTO: a CommentDTO exposes ONLY { id, handle, body,
// createdAt }. The moderation `status` column is likewise never surfaced —
// public reads return status='visible' rows only, so a hidden/pending comment
// simply does not exist for readers.
//
// Reads are fail-soft: a store error on listComments returns [] so a comments
// hiccup can never break feed rendering (the feed treats "no comments" and "the
// comments service is down" identically — the story just isn't shown).

import { admin, selectStore } from "@/lib/storeBackend";
import { cleanText } from "@/lib/textClean";
import { HANDLE_MAX } from "@/lib/handleNormalize";

// The only shape a reader ever sees. Deliberately minimal: no actor_hash, no
// status, no raw DB columns. `parentId` (issue #37) is the ONE structural field
// a reader gets: null for a top-level comment, the parent's id for a one-level
// reply. It carries the thread shape without leaking anything sensitive, and
// lets CommentThread render replies as a single indent under their parent
// (flat-list + parentId is simpler for the client than a nested tree).
export type CommentDTO = {
  id: string;
  handle: string;
  body: string;
  createdAt: string;
  parentId: string | null;
  /** Approved owned avatar serve path for linked handles only. */
  avatarUrl?: string;
};

// The write payload. actorHash is derived server-side from the request IP; the
// client never supplies it. `parentId` (optional) makes this a reply — it must
// reference a TOP-LEVEL comment on the SAME drop (validated in addComment); one
// level of nesting only.
export type NewComment = {
  pintDropId: string;
  handle: string;
  body: string;
  actorHash: string;
  parentId?: string | null;
};

// Thrown by addComment when a reply's parentId is invalid — unknown, on a
// different drop, or itself a reply (two-level nesting is rejected). The route
// maps this to a 400 (client error), distinct from a 503 store failure.
export class InvalidParentError extends Error {
  constructor(message = "That comment can't be replied to.") {
    super(message);
    this.name = "InvalidParentError";
  }
}

// The moderation view of a comment (admin only — story 37). Unlike CommentDTO
// this carries the `status` + the drop it belongs to so the console can show the
// review queue; it still NEVER carries actor_hash (that stays server-only).
export type ModeratorCommentDTO = {
  id: string;
  pintDropId: string;
  handle: string;
  body: string;
  status: "visible" | "hidden" | "pending";
  createdAt: string;
};

export type CommentsStore = {
  /** Public read: visible-only, oldest-first, hard-capped. Never throws. */
  listComments(pintDropId: string): Promise<CommentDTO[]>;
  /** Create a visible comment; returns its public DTO. Throws on a store error. */
  addComment(input: NewComment): Promise<CommentDTO>;
  /** Moderation queue: comments in a status (hidden/pending), newest-first.
   *  Admin-only — carries status + drop id. Never throws (fail-soft to []). */
  listForReview(status: "hidden" | "pending"): Promise<ModeratorCommentDTO[]>;
  /** Moderator decision: set a comment's status (restore → visible, keep →
   *  hidden). Returns false for an unknown id. Throws on a store error. */
  moderate(id: string, status: "visible" | "hidden"): Promise<boolean>;
};

// ── Trust boundary ───────────────────────────────────────────────────────────
// The body is untrusted. Cleaning is the shared cleanText (lib/textClean): strip
// anything that could be inline HTML, drop control chars, collapse whitespace,
// cap length — the same trust boundary every write path uses.
export const MAX_BODY = 500;
// Public reads are hard-capped so one busy drop can't return an unbounded thread.
export const MAX_COMMENTS = 100;

export type CleanResult =
  | { ok: true; handle: string; body: string }
  | { ok: false; error: string };

/**
 * Validate + normalise an untrusted comment. A comment needs a handle and a
 * non-empty body; both are cleaned (HTML/control chars stripped, capped). An
 * empty body (or one that cleans down to empty, e.g. only "<>") is rejected.
 */
export function cleanComment(handle: unknown, body: unknown): CleanResult {
  const cleanHandle = cleanText(handle, HANDLE_MAX);
  if (!cleanHandle) return { ok: false, error: "Add a handle." };
  const cleanBody = cleanText(body, MAX_BODY);
  if (!cleanBody) return { ok: false, error: "Comment can't be empty." };
  return { ok: true, handle: cleanHandle, body: cleanBody };
}

const TABLE = "pint_drop_comments";

// Order a flat comment list into thread order: each top-level comment (parentId
// null) oldest-first, immediately followed by ITS replies oldest-first. The
// client renders this as one indent level — a reply sits under its parent with
// no further recursion. Orphan replies (parent not visible / not in this page)
// are appended at the end as top-level, so a hidden parent never swallows a
// visible reply. Pure + input-order-preserving (the query already sorted
// oldest-first), so it's trivially testable.
export function threadOrder(comments: CommentDTO[]): CommentDTO[] {
  const replies = new Map<string, CommentDTO[]>();
  const tops: CommentDTO[] = [];
  const topIds = new Set<string>();
  for (const c of comments) {
    if (!c.parentId) {
      tops.push(c);
      topIds.add(c.id);
    }
  }
  for (const c of comments) {
    if (c.parentId) {
      const bucket = replies.get(c.parentId);
      if (bucket) bucket.push(c);
      else replies.set(c.parentId, [c]);
    }
  }
  const out: CommentDTO[] = [];
  for (const top of tops) {
    out.push(top);
    for (const r of replies.get(top.id) ?? []) out.push(r);
  }
  // Replies whose parent isn't a visible top-level comment in this list — keep
  // them rather than dropping the story; render them flat (as if top-level).
  for (const c of comments) {
    if (c.parentId && !topIds.has(c.parentId)) out.push(c);
  }
  return out;
}

// Map a raw DB row to the public DTO — the single choke point that guarantees
// actor_hash and status never leave the server. `parent_id` rides along as the
// public `parentId` (thread shape only; never sensitive).
function toDTO(row: {
  id: string;
  handle: string;
  body: string;
  created_at: string;
  parent_id?: string | null;
}): CommentDTO {
  return {
    id: row.id,
    handle: row.handle,
    body: row.body,
    createdAt: row.created_at,
    parentId: row.parent_id ?? null,
  };
}

// Map a raw row → the MODERATOR DTO. Carries status + drop id (admin needs them);
// still never carries actor_hash.
function toModeratorDTO(row: Record<string, unknown>): ModeratorCommentDTO {
  const status = row.status;
  return {
    id: String(row.id),
    pintDropId: String(row.pint_drop_id ?? ""),
    handle: String(row.handle ?? ""),
    body: String(row.body ?? ""),
    status:
      status === "hidden" || status === "pending" || status === "visible" ? status : "hidden",
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseCommentsStore: CommentsStore = {
  async listComments(pintDropId) {
    if (!pintDropId) return [];
    try {
      const { data, error } = await admin()
        .from(TABLE)
        // Select ONLY the public columns — actor_hash/status are never fetched
        // into the DTO path. parent_id carries the (harmless) thread shape.
        .select("id, handle, body, created_at, parent_id")
        .eq("pint_drop_id", pintDropId)
        .eq("status", "visible") // public reads: visible only
        .order("created_at", { ascending: true }) // oldest-first
        .limit(MAX_COMMENTS);
      if (error) {
        console.error("[comments] list failed — returning empty thread:", error.message);
        return [];
      }
      return threadOrder(
        (data ?? []).map((row) =>
          toDTO(
            row as {
              id: string;
              handle: string;
              body: string;
              created_at: string;
              parent_id?: string | null;
            },
          ),
        ),
      );
    } catch (err) {
      // Fail-soft: a comments outage must never break feed rendering.
      console.error(
        "[comments] list threw — returning empty thread:",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },

  async addComment({ pintDropId, handle, body, actorHash, parentId }) {
    // Reply validation (issue #37, one level only). A parent must EXIST, belong
    // to the SAME drop, and itself be top-level (parent_id null). Any miss →
    // InvalidParentError (the route maps it to a 400), never a silent orphan.
    if (parentId) {
      const { data: parent, error: parentErr } = await admin()
        .from(TABLE)
        .select("id, pint_drop_id, parent_id")
        .eq("id", parentId)
        .maybeSingle();
      if (parentErr) throw new Error(parentErr.message);
      if (
        !parent ||
        String((parent as { pint_drop_id?: unknown }).pint_drop_id) !== pintDropId ||
        (parent as { parent_id?: unknown }).parent_id != null
      ) {
        throw new InvalidParentError();
      }
    }
    const { data, error } = await admin()
      .from(TABLE)
      .insert({
        pint_drop_id: pintDropId,
        actor_hash: actorHash,
        handle,
        body,
        status: "visible",
        parent_id: parentId ?? null,
      })
      .select("id, handle, body, created_at, parent_id")
      .single();
    if (error) throw new Error(error.message);
    return toDTO(
      data as {
        id: string;
        handle: string;
        body: string;
        created_at: string;
        parent_id?: string | null;
      },
    );
  },

  async listForReview(status) {
    try {
      const { data, error } = await admin()
        .from(TABLE)
        // Admin read: status + drop id ride along; actor_hash never does.
        .select("id, pint_drop_id, handle, body, status, created_at")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(MAX_COMMENTS);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) =>
        toModeratorDTO(row as Record<string, unknown>),
      );
    } catch (err) {
      console.error(
        "[comments] review list failed — returning empty queue:",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },

  async moderate(id, status) {
    const { data, error } = await admin()
      .from(TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Map<pintDropId, Comment[]>, resets on restart — right for the prototype demo.
// Rows carry actor_hash + status internally so the memory path exercises the
// same "never leak these" guarantee, but only visible rows are ever mapped to a
// DTO and actor_hash/status never reach toDTO's output shape.
type MemoryRow = {
  id: string;
  handle: string;
  body: string;
  actor_hash: string;
  status: "visible" | "hidden" | "pending";
  created_at: string;
  parent_id: string | null;
};

const memoryRows = new Map<string, MemoryRow[]>();

// Monotonic id source for the memory store (no DB to mint uuids). Kept simple —
// uniqueness within a process is all the demo needs.
let memorySeq = 0;

export const memoryCommentsStore: CommentsStore = {
  async listComments(pintDropId) {
    if (!pintDropId) return [];
    const rows = memoryRows.get(pintDropId) ?? [];
    const dtos = rows
      .filter((r) => r.status === "visible") // hidden/pending never returned
      .sort((a, b) => a.created_at.localeCompare(b.created_at)) // oldest-first
      .slice(0, MAX_COMMENTS)
      .map(toDTO);
    return threadOrder(dtos);
  },

  async addComment({ pintDropId, handle, body, actorHash, parentId }) {
    const list = memoryRows.get(pintDropId) ?? [];
    // Reply validation (one level only): parent must exist on THIS drop and be
    // top-level. A hidden/pending parent still counts as "exists" — a reply to a
    // moderated comment is rejected, not silently orphaned.
    if (parentId) {
      const parent = list.find((r) => r.id === parentId);
      if (!parent || parent.parent_id != null) throw new InvalidParentError();
    }
    const row: MemoryRow = {
      id: `c${++memorySeq}`,
      handle,
      body,
      actor_hash: actorHash,
      status: "visible",
      // Distinct, monotonic timestamps so oldest-first ordering is stable even
      // when two comments land in the same millisecond.
      created_at: new Date(Date.now() + memorySeq).toISOString(),
      parent_id: parentId ?? null,
    };
    list.push(row);
    memoryRows.set(pintDropId, list);
    return toDTO(row);
  },

  async listForReview(status) {
    const out: ModeratorCommentDTO[] = [];
    for (const [pintDropId, rows] of memoryRows) {
      for (const r of rows) {
        if (r.status !== status) continue;
        out.push({
          id: r.id,
          pintDropId,
          handle: r.handle,
          body: r.body,
          status: r.status,
          createdAt: r.created_at,
        });
      }
    }
    return out
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest-first
      .slice(0, MAX_COMMENTS);
  },

  async moderate(id, status) {
    for (const rows of memoryRows.values()) {
      const hit = rows.find((r) => r.id === id);
      if (hit) {
        hit.status = status;
        return true;
      }
    }
    return false;
  },
};

/** The single backend selection point (mirrors the other stores). */
export function commentsStore(): CommentsStore {
  return selectStore(memoryCommentsStore, supabaseCommentsStore);
}

/** Test-only: seed a hidden/pending row so tests can assert it's never listed. */
export function __addMemoryCommentForTest(
  pintDropId: string,
  row: { handle: string; body: string; actorHash: string; status: "visible" | "hidden" | "pending" },
): void {
  const stored: MemoryRow = {
    id: `c${++memorySeq}`,
    handle: row.handle,
    body: row.body,
    actor_hash: row.actorHash,
    status: row.status,
    created_at: new Date(Date.now() + memorySeq).toISOString(),
    parent_id: null,
  };
  const list = memoryRows.get(pintDropId) ?? [];
  list.push(stored);
  memoryRows.set(pintDropId, list);
}

/** Test-only: clear the in-memory comment map between cases. */
export function __resetMemoryComments(): void {
  memoryRows.clear();
  memorySeq = 0;
}
