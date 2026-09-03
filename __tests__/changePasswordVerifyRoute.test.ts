import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));

const authState = vi.hoisted(() => ({
  identity: null as {
    id: string;
    email: string | null;
    createdAt: string | null;
  } | null,
}));
vi.mock("@/lib/authServer", () => ({
  callerAuthIdentity: async () => authState.identity,
}));

const limitState = vi.hoisted(() => ({ limited: false }));
vi.mock("@/lib/pintDrops", () => ({
  isLimited: async () => limitState.limited,
}));

const passwordGrant = vi.hoisted(() => vi.fn());
vi.mock("@/lib/handlePasswordSignIn", () => ({
  signInWithEmailPassword: passwordGrant,
}));

import { POST } from "@/app/api/auth/change-password/verify/route";

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/change-password/verify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "198.51.100.4",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authState.identity = {
    id: "user-1",
    email: "owner@example.com",
    createdAt: null,
  };
  limitState.limited = false;
  passwordGrant.mockReset();
});

describe("POST /api/auth/change-password/verify", () => {
  it("verifies the caller's own current password through the existing password seam", async () => {
    passwordGrant.mockResolvedValue({
      access_token: "temporary-access",
      refresh_token: "temporary-refresh",
    });

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true });
    expect(passwordGrant).toHaveBeenCalledWith("owner@example.com", "Oldpass1!");
  });

  it("uses one generic failure for wrong, short, and missing current passwords", async () => {
    passwordGrant.mockResolvedValue(null);

    const wrong = await POST(request({ currentPassword: "Wrongpass1!" }));
    const short = await POST(request({ currentPassword: "short" }));
    const missing = await POST(request({}));

    expect(wrong.status).toBe(401);
    expect(short.status).toBe(401);
    expect(missing.status).toBe(401);
    const bodies = await Promise.all(
      [wrong, short, missing].map((response) => response.json()),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect(passwordGrant).toHaveBeenCalledTimes(1);
  });

  it("never accepts a body account identity", async () => {
    passwordGrant.mockResolvedValue({
      access_token: "temporary-access",
      refresh_token: "temporary-refresh",
    });

    const response = await POST(
      request({
        userId: "someone-else",
        email: "someone-else@example.com",
        currentPassword: "Oldpass1!",
      }),
    );

    expect(response.status).toBe(200);
    expect(passwordGrant).toHaveBeenCalledWith("owner@example.com", "Oldpass1!");
  });

  it("requires a verified caller", async () => {
    authState.identity = null;

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(401);
    expect(passwordGrant).not.toHaveBeenCalled();
  });

  it("rate limits verification attempts before calling Supabase Auth", async () => {
    limitState.limited = true;

    const response = await POST(request({ currentPassword: "Oldpass1!" }));

    expect(response.status).toBe(429);
    expect(passwordGrant).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests", async () => {
    const response = await POST(
      request({ currentPassword: "Oldpass1!" }, { "sec-fetch-site": "cross-site" }),
    );

    expect(response.status).toBe(403);
    expect(passwordGrant).not.toHaveBeenCalled();
  });
});
