import { beforeEach, describe, expect, it, vi } from "vitest";

// Two Vercel-vs-local seams to pin (both would otherwise pass locally, fail on
// Vercel — the classic green-local/red-Vercel trap):
//
// 1. assertServerEnv() runs at module scope (the house pattern shared by 40+
//    certified routes). On Vercel vitest reads as production without test-scoped
//    Supabase vars, so the import throws "FATAL: Supabase is not configured".
//    Mock serverEnv to a no-op — the guard every sibling route test uses.
//
// 2. The route's storage guard `requiresSupabaseStore() && !isSupabaseConfigured()`
//    503s when requiresSupabaseStore() is true (it is on Vercel: VERCEL_ENV===
//    "production", and deleting SUPABASE_URL does NOT flip it) while
//    isSupabaseConfigured() is false — so every POST 503s and reads return [].
//    Pin the @/lib/supabase seam so BOTH read false: isSupabaseConfigured() false
//    selects the memory store, and requiresSupabaseStore() false disarms the 503
//    guard. This is the design-doc house pattern for write-route tests (see
//    pushTokensRoute.test.ts). hashIp/clientIp/hashActor pass through via ...actual.
//
// 3. Friends GET no longer trusts ?viewer= when NODE_ENV=production (Vercel CI).
//    Happy-path friends reads mock resolveViewerFromRequest to a JWT-linked
//    handle — same posture as pint-drops (#29) / dropVisibility tests.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
vi.mock("@/lib/pintDropViewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDropViewer")>();
  return {
    ...actual,
    resolveViewerFromRequest: vi.fn(async () => ({ handle: null, authenticated: false })),
  };
});

import { DELETE, GET, POST } from "@/app/api/check-ins/route";
import { __resetMemoryCheckIns } from "@/lib/checkInStore";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { resolveViewerFromRequest } from "@/lib/pintDropViewer";
import { __resetMemoryProfiles } from "@/lib/profileStore";

function postBody(body: unknown): Request {
  return new Request("http://localhost/api/check-ins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteBody(body: unknown): Request {
  return new Request("http://localhost/api/check-ins", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryCheckIns();
  __resetMemoryFollows();
  __resetMemoryProfiles();
  vi.mocked(resolveViewerFromRequest).mockResolvedValue({
    handle: null,
    authenticated: false,
  });
});

describe("Social rollback", () => {
  it("blocks check-in reads and writes before touching the store", async () => {
    process.env.PUBMAX_SOCIAL_FRIENDS_LAUNCH = "0";

    const read = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const write = await POST(postBody({ handle: "reader", areaSlug: "shoreditch" }));
    const remove = await DELETE(deleteBody({ handle: "reader" }));

    for (const response of [read, write, remove]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Social is in preview right now.",
        code: "SOCIAL_PREVIEW",
        retryable: false,
      });
    }
  });
});

describe("POST /api/check-ins", () => {
  it("creates a check-in (201) for a valid body", async () => {
    const res = await POST(postBody({ handle: "reader", areaSlug: "shoreditch", note: "out" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { checkIn?: { handle: string; areaSlug: string } };
    expect(data.checkIn?.handle).toBe("reader");
    expect(data.checkIn?.areaSlug).toBe("shoreditch");
  });

  it("400s a malformed body", async () => {
    const res = await POST(
      new Request("http://localhost/api/check-ins", { method: "POST", body: "{oops" }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a missing handle", async () => {
    const res = await POST(postBody({ areaSlug: "shoreditch" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Choose a handle in your account first.",
    });
  });

  it("400s an unknown area", async () => {
    const res = await POST(postBody({ handle: "reader", areaSlug: "atlantis" }));
    expect(res.status).toBe(400);
  });

  it("creates a no-area check-in (the out-tonight beacon shape)", async () => {
    const res = await POST(postBody({ handle: "reader" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { checkIn?: { handle: string; areaSlug: string | null } };
    expect(data.checkIn?.handle).toBe("reader");
    expect(data.checkIn?.areaSlug).toBeNull();
  });
});

describe("DELETE /api/check-ins", () => {
  it("ends the caller's own check-in early (200)", async () => {
    await POST(postBody({ handle: "reader", areaSlug: "shoreditch" }));
    const res = await DELETE(deleteBody({ handle: "reader" }));
    expect(res.status).toBe(200);

    vi.mocked(resolveViewerFromRequest).mockResolvedValue({
      handle: "reader",
      authenticated: true,
    });
    const after = await GET(new Request("http://localhost/api/check-ins"));
    const data = (await after.json()) as { checkIns: unknown[] };
    expect(data.checkIns).toEqual([]);
  });

  it("400s a missing handle", async () => {
    const res = await DELETE(deleteBody({}));
    expect(res.status).toBe(400);
  });

  it("400s a malformed body", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/check-ins", { method: "DELETE", body: "{oops" }),
    );
    expect(res.status).toBe(400);
  });

  it("does not error when the caller has no active check-in (idempotent off)", async () => {
    const res = await DELETE(deleteBody({ handle: "reader" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/check-ins", () => {
  it("returns a mutual friend's check-in for the viewer", async () => {
    const s = followStore();
    await s.follow("reader", "amy");
    await s.follow("amy", "reader");
    await POST(postBody({ handle: "amy", areaSlug: "brixton" }));

    vi.mocked(resolveViewerFromRequest).mockResolvedValue({
      handle: "reader",
      authenticated: true,
    });
    const res = await GET(new Request("http://localhost/api/check-ins"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { checkIns: { handle: string }[] };
    expect(data.checkIns.map((c) => c.handle)).toContain("amy");
  });

  it("does not return a non-mutual's check-in", async () => {
    await POST(postBody({ handle: "stranger", areaSlug: "brixton" }));
    vi.mocked(resolveViewerFromRequest).mockResolvedValue({
      handle: "reader",
      authenticated: true,
    });
    const res = await GET(new Request("http://localhost/api/check-ins"));
    const data = (await res.json()) as { checkIns: { handle: string }[] };
    expect(data.checkIns).toEqual([]);
  });

  it("scope=area returns only area-public check-ins", async () => {
    await POST(postBody({ handle: "reader", areaSlug: "camden", visibility: "friends" }));
    await POST(postBody({ handle: "amy", areaSlug: "camden", visibility: "area" }));
    const res = await GET(new Request("http://localhost/api/check-ins?scope=area"));
    const data = (await res.json()) as { checkIns: { handle: string; visibility: string }[] };
    expect(data.checkIns.every((c) => c.visibility === "area")).toBe(true);
    expect(data.checkIns.map((c) => c.handle)).toContain("amy");
    expect(data.checkIns.map((c) => c.handle)).not.toContain("reader");
  });

  it("an anonymous viewer sees nothing", async () => {
    await POST(postBody({ handle: "reader", areaSlug: "camden" }));
    const res = await GET(new Request("http://localhost/api/check-ins"));
    const data = (await res.json()) as { checkIns: unknown[] };
    expect(data.checkIns).toEqual([]);
  });

  it("ignores spoofed ?viewer= in production (friends lane stays closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const s = followStore();
    await s.follow("reader", "amy");
    await s.follow("amy", "reader");
    await POST(postBody({ handle: "amy", areaSlug: "brixton" }));

    // No JWT-linked profile — only a spoofed query handle.
    vi.mocked(resolveViewerFromRequest).mockResolvedValue({
      handle: null,
      authenticated: false,
    });
    const res = await GET(new Request("http://localhost/api/check-ins?viewer=reader"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { checkIns: unknown[] };
    expect(data.checkIns).toEqual([]);
    vi.unstubAllEnvs();
  });
});
