import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWebPush } from "@/lib/webPush";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function browserHarness() {
  const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  const subscription = {
    toJSON: () => ({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/browser",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    }),
  };
  const subscribe = vi.fn(async () => subscription);
  const getSubscription = vi.fn(async () => null);
  vi.stubGlobal("window", { PushManager: class {}, Notification: {} });
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }),
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  return { requestPermission, subscribe, fetch };
}

describe("registerWebPush", () => {
  it("does not ask permission when the public key is absent", async () => {
    const { requestPermission, fetch } = browserHarness();
    expect(await registerWebPush()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers an identity-free subscription only when explicitly invoked", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const { requestPermission, subscribe, fetch } = browserHarness();

    const token = await registerWebPush();
    expect(token).toMatch(/^webpush:/);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    }));
    expect(fetch).toHaveBeenCalledWith("/api/push-tokens", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"platform":"web"'),
    }));
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toEqual({ token: expect.stringMatching(/^webpush:/), platform: "web" });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("planId");
  });
});
