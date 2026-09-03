import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PerTokenResult, PushProvider } from "@/lib/pushProvider";
import type { PushPlatform } from "@/lib/pushTokenStore";

// Drive the fan-out with a controllable provider pinned at the selection seam
// (the house pattern: mock the boundary, keep everything else real). The real
// process-memory token store is used — Supabase env is stripped in
// vitest.setup.ts — so token pruning is asserted against actual store state.
const { sendMock, selectPlatformMock } = vi.hoisted(() => {
  const send = vi.fn<PushProvider["send"]>(async (tokens) =>
    tokens.map((token) => ({ token, status: "sent" }) as PerTokenResult),
  );
  return {
    sendMock: send,
    selectPlatformMock: vi.fn((platform: PushPlatform) => {
      void platform;
      return { send };
    }),
  };
});

vi.mock("@/lib/pushProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pushProvider")>();
  return { ...actual, selectPushProvider: selectPlatformMock };
});

import {
  broadcastNightSignalLive,
  broadcastDailyBrief,
  maybeBroadcastNightSignalLive,
  notifyPlanUpdate,
  __resetNightSignalBroadcasts,
} from "@/lib/pushSender";
import {
  memoryPushTokenStore,
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
} from "@/lib/pushTokenStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
// The durable broadcast claim uses the real in-memory limiter (Supabase is
// unconfigured in tests) — reset its bucket state between cases so a version
// key never leaks across tests.
import { __resetPintDrops } from "@/lib/pintDrops";

async function seed(...tokens: string[]): Promise<void> {
  for (const token of tokens) await memoryPushTokenStore.save({ token, platform: "ios" });
}

beforeEach(() => {
  __resetMemoryPushTokens();
  __resetNightSignalBroadcasts();
  __resetPintDrops();
  sendMock.mockReset();
  selectPlatformMock.mockClear();
  sendMock.mockImplementation(async (tokens) =>
    tokens.map((token) => ({ token, status: "sent" }) as PerTokenResult),
  );
});

const HIGHLIGHT = { id: "sig-1", title: "The Anchor", body: "Late licence tonight", entityId: "venue-anchor" };

