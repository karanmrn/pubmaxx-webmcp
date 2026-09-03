import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// F3 behaviour-seam coverage: the comments and reactions GETs are UNSCOPED
// public reads (no viewer identity), so they must not serve child content for
// a parent drop that is hidden (moderated) or non-public (friends/legacy).
// Gated parents answer the SAME empty shape as "no comments/reactions yet"
// (200, never 404) — no existence oracle — matching how the feed omits them.
//
// The memory backend is pinned deterministically at the @/lib/supabase seam
// (isSupabaseConfigured() === false) — the house pattern from
// commentsRoute.test.ts / reactionsRoute.test.ts, NOT a NODE_ENV stub.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { GET as getComments, POST as postComment } from "@/app/api/pint-drops/comments/route";
import { GET as getReactions, POST as postReaction } from "@/app/api/pint-drops/reactions/route";
import { __addMemoryCommentForTest, __resetMemoryComments } from "@/lib/commentsStore";
import { filterPubliclyReadableDropIds } from "@/lib/pintDropLookup";
import { __resetPintDrops, addPintDrop, type PintDrop } from "@/lib/pintDrops";
import { __addMemoryReactionForTest, __resetMemoryReactions } from "@/lib/reactionsStore";
import { hashActor } from "@/lib/supabase";

const COMMENTS_URL = "http://localhost/api/pint-drops/comments";
const REACTIONS_URL = "http://localhost/api/pint-drops/reactions";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function makeDrop(overrides: Partial<PintDrop> = {}): PintDrop {
  return {
    id: "drop-visible",
    venueId: "venue-1",
    handle: "@regular",
    drink: "Bitter",
    priceGbp: 5.2,
    passedDownNote: "A note",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-07-07T12:00:00.000Z",
    ...overrides,
  };
}

function seedComment(dropId: string, body: string): void {
  __addMemoryCommentForTest(dropId, {
    handle: "ale",
    body,
    actorHash: "hash-1",
    status: "visible",
  });
}

function listComments(dropId: string): Promise<Response> {
  return getComments(new Request(`${COMMENTS_URL}?dropId=${encodeURIComponent(dropId)}`));
}

function summaries(ids: string[]): Promise<Response> {
  return getReactions(new Request(`${REACTIONS_URL}?ids=${ids.join(",")}&actor=dev-1`));
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetPintDrops();
  __resetMemoryComments();
  __resetMemoryReactions();

  addPintDrop(makeDrop({ id: "drop-visible" }));
  addPintDrop(makeDrop({ id: "drop-hidden", status: "hidden" }));
  addPintDrop(makeDrop({ id: "drop-legacy", visibility: "legacy" }));
  addPintDrop(makeDrop({ id: "drop-friends", visibility: "friends" }));
  addPintDrop(makeDrop({ id: "drop-anon", visibility: "anonymous" }));
});

describe("filterPubliclyReadableDropIds (batched parent-visibility gate)", () => {
  it("keeps visible public/anonymous drops, drops hidden/friends/legacy ones", async () => {
    const kept = await filterPubliclyReadableDropIds([
      "drop-visible",
      "drop-hidden",
      "drop-legacy",
      "drop-friends",
      "drop-anon",
    ]);
    expect(kept).toEqual(["drop-visible", "drop-anon"]);
  });

  it("keeps an unresolvable id (nothing to leak; dev/demo ergonomics)", async () => {
    expect(await filterPubliclyReadableDropIds(["no-such-drop"])).toEqual(["no-such-drop"]);
  });

  it("returns [] for an empty/blank batch", async () => {
    expect(await filterPubliclyReadableDropIds([])).toEqual([]);
    expect(await filterPubliclyReadableDropIds(["  ", ""])).toEqual([]);
  });
});

// Distinct outage sentinel: the helper must return null (not []) when the
// visibility lookup itself fails, so callers can 503 rather than 404. The
// memory-only path never reaches this branch — we flip Supabase on and stub the
// admin factory to fail. Isolated in its own describe so vi.resetModules() /
// per-suite guard flips don't leak into the memory-backend suites above.
describe("filterPubliclyReadableDropIds (outage sentinel)", () => {
  it("returns null when Supabase is configured but the admin client is broken", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/supabase")>();
      return {
        ...actual,
        isSupabaseConfigured: () => true,
        getSupabaseAdmin: () => null,
      };
    });
    const { filterPubliclyReadableDropIds: filterFresh } = await import(
      "@/lib/pintDropLookup"
    );
    expect(await filterFresh(["drop-visible"])) .toBeNull();
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
  });

  it("returns null when the visibility read throws", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/supabase")>();
      const admin = {
        from: () => ({
          select: () => ({
            in: () => Promise.reject(new Error("boom")),
          }),
        }),
      };
      return {
        ...actual,
        isSupabaseConfigured: () => true,
        getSupabaseAdmin: () => admin,
      };
    });
    const { filterPubliclyReadableDropIds: filterFresh } = await import(
      "@/lib/pintDropLookup"
    );
    expect(await filterFresh(["drop-visible"])).toBeNull();
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
  });
});

