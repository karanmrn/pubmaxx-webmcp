import { beforeEach, describe, expect, it, vi } from "vitest";

// Handler-level coverage for app/api/push-tokens/route.ts. The route selects
// the process-memory pushTokenStore, pinned deterministically at the
// @/lib/supabase seam (isSupabaseConfigured() === false) — the house pattern
// (see commentsRoute.test.ts). The per-IP limiter is mocked at the
// @/lib/pintDrops seam exactly like planGenerateRoute.test.ts so the 429 path
// and key derivation are asserted without a live budget.
const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async (...args: [
    localKey: string,
    durableKey: string,
    limit?: number,
    windowMs?: number,
  ]) => {
    void args;
    return false;
  }),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});

import { POST } from "@/app/api/push-tokens/route";
import { __listMemoryPushTokens, __resetMemoryPushTokens } from "@/lib/pushTokenStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const URL_BASE = "http://localhost/api/push-tokens";

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request(URL_BASE, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

function uncheckedWebToken(endpoint: string): string {
  return `webpush:${Buffer.from(JSON.stringify({
    endpoint,
    expirationTime: null,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  })).toString("base64url")}`;
}

beforeEach(() => {
  __resetMemoryPushTokens();
  isLimitedMock.mockClear();
  isLimitedMock.mockResolvedValue(false);
});

describe("POST /api/push-tokens", () => {
  it("registers a valid { token, platform } payload", async () => {
    const res = await post({ token: "apns-token-1", platform: "ios" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["apns-token-1"]);
  });

  it("is idempotent for a repeated token", async () => {
    await post({ token: "apns-token-1", platform: "ios" });
    const res = await post({ token: "apns-token-1", platform: "ios" });
    expect(res.status).toBe(200);
    expect(__listMemoryPushTokens()).toHaveLength(1);
  });

  it("400s on a malformed body in the flat public envelope", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Malformed request body.",
      code: "MALFORMED_REQUEST",
      retryable: false,
    });
  });

  it("400s on a missing token", async () => {
    const res = await post({ platform: "ios" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Device token is missing.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
    expect(__listMemoryPushTokens()).toHaveLength(0);
  });

  it("registers a valid identity-free web subscription", async () => {
    const token = encodeWebPushSubscription({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/route",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    })!;
    const res = await post({ token, platform: "web" });
    expect(res.status).toBe(200);
    expect(__listMemoryPushTokens()).toEqual([
      expect.objectContaining({ token, platform: "web" }),
    ]);
  });

  it("400s SSRF endpoints before the limiter or store", async () => {
    for (const endpoint of [
      "https://127.0.0.1/wpush/token",
      "https://10.0.0.8/wpush/token",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/wpush/token",
      "https://localhost/wpush/token",
      "https://push.example.test/wpush/token",
      "https://fcm.googleapis.com:444/fcm/send/token",
    ]) {
      const res = await post({ token: uncheckedWebToken(endpoint), platform: "web" });
      expect(res.status, endpoint).toBe(400);
    }
    expect(isLimitedMock).not.toHaveBeenCalled();
    expect(__listMemoryPushTokens()).toHaveLength(0);
  });

  it("400s on an unknown platform", async () => {
    const res = await post({ token: "tok", platform: "desktop" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Platform must be ios, android or web.",
      code: "INVALID_REQUEST",
      retryable: false,
    });
  });

  it("rate-limits per hashed IP and preserves the flat 429 contract", async () => {
    await post({ token: "tok-a", platform: "ios" }, { "x-real-ip": "203.0.113.7" });
    const [localKey, durableKey, limit, windowMs] = isLimitedMock.mock.calls[0] ?? [];
    expect(localKey).toMatch(/^push-tokens:/);
    expect(localKey).toBe(durableKey);
    // The raw IP never becomes a limiter key — only its hash.
    expect(String(localKey)).not.toContain("203.0.113.7");
    expect(limit).toBe(10);
    expect(windowMs).toBe(60 * 60 * 1000);
    // Second boundary: the route-wide global backstop rides every request.
    const [globalKey, , globalLimit] = isLimitedMock.mock.calls[1] ?? [];
    expect(globalKey).toBe("push-tokens:global");
    expect(globalLimit).toBe(300);

    isLimitedMock.mockResolvedValueOnce(true);
    const limited = await post({ token: "tok-b", platform: "ios" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Too many registrations, slow down.",
      code: "RATE_LIMITED",
      retryable: true,
    });
    // A limited request never reaches the store.
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["tok-a"]);
  });

  it("429s on forwarded-header rotation once the global backstop trips", async () => {
    // Faithful counting limiter: honours the per-key budget the route asks
    // for, exactly like the real one. Rotating x-forwarded-for gives the
    // attacker a FRESH per-IP key every request, so only the shared
    // push-tokens:global bucket can stop the flood.
    const counts = new Map<string, number>();
    isLimitedMock.mockImplementation(async (localKey, _durable, limit = 10) => {
      const next = (counts.get(localKey) ?? 0) + 1;
      counts.set(localKey, next);
      return next > limit;
    });

    let firstLimited: number | null = null;
    for (let i = 0; i < 301 && firstLimited === null; i += 1) {
      const res = await post(
        { token: `tok-${i}`, platform: "ios" },
        { "x-forwarded-for": `198.51.100.${i % 250}, 10.0.0.1` },
      );
      if (res.status === 429) {
        firstLimited = i;
        expect(await res.json()).toEqual({
          error: "Too many registrations, slow down.",
          code: "RATE_LIMITED",
          retryable: true,
        });
      }
    }
    // Every per-IP key stayed under its own 10/hour budget (250 rotating IPs),
    // yet the flood is stopped at the 300-request global ceiling.
    expect(firstLimited).toBe(300);
    expect(__listMemoryPushTokens()).toHaveLength(300);
  });

  it("skips the limiter entirely for invalid payloads", async () => {
    await post({ token: "", platform: "ios" });
    expect(isLimitedMock).not.toHaveBeenCalled();
  });
});
