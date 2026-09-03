import { describe, expect, it } from "vitest";

import {
  decodeWebPushSubscription,
  encodeWebPushSubscription,
  isSupportedWebPushEndpoint,
  isWebPushToken,
  validateWebPushSubscription,
} from "@/lib/webPushSubscription";

const SUBSCRIPTION = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/example",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
};

describe("web push subscription codec", () => {
  it("round-trips the browser JSON as one opaque, bounded token", () => {
    const token = encodeWebPushSubscription(SUBSCRIPTION)!;
    expect(isWebPushToken(token)).toBe(true);
    expect(token.length).toBeLessThan(2_048);
    expect(decodeWebPushSubscription(token)).toEqual(SUBSCRIPTION);
  });

  it("accepts exact production origins for major browser push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/google-token",
      "https://fcm.googleapis.com/wp/google-token",
      "https://updates.push.services.mozilla.com/wpush/v2/firefox-token",
      "https://web.push.apple.com/apple-token",
    ]) {
      expect(isSupportedWebPushEndpoint(endpoint), endpoint).toBe(true);
      expect(validateWebPushSubscription({ ...SUBSCRIPTION, endpoint }), endpoint).not.toBeNull();
    }
  });

  it("rejects SSRF destinations, custom ports and lookalike origins", () => {
    for (const endpoint of [
      "https://127.0.0.1/wpush/token",
      "https://10.0.0.8/wpush/token",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/wpush/token",
      "https://localhost/wpush/token",
      "https://push.example.test/wpush/token",
      "https://fcm.googleapis.com:444/fcm/send/token",
      "https://fcm.googleapis.com.evil.example/fcm/send/token",
      "https://user:pass@fcm.googleapis.com/fcm/send/token",
      "http://fcm.googleapis.com/fcm/send/token",
    ]) {
      expect(isSupportedWebPushEndpoint(endpoint), endpoint).toBe(false);
      expect(validateWebPushSubscription({ ...SUBSCRIPTION, endpoint }), endpoint).toBeNull();
    }
  });

  it("rejects malformed service paths, keys and corrupt tokens", () => {
    expect(validateWebPushSubscription({ ...SUBSCRIPTION, endpoint: "https://fcm.googleapis.com/not-web-push/token" })).toBeNull();
    expect(validateWebPushSubscription({ ...SUBSCRIPTION, keys: { p256dh: "no spaces", auth: "B".repeat(22) } })).toBeNull();
    expect(decodeWebPushSubscription("webpush:not-base64-json")).toBeNull();
    expect(decodeWebPushSubscription("native-token")).toBeNull();
  });
});