// End-to-end: a visibility-lookup outage must produce a 503 on the write
// paths (never a silent 404) while GETs stay fail-soft so the host feed keeps
// rendering. We stub the lookup directly at the module seam — the routes read
// it via the barrel import and this mock replaces both.
describe("routes distinguish outage (503) from gated/unknown (404)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/pintDropLookup", () => ({
      filterPubliclyReadableDropIds: async () => null,
    }));
  });

  it("POST /comments returns 503 when the visibility lookup is out", async () => {
    const { POST: PostFresh } = await import("@/app/api/pint-drops/comments/route");
    const res = await PostFresh(
      new Request(COMMENTS_URL, {
        method: "POST",
        body: JSON.stringify({ dropId: "drop-visible", handle: "ale", body: "hi" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Comments are unavailable.", code: "UNAVAILABLE", retryable: true });
  });

  it("POST /reactions returns 503 when the visibility lookup is out", async () => {
    const { POST: PostFresh } = await import("@/app/api/pint-drops/reactions/route");
    const res = await PostFresh(
      new Request(REACTIONS_URL, {
        method: "POST",
        body: JSON.stringify({ id: "drop-visible", actor: "dev-1", reaction: "cheers" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Reactions are unavailable.", code: "UNAVAILABLE", retryable: true });
  });

  it("GET /comments stays fail-soft (200 + empty) on a visibility outage", async () => {
    const { GET: GetFresh } = await import("@/app/api/pint-drops/comments/route");
    const res = await GetFresh(new Request(`${COMMENTS_URL}?dropId=drop-visible`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [] });
  });

  it("GET /reactions stays fail-soft (200 + empty) on a visibility outage", async () => {
    const { GET: GetFresh } = await import("@/app/api/pint-drops/reactions/route");
    const res = await GetFresh(new Request(`${REACTIONS_URL}?ids=drop-visible&actor=dev-1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summaries: {} });
  });

  afterEach(() => {
    vi.doUnmock("@/lib/pintDropLookup");
    vi.resetModules();
  });
});

describe("GET /api/pint-drops/comments — parent visibility gate (F3)", () => {
  it("returns comments for a visible public drop (unaffected by the gate)", async () => {
    seedComment("drop-visible", "still here");
    const res = await listComments("drop-visible");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const { comments } = await res.json();
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("still here");
  });

  it("returns an EMPTY list (200, not 404) for a hidden drop's comments", async () => {
    seedComment("drop-hidden", "should never leak");
    const res = await listComments("drop-hidden");
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ comments: [] });
  });

  it("returns an empty list for legacy (ledger-only) and friends drops", async () => {
    seedComment("drop-legacy", "family only");
    seedComment("drop-friends", "crew only");
    expect(await (await listComments("drop-legacy")).json()).toEqual({ comments: [] });
    expect(await (await listComments("drop-friends")).json()).toEqual({ comments: [] });
  });

  it("hidden and no-comments drops are indistinguishable (no oracle)", async () => {
    seedComment("drop-hidden", "secret");
    const hidden = await (await listComments("drop-hidden")).json();
    const empty = await (await listComments("drop-visible")).json();
    expect(hidden).toEqual(empty);
  });
});

describe("GET /api/pint-drops/reactions — parent visibility gate (F3)", () => {
  it("excludes hidden/legacy/friends ids from the batched summary, keeps visible ones", async () => {
    // Seed via the memory store helper — POST is now gated and would 404
    // hidden/legacy parents (the write-gate coverage lives below).
    const actor = hashActor("dev-1");
    for (const id of ["drop-visible", "drop-hidden", "drop-legacy", "drop-anon"]) {
      __addMemoryReactionForTest(id, actor, "cheers");
    }

    const res = await summaries(["drop-visible", "drop-hidden", "drop-legacy", "drop-friends", "drop-anon"]);
    expect(res.status).toBe(200);
    expectNoStore(res);
    const { summaries: map } = await res.json();
    // Gated ids are simply ABSENT — the same shape as an id nobody asked for.
    expect(Object.keys(map).sort()).toEqual(["drop-anon", "drop-visible"]);
    expect(map["drop-visible"]).toEqual({ counts: { cheers: 1 }, mine: ["cheers"] });
    expect(map["drop-anon"]).toEqual({ counts: { cheers: 1 }, mine: ["cheers"] });
  });

  it("returns an empty summaries map when every requested id is gated", async () => {
    const res = await summaries(["drop-hidden", "drop-legacy"]);
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ summaries: {} });
  });

  it("still summarises unknown ids (zero-state) — existing feed contract intact", async () => {
    const res = await summaries(["mystery-1", "drop-visible"]);
    const { summaries: map } = await res.json();
    expect(Object.keys(map).sort()).toEqual(["drop-visible", "mystery-1"]);
    expect(map["mystery-1"]).toEqual({ counts: {}, mine: [] });
  });
});

describe("POST /api/pint-drops/comments — parent visibility gate (F3)", () => {
  it("still accepts comments on a visible public drop", async () => {
    const res = await postComment(
      new Request(COMMENTS_URL, {
        method: "POST",
        body: JSON.stringify({ dropId: "drop-visible", handle: "ale", body: "cheers" }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("404s comments on hidden/legacy/friends drops", async () => {
    for (const id of ["drop-hidden", "drop-legacy", "drop-friends"]) {
      const res = await postComment(
        new Request(COMMENTS_URL, {
          method: "POST",
          body: JSON.stringify({ dropId: id, handle: "ale", body: "nope" }),
        }),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Pint drop not found.", code: "NOT_FOUND", retryable: false });
    }
  });
});

describe("POST /api/pint-drops/reactions — parent visibility gate (F3)", () => {
  it("404s toggles on hidden/legacy/friends drops", async () => {
    for (const id of ["drop-hidden", "drop-legacy", "drop-friends"]) {
      const res = await postReaction(
        new Request(REACTIONS_URL, {
          method: "POST",
          body: JSON.stringify({ id, actor: "dev-1", reaction: "cheers" }),
        }),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Pint drop not found.", code: "NOT_FOUND", retryable: false });
    }
  });

  it("still accepts toggles on a visible public drop", async () => {
    const res = await postReaction(
      new Request(REACTIONS_URL, {
        method: "POST",
        body: JSON.stringify({ id: "drop-visible", actor: "dev-1", reaction: "cheers" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
