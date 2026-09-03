// /api/auth/session — the durable sign-in resume cookie.
//
// The regression at the heart of this file: a signed-in user whose browser
// storage was evicted (iOS Safari) must be restorable from the HttpOnly
// cookie ALONE, on a fresh request a day later. See lib/authSessionResume.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_RESUME_COOKIE,
  encodeAuthResumeCookie,
} from "@/lib/authSessionResume";

// Pin in-memory rate limiting regardless of CI Supabase env (same rationale as
// adminSessionRoute.test.ts).
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

const verifyCallerAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authServer", () => ({ verifyCallerAuth }));

const SUPABASE_URL = "https://mock-project.supabase.co";

function cookieHeaderFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

function postRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  verifyCallerAuth.mockReset();
  const { __resetPintDrops } = await import("@/lib/pintDrops");
  __resetPintDrops();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST persist", () => {
  it("stores the refresh token and verified email in a durable HttpOnly Lax cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    verifyCallerAuth.mockResolvedValue({
      status: "verified",
      identity: { id: "user-1", email: "karan@example.com", createdAt: null },
    });
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_first_token" },
        { authorization: "Bearer jwt" },
      ),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_RESUME_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toMatch(/\bDomain=/i);
  });

  it("keeps the stored email for the SAME account when a persist cannot learn one", async () => {
    verifyCallerAuth.mockResolvedValue({
      status: "verified",
      identity: { id: "user-1", email: null, createdAt: null },
    });
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_old_token1",
        email: "karan@example.com",
        userId: "user-1",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_new_token1" },
        { authorization: "Bearer jwt", cookie },
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain(
      encodeURIComponent(
        encodeAuthResumeCookie({
          refreshToken: "rt_new_token1",
          email: "karan@example.com",
          userId: "user-1",
        }),
      ),
    );
  });

  it("re-persisting the very same token keeps its email even unverified", async () => {
    verifyCallerAuth.mockResolvedValue({ status: "unavailable" });
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_old_token1",
        email: "karan@example.com",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_old_token1" },
        { authorization: "Bearer jwt", cookie },
      ),
    );
    expect(res.headers.get("set-cookie") ?? "").toContain(
      encodeURIComponent(
        encodeAuthResumeCookie({
          refreshToken: "rt_old_token1",
          email: "karan@example.com",
        }),
      ),
    );
  });

  it("never hands a SECOND account the first one's welcome-back address", async () => {
    // The founder's browser: account A's cookie is still on the device when
    // account B signs in. B's cookie must name B, and must not offer a one-tap
    // return to an inbox B does not own.
    verifyCallerAuth.mockResolvedValue({
      status: "verified",
      identity: { id: "user-b", email: null, createdAt: null },
    });
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_account_a1",
        email: "karan@example.com",
        userId: "user-a",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_account_b1" },
        { authorization: "Bearer jwt", cookie },
      ),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(
      encodeURIComponent(
        encodeAuthResumeCookie({
          refreshToken: "rt_account_b1",
          email: null,
          userId: "user-b",
        }),
      ),
    );
    expect(setCookie).not.toContain("karan%40example.com");
  });

  it("refuses an unstamped cookie's email to a token it cannot tie to it", async () => {
    // A cookie written before account ids were stored proves nothing about who
    // it belongs to, so a persist carrying a different token starts clean.
    verifyCallerAuth.mockResolvedValue({ status: "unavailable" });
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_legacy_tok1",
        email: "karan@example.com",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_someone_else" },
        { authorization: "Bearer jwt", cookie },
      ),
    );
    expect(res.headers.get("set-cookie") ?? "").not.toContain("karan%40example.com");
  });

  it("refuses a caller whose bearer token fails verification", async () => {
    verifyCallerAuth.mockResolvedValue({ status: "invalid" });
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest({ action: "persist", refreshToken: "rt_first_token" }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a persist without a refresh token", async () => {
    verifyCallerAuth.mockResolvedValue({ status: "verified", identity: { id: "u", email: null, createdAt: null } });
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(postRequest({ action: "persist" }));
    expect(res.status).toBe(400);
  });

  it("refuses a plainly cross-site request", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_first_token" },
        { "sec-fetch-site": "cross-site" },
      ),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST redeem — the browser-restart regression", () => {
  it("restores a session from the durable cookie alone, 24h later, and rotates it", async () => {
    // Step 1: sign-in day. The client persists its refresh token.
    verifyCallerAuth.mockResolvedValue({
      status: "verified",
      identity: { id: "user-1", email: "karan@example.com", createdAt: null },
    });
    const { POST } = await import("@/app/api/auth/session/route");
    const persisted = await POST(
      postRequest(
        { action: "persist", refreshToken: "rt_first_token" },
        { authorization: "Bearer jwt" },
      ),
    );
    const cookie = cookieHeaderFrom(persisted);
    expect(cookie).not.toBe("");

    // Step 2: full browser restart plus a day of clock: the new request
    // carries ONLY the durable cookie — no Authorization header, no storage.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "at_new",
        refresh_token: "rt_rotated_token",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-1", email: "karan@example.com" },
      }),
    );
    const res = await POST(
      postRequest({ action: "redeem" }, { cookie }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      session: { access_token: string; refresh_token: string };
    };
    expect(body.status).toBe("restored");
    expect(body.session.access_token).toBe("at_new");
    expect(body.session.refresh_token).toBe("rt_rotated_token");

    // The exchange went to Supabase Auth with the stored token…
    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    );
    expect(init.body).toContain("rt_first_token");

    // …and the cookie now carries the ROTATED token for the next restart.
    const rotated = res.headers.get("set-cookie") ?? "";
    expect(rotated).toContain(
      encodeURIComponent(
        encodeAuthResumeCookie({
          refreshToken: "rt_rotated_token",
          email: "karan@example.com",
          userId: "user-1",
        }),
      ),
    );
    expect(rotated.toLowerCase()).toContain("httponly");
  });

  it("answers none when no cookie is present", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(postRequest({ action: "redeem" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "none" });
  });

  it("keeps the email hint and drops the token when Supabase declares it dead", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" },
        { status: 400 },
      ),
    );
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_dead_token",
        email: "karan@example.com",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(postRequest({ action: "redeem" }, { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "expired",
      maskedEmail: "k…@example.com",
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(
      encodeURIComponent(
        encodeAuthResumeCookie({ refreshToken: null, email: "karan@example.com" }),
      ),
    );
  });

  it("keeps the cookie intact when Supabase is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_live_token",
        email: "karan@example.com",
      }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(postRequest({ action: "redeem" }, { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET hint and DELETE clear", () => {
  it("returns only the masked email, never the token", async () => {
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({
        refreshToken: "rt_secret_token",
        email: "karan@example.com",
      }),
    )}`;
    const { GET } = await import("@/app/api/auth/session/route");
    const res = await GET(
      new Request("http://localhost/api/auth/session", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ hint: { maskedEmail: "k…@example.com" } });
    expect(text).not.toContain("rt_secret_token");
    expect(text).not.toContain("karan@example.com");
  });

  it("reports a hint for a token-only cookie (email not yet known)", async () => {
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({ refreshToken: "rt_secret_token", email: null }),
    )}`;
    const { GET } = await import("@/app/api/auth/session/route");
    const res = await GET(
      new Request("http://localhost/api/auth/session", { headers: { cookie } }),
    );
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ hint: { maskedEmail: null } });
    expect(text).not.toContain("rt_secret_token");
  });

  it("returns a null hint without a cookie", async () => {
    const { GET } = await import("@/app/api/auth/session/route");
    const res = await GET(new Request("http://localhost/api/auth/session"));
    expect(await res.json()).toEqual({ hint: null });
  });

  it("clears the cookie on DELETE", async () => {
    const { DELETE } = await import("@/app/api/auth/session/route");
    const res = await DELETE(
      new Request("http://localhost/api/auth/session", {
        method: "DELETE",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${AUTH_RESUME_COOKIE}=;`);
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("POST resume", () => {
  it("emails a sign-in link to the saved address for a valid same-origin callback", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({}));
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({ refreshToken: null, email: "karan@example.com" }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        {
          action: "resume",
          callbackUrl:
            "http://localhost/auth/callback?next=%2F&_authAttempt=abc123",
        },
        { cookie },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe("sent");
    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain(`${SUPABASE_URL}/auth/v1/otp`);
    expect(String(url)).toContain("redirect_to=");
    expect(init.body).toContain("karan%40example.com".replace("%40", "@"));
  });

  it("refuses a callback URL on another origin", async () => {
    const cookie = `${AUTH_RESUME_COOKIE}=${encodeURIComponent(
      encodeAuthResumeCookie({ refreshToken: null, email: "karan@example.com" }),
    )}`;
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest(
        { action: "resume", callbackUrl: "https://evil.example/auth/callback" },
        { cookie },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("404s without a saved email", async () => {
    const { POST } = await import("@/app/api/auth/session/route");
    const res = await POST(
      postRequest({
        action: "resume",
        callbackUrl: "http://localhost/auth/callback",
      }),
    );
    expect(res.status).toBe(404);
  });
});