describe("broadcastNightSignalLive", () => {
  it("routes iOS, Android, and web registrations by their stored platform", async () => {
    await memoryPushTokenStore.save({ token: "ios-token", platform: "ios" });
    await memoryPushTokenStore.save({ token: "android-token", platform: "android" });
    const webToken = encodeWebPushSubscription({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/mixed",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    })!;
    await memoryPushTokenStore.save({ token: webToken, platform: "web" });

    const summary = await broadcastNightSignalLive([HIGHLIGHT]);

    expect(selectPlatformMock.mock.calls.map(([platform]) => platform)).toEqual([
      "ios",
      "android",
      "web",
    ]);
    expect(sendMock.mock.calls.map(([tokens]) => tokens)).toEqual([
      ["ios-token"],
      ["android-token"],
      [webToken],
    ]);
    expect(summary.results.map((result) => result.token)).toEqual([
      "ios-token",
      "android-token",
      webToken,
    ]);
    expect(summary).toMatchObject({ targeted: 3, sent: 3, errors: 0 });
  });

  it("prunes an unregistered Android token without removing other platforms", async () => {
    await memoryPushTokenStore.save({ token: "ios-good", platform: "ios" });
    await memoryPushTokenStore.save({ token: "android-gone", platform: "android" });
    sendMock.mockImplementation(async (tokens) => tokens.map((token) => token === "android-gone"
      ? { token, status: "invalid", reason: "fcm_unregistered" }
      : { token, status: "sent" }));

    const summary = await broadcastNightSignalLive([HIGHLIGHT]);

    expect(summary).toMatchObject({ targeted: 2, sent: 1, pruned: 1, errors: 0 });
    expect(__listMemoryPushTokens().map((registration) => registration.token)).toEqual(["ios-good"]);
  });

  it("contains a provider-level failure to its platform group", async () => {
    await memoryPushTokenStore.save({ token: "ios-good", platform: "ios" });
    await memoryPushTokenStore.save({ token: "android-retry", platform: "android" });
    sendMock.mockImplementation(async (tokens) => {
      if (tokens[0] === "android-retry") throw new Error("Firebase unavailable");
      return tokens.map((token) => ({ token, status: "sent" }));
    });

    const summary = await broadcastNightSignalLive([HIGHLIGHT]);

    expect(summary).toMatchObject({ targeted: 2, sent: 1, pruned: 0, errors: 1 });
    expect(summary.results).toEqual([
      { token: "ios-good", status: "sent" },
      { token: "android-retry", status: "error", reason: "android_provider_threw" },
    ]);
    expect(__listMemoryPushTokens().map((registration) => registration.token)).toEqual([
      "ios-good",
      "android-retry",
    ]);
  });

  it("fans out to every registered token and summarises sends", async () => {
    await seed("tok-a", "tok-b", "tok-c");
    const summary = await broadcastNightSignalLive([HIGHLIGHT]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [tokens, payload] = sendMock.mock.calls[0];
    expect(tokens).toEqual(["tok-a", "tok-b", "tok-c"]);
    expect(payload.data).toMatchObject({ kind: "night_signal_live", entityId: "venue-anchor" });
    expect(summary).toMatchObject({ targeted: 3, sent: 3, skipped: 0, pruned: 0, errors: 0 });
  });

  it("summarises mixed per-token results and prunes invalid tokens", async () => {
    await seed("good", "stale", "flaky");
    sendMock.mockResolvedValueOnce([
      { token: "good", status: "sent" },
      { token: "stale", status: "invalid", reason: "BadDeviceToken" },
      { token: "flaky", status: "error", reason: "503" },
    ]);
    const summary = await broadcastNightSignalLive([HIGHLIGHT]);
    expect(summary).toMatchObject({ targeted: 3, sent: 1, pruned: 1, errors: 1 });
    // The invalid token is removed; valid + errored tokens survive for retry.
    expect(__listMemoryPushTokens().map((t) => t.token).sort()).toEqual(["flaky", "good"]);
  });

  it("does nothing when there are no highlights", async () => {
    await seed("tok-a");
    const summary = await broadcastNightSignalLive([]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.targeted).toBe(0);
  });

  it("does nothing when there are no tokens", async () => {
    const summary = await broadcastNightSignalLive([HIGHLIGHT]);
    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.targeted).toBe(0);
  });

  it("builds a multi-signal title/body summary", async () => {
    await seed("tok-a");
    await broadcastNightSignalLive([HIGHLIGHT, { ...HIGHLIGHT, id: "sig-2" }]);
    const [, payload] = sendMock.mock.calls[0];
    expect(payload.title).toBe("2 updates for tonight");
    expect(payload.body).toContain("+ 1 more");
  });

  it("surfaces a provider throw as an all-error summary without rejecting", async () => {
    await seed("tok-a", "tok-b");
    sendMock.mockRejectedValueOnce(new Error("network down"));
    const summary = await broadcastNightSignalLive([HIGHLIGHT]);
    expect(summary).toMatchObject({ targeted: 2, sent: 0, errors: 2 });
  });
});

describe("maybeBroadcastNightSignalLive", () => {
  it("broadcasts once per snapshot version, then no-ops for the same version", async () => {
    await seed("tok-a");
    const first = await maybeBroadcastNightSignalLive("2026-07-17T00:00:00.000Z", [HIGHLIGHT]);
    const second = await maybeBroadcastNightSignalLive("2026-07-17T00:00:00.000Z", [HIGHLIGHT]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(first.sent).toBe(1);
    expect(second.targeted).toBe(0);
  });

  it("broadcasts again when the snapshot version changes", async () => {
    await seed("tok-a");
    await maybeBroadcastNightSignalLive("v1", [HIGHLIGHT]);
    await maybeBroadcastNightSignalLive("v2", [HIGHLIGHT]);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("broadcasts exactly once across fresh instances — the durable claim, not the per-instance Set, is the authority", async () => {
    await seed("tok-a");
    const version = "2026-07-17T09:00:00.000Z";

    // Instance A: wins the durable claim and sends.
    const a = await maybeBroadcastNightSignalLive(version, [HIGHLIGHT]);

    // Simulate a cold start / a second serverless instance: the per-instance
    // dedup Set is empty again. If the Set were the authority this would send a
    // duplicate — the durable claim must stop it.
    __resetNightSignalBroadcasts();

    const b = await maybeBroadcastNightSignalLive(version, [HIGHLIGHT]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(a.sent).toBe(1);
    expect(b.targeted).toBe(0);
  });

  it("collapses concurrent instances of the same version to one send", async () => {
    await seed("tok-a", "tok-b");
    const version = "2026-07-17T10:00:00.000Z";

    // Two callers race on the same version. The durable claim is atomic, so
    // exactly one wins — regardless of scheduling.
    const [x, y] = await Promise.all([
      (async () => {
        __resetNightSignalBroadcasts();
        return maybeBroadcastNightSignalLive(version, [HIGHLIGHT]);
      })(),
      (async () => {
        __resetNightSignalBroadcasts();
        return maybeBroadcastNightSignalLive(version, [HIGHLIGHT]);
      })(),
    ]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const winners = [x, y].filter((s) => s.targeted > 0);
    expect(winners).toHaveLength(1);
  });
});

describe("broadcastDailyBrief", () => {
  it("targets explicit web subscriptions only and deep-links to /today", async () => {
    await seed("native-token");
    const webToken = encodeWebPushSubscription({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/daily",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    })!;
    await memoryPushTokenStore.save({ token: webToken, platform: "web" });

    const summary = await broadcastDailyBrief({
      weatherLine: "Warm and dry. Beer garden weather.",
      topPickTitle: "Pub quiz",
      topPickPlace: "The Anchor",
    });

    expect(sendMock).toHaveBeenCalledWith([webToken], expect.objectContaining({
      title: "Today in London",
      body: "Warm and dry. Beer garden weather. Tonight: Pub quiz at The Anchor.",
      data: { kind: "daily_brief", url: "/today" },
    }));
    expect(summary).toMatchObject({ targeted: 1, sent: 1 });
  });
});

describe("notifyPlanUpdate (plan-scoped seam, dormant)", () => {
  it("dispatches nothing today — no token carries plan identity", async () => {
    await seed("tok-a", "tok-b");
    const summary = await notifyPlanUpdate({
      planId: "plan-1",
      reason: "proposal_accepted",
      title: "Plan updated",
      body: "A new route was accepted.",
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(summary.targeted).toBe(0);
  });
});
