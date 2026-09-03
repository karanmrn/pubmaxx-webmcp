import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pin in-memory rate limiting regardless of CI Supabase env (Vercel presets
// SUPABASE_*). Without this, isLimited hits the durable path and — when the
// RPC is missing — used to degrade to Math.min(limit, 3), so the 10×403 then
// 429 contract flaked on the 4th attempt.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    checkRateLimitDurableDetailed: async () =>
      ({ verdict: null, reason: "no-client" }) as const,
  };
});

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: () => {},
  assertProductionSecrets: () => {},
}));

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

beforeEach(async () => {
  process.env.ADMIN_TOKEN = "test-admin-secret";
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
});

afterEach(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  vi.unstubAllEnvs();
});

describe("POST /api/admin/session", () => {
  it("sets an httpOnly session cookie when the token matches", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    const res = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "test-admin-secret" }),
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("pubmax_admin_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    // Lax, not Strict: GET /admin is gated on the document now, so the
    // top-level navigation to it has to carry this cookie. A browser withholds
    // a Strict cookie on a cross-site top-level navigation, which met a
    // moderator arriving from a pasted link with the token form.
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("returns 403 for a wrong token", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    const res = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "wrong" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("429s after too many login attempts from one IP", async () => {
    const { POST } = await import("@/app/api/admin/session/route");
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        new Request("http://localhost/api/admin/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
          body: JSON.stringify({ token: "wrong" }),
        }),
      );
      expect(res.status).toBe(403);
    }
    const limited = await POST(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
        body: JSON.stringify({ token: "wrong" }),
      }),
    );
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many attempts, slow down.", code: "RATE_LIMITED", retryable: true });
  });
});

describe("GET /api/admin/session", () => {
  it("returns authenticated true when a valid session cookie is present", async () => {
    const { hashAdminSession } = await import("@/lib/adminAuth");
    const { GET } = await import("@/app/api/admin/session/route");
    const cookie = `pubmax_admin_session=${encodeURIComponent(hashAdminSession("test-admin-secret"))}`;
    const res = await GET(
      new Request("http://localhost/api/admin/session", {
        headers: { cookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
  });
});

describe("DELETE /api/admin/session", () => {
  it("clears the session cookie", async () => {
    const { DELETE } = await import("@/app/api/admin/session/route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("includes Secure on the cleared cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { DELETE } = await import("@/app/api/admin/session/route");
    const res = await DELETE();
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });
});
