import { beforeEach, describe, expect, it } from "vitest";

// Exercise validation + the in-memory push-token store directly — no live
// Supabase, no env keys. This is the same backend the route uses when Supabase
// is unconfigured; the Supabase path shares validatePushToken and the DTO shape.
import {
  MAX_TOKEN_LENGTH,
  memoryPushTokenStore,
  validatePushToken,
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
} from "@/lib/pushTokenStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const WEB_TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;

function uncheckedWebToken(endpoint: string): string {
  return `webpush:${Buffer.from(JSON.stringify({
    endpoint,
    expirationTime: null,
    keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
  })).toString("base64url")}`;
}

beforeEach(() => {
  __resetMemoryPushTokens();
});

describe("validatePushToken", () => {
  it("accepts a trimmed token with a known platform", () => {
    const result = validatePushToken({ token: "  apns-abc123  ", platform: "ios" });
    expect(result).toEqual({ ok: true, input: { token: "apns-abc123", platform: "ios" } });
  });

  it("rejects a missing / blank / non-string token", () => {
    for (const token of [undefined, "", "   ", 42, null]) {
      const result = validatePushToken({ token, platform: "ios" });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a token over the length cap", () => {
    const result = validatePushToken({
      token: "x".repeat(MAX_TOKEN_LENGTH + 1),
      platform: "ios",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown platforms", () => {
    for (const platform of [undefined, "desktop", "IOS", 1]) {
      const result = validatePushToken({ token: "tok", platform });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/ios, android or web/);
    }
  });

  it("accepts a valid identity-free web subscription only on the web platform", () => {
    expect(validatePushToken({ token: WEB_TOKEN, platform: "web" })).toEqual({
      ok: true,
      input: { token: WEB_TOKEN, platform: "web" },
    });
    expect(validatePushToken({ token: WEB_TOKEN, platform: "ios" }).ok).toBe(false);
    expect(validatePushToken({ token: "not-a-subscription", platform: "web" }).ok).toBe(false);
  });

  it("rejects SSRF endpoints before persistence", () => {
    for (const endpoint of [
      "https://127.0.0.1/wpush/token",
      "https://10.0.0.8/wpush/token",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/wpush/token",
      "https://localhost/wpush/token",
      "https://push.example.test/wpush/token",
      "https://fcm.googleapis.com:444/fcm/send/token",
    ]) {
      expect(validatePushToken({ token: uncheckedWebToken(endpoint), platform: "web" }).ok, endpoint).toBe(false);
    }
  });
});

describe("memoryPushTokenStore", () => {
  it("saves a token and returns the public DTO shape", async () => {
    const dto = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    expect(Object.keys(dto).sort()).toEqual(
      ["createdAt", "lastSeenAt", "platform", "token"].sort(),
    );
    expect(dto.token).toBe("tok-1");
    expect(dto.platform).toBe("ios");
    expect(typeof dto.createdAt).toBe("string");
  });

  it("re-registering the same token upserts (no duplicate rows)", async () => {
    const first = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    const second = await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    expect(__listMemoryPushTokens()).toHaveLength(1);
    // Original registration time survives; last_seen refreshes.
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("stores distinct tokens independently", async () => {
    await memoryPushTokenStore.save({ token: "tok-1", platform: "ios" });
    await memoryPushTokenStore.save({ token: "tok-2", platform: "android" });
    expect(__listMemoryPushTokens().map((t) => t.token)).toEqual(["tok-1", "tok-2"]);
  });

  it("stores a web subscription without attaching identity", async () => {
    const row = await memoryPushTokenStore.save({ token: WEB_TOKEN, platform: "web" });
    expect(row).toMatchObject({ token: WEB_TOKEN, platform: "web" });
    expect(row).not.toHaveProperty("userId");
    expect(row).not.toHaveProperty("planId");
  });
});
