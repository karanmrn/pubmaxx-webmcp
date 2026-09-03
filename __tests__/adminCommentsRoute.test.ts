import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/admin/comments/route.ts (story 37). Two
// seams are mocked so the suite is deterministic under a PRODUCTION build too
// (Vercel CI presets NODE_ENV=production, and Vite bakes process.env.NODE_ENV at
// transform time — so runtime vi.stubEnv on it is a silent no-op; the trap
// profileOwnershipRoute.test.ts documents):
//   • @/lib/supabase isSupabaseConfigured() === false pins the in-memory
//     commentsStore (backend selection reads SUPABASE_*, never NODE_ENV).
//   • @/lib/adminAuth isModerator() — the REAL gate reads process.env.NODE_ENV to
//     open when ADMIN_TOKEN is unset (dev/test only). Under a prod build that read
//     would DENY every "gate open" case (403 instead of 200/400/404). We replace
//     ONLY that NODE_ENV branch with a controllable `devGate` flag (default open),
//     preserving the real constant-time token compare so the "wrong token → 403"
//     case still exercises the genuine auth path.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const { devGate } = vi.hoisted(() => ({ devGate: { open: true } }));
vi.mock("@/lib/adminAuth", () => ({
  isModerator: (request: Request): boolean => {
    const expected = process.env.ADMIN_TOKEN;
    const provided = request.headers.get("x-admin-token") ?? undefined;
    // No configured token → gate is open in dev/test (here: the devGate flag,
    // driven deterministically rather than via NODE_ENV).
    if (!expected) return devGate.open;
    if (!provided) return false;
    return provided === expected;
  },
}));

import { GET, POST } from "@/app/api/admin/comments/route";
import { __addMemoryCommentForTest, __resetMemoryComments } from "@/lib/commentsStore";

const URL_BASE = "http://localhost/api/admin/comments";

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

function get(query?: string, headers?: Record<string, string>): Promise<Response> {
  return GET(new Request(query ? `${URL_BASE}?${query}` : URL_BASE, { headers }));
}
function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body), headers }));
}

beforeEach(() => {
  devGate.open = true; // no ADMIN_TOKEN → gate open (see the mock above)
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ADMIN_TOKEN;
  __resetMemoryComments();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/admin/comments — hidden queue", () => {
  it("returns hidden comments (status + drop id, no actor_hash)", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "hidden one",
      actorHash: "secret",
      status: "hidden",
    });
    const res = await get("status=hidden");
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = (await res.json()) as { comments: { body: string }[] };
    expect(body.comments).toHaveLength(1);
    expect(JSON.stringify(body.comments)).not.toContain("secret");
  });

  it("403s when a real ADMIN_TOKEN is set and the header is wrong", async () => {
    vi.stubEnv("ADMIN_TOKEN", "the-real-token");
    const res = await get("status=hidden", { "x-admin-token": "wrong" });
    expect(res.status).toBe(403);
    expectNoStore(res);
  });
});

describe("POST /api/admin/comments — moderation", () => {
  it("restores a hidden comment", async () => {
    __addMemoryCommentForTest("drop-1", {
      handle: "ale",
      body: "rescue",
      actorHash: "h",
      status: "hidden",
    });
    const [target] = (await (await get("status=hidden")).json()).comments;
    const res = await post({ action: "restore", id: target.id });
    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("400s an unknown action", async () => {
    const res = await post({ action: "nuke", id: "x" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown comment id", async () => {
    const res = await post({ action: "restore", id: "no-such-id" });
    expect(res.status).toBe(404);
  });
});
