import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Reply-path coverage for POST /api/pint-drops/comments (issue #37). Env cleared
// → the route uses the in-memory store, so every case is deterministic and
// touches no network. Asserts: a reply carries parentId, an invalid parent is a
// 400 (honest client-error shape, not a 503), and the public DTO still exposes
// only { id, handle, body, createdAt, parentId }.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

import { POST } from "@/app/api/pint-drops/comments/route";
import { __resetMemoryComments } from "@/lib/commentsStore";

const URL_BASE = "http://localhost/api/pint-drops/comments";

function post(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryComments();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("POST reply path", () => {
  it("creates a top-level comment with parentId null", async () => {
    const res = await post({ dropId: "drop-1", handle: "ale", body: "first" });
    expect(res.status).toBe(201);
    const { comment } = (await res.json()) as { comment: Record<string, unknown> };
    expect(comment.parentId).toBeNull();
    // Public DTO shape — nothing extra leaked.
    expect(Object.keys(comment).sort()).toEqual(
      ["body", "createdAt", "handle", "id", "parentId"].sort(),
    );
  });

  it("creates a one-level reply carrying its parent id", async () => {
    const top = (await (await post({ dropId: "drop-1", handle: "ale", body: "top" })).json()) as {
      comment: { id: string };
    };
    const res = await post({
      dropId: "drop-1",
      handle: "mild",
      body: "reply",
      parentId: top.comment.id,
    });
    expect(res.status).toBe(201);
    const { comment } = (await res.json()) as { comment: { parentId: string } };
    expect(comment.parentId).toBe(top.comment.id);
  });

  it("returns 400 (not 503) for a reply to an unknown parent", async () => {
    const res = await post({
      dropId: "drop-1",
      handle: "ale",
      body: "orphan",
      parentId: "no-such-id",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a reply whose parent is on a different drop", async () => {
    const other = (await (
      await post({ dropId: "drop-2", handle: "ale", body: "elsewhere" })
    ).json()) as { comment: { id: string } };
    const res = await post({
      dropId: "drop-1",
      handle: "ale",
      body: "cross",
      parentId: other.comment.id,
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a reply to a reply (two levels rejected)", async () => {
    const top = (await (await post({ dropId: "drop-1", handle: "ale", body: "top" })).json()) as {
      comment: { id: string };
    };
    const reply = (await (
      await post({ dropId: "drop-1", handle: "ale", body: "r1", parentId: top.comment.id })
    ).json()) as { comment: { id: string } };
    const res = await post({
      dropId: "drop-1",
      handle: "ale",
      body: "r2",
      parentId: reply.comment.id,
    });
    expect(res.status).toBe(400);
  });
});
