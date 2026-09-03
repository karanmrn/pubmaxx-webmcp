import { beforeEach, describe, expect, it } from "vitest";

// Comment moderation model (story 37): the hidden/pending review queue + moderate
// (restore → visible, keep → hidden). FORCE the in-memory path (clear Supabase
// env) and reset the comment map between cases.
import {
  __addMemoryCommentForTest,
  __resetMemoryComments,
  commentsStore,
  memoryCommentsStore,
} from "@/lib/commentsStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryComments();
});

describe("commentsStore() — seam selection", () => {
  it("selects the in-memory store when Supabase env is absent", () => {
    expect(commentsStore()).toBe(memoryCommentsStore);
  });
});

describe("listForReview — the hidden queue", () => {
  it("returns hidden comments with status + drop id, never actor_hash", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "hidden one",
      actorHash: "secret-hash",
      status: "hidden",
    });
    __addMemoryCommentForTest("drop-1", {
      handle: "ben",
      body: "visible one",
      actorHash: "another-hash",
      status: "visible",
    });

    const queue = await commentsStore().listForReview("hidden");
    expect(queue).toHaveLength(1);
    expect(queue[0].body).toBe("hidden one");
    expect(queue[0].pintDropId).toBe("drop-1");
    expect(queue[0].status).toBe("hidden");
    // actor_hash must never ride along in the moderator DTO.
    expect(JSON.stringify(queue[0])).not.toContain("secret-hash");
  });

  it("returns pending comments for the pending queue only", async () => {
    __addMemoryCommentForTest("drop-2", {
      handle: "ale",
      body: "pending one",
      actorHash: "h",
      status: "pending",
    });
    expect(await commentsStore().listForReview("hidden")).toHaveLength(0);
    expect(await commentsStore().listForReview("pending")).toHaveLength(1);
  });

  it("is empty when nothing is hidden", async () => {
    expect(await commentsStore().listForReview("hidden")).toHaveLength(0);
  });
});

describe("moderate — restore / keep hidden", () => {
  it("restores a hidden comment (→ visible), removing it from the hidden queue", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "rescue me",
      actorHash: "h",
      status: "hidden",
    });
    const [target] = await commentsStore().listForReview("hidden");

    const ok = await commentsStore().moderate(target.id, "visible");
    expect(ok).toBe(true);
    // Gone from the hidden queue…
    expect(await commentsStore().listForReview("hidden")).toHaveLength(0);
    // …and now visible on its drop's public thread.
    const publicThread = await commentsStore().listComments("drop-1");
    expect(publicThread.map((c) => c.body)).toContain("rescue me");
  });

  it("keeps a comment hidden (→ hidden) and it stays out of the public thread", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "stay hidden",
      actorHash: "h",
      status: "hidden",
    });
    const [target] = await commentsStore().listForReview("hidden");
    expect(await commentsStore().moderate(target.id, "hidden")).toBe(true);
    expect((await commentsStore().listComments("drop-1")).map((c) => c.body)).not.toContain(
      "stay hidden",
    );
  });

  it("returns false for an unknown comment id", async () => {
    expect(await commentsStore().moderate("no-such-id", "visible")).toBe(false);
  });
});
