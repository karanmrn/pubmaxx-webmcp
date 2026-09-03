import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyticsCollectionAllowed,
  analyticsConsentDecision,
  anonymousAnalyticsId,
  flushVerifiedAnalyticsOutbox,
  laneSourceFromSearch,
  setAnalyticsConsent,
  trackEvent,
  trackMeaningfulCoreAction,
} from "@/lib/analytics";
import {
  consentAwareBeforeSend,
  shouldMountVercelAnalytics,
} from "@/components/ConsentAwareVercelAnalytics";

type FakeNavigator = Partial<Navigator> & {
  sendBeacon?: (url: string, data?: BodyInit | null) => boolean;
  doNotTrack?: string;
};

function setWindow(navigatorOverrides: FakeNavigator = {}): Map<string, string> {
  const values = new Map<string, string>();
  const nav: FakeNavigator = {
    sendBeacon: vi.fn().mockReturnValue(true),
    ...navigatorOverrides,
  };
  (globalThis as { navigator?: unknown }).navigator = nav;
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://pubmaxxing.com", pathname: "/tonight" },
    document: { referrer: "https://example.com/london-pubs?ask=free-text#results" },
    screen: { width: 1512, height: 982 },
    innerWidth: 1280,
    innerHeight: 820,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  return values;
}

function makeStorageThrow(): void {
  const fail = () => { throw new Error("storage blocked"); };
  (globalThis as { window: { localStorage: unknown } }).window.localStorage = {
    getItem: fail,
    removeItem: fail,
    setItem: fail,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if ((globalThis as { window?: unknown }).window) setAnalyticsConsent(false);
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("trackEvent", () => {
  it("no-ops when window is undefined (SSR / tests) and never throws", () => {
    expect(() => trackEvent("cmdk_open")).not.toThrow();
  });

  it("sends a known event via sendBeacon with allow-listed props", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("booking_click", { venueId: "venue-1", tier: "direct" });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("adds bounded screen, viewport, and original referrer context to a known event", async () => {
    setWindow();
    setAnalyticsConsent(true);

    trackEvent("booking_click", { venueId: "venue-1", tier: "direct" });

    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    const blob = beacon.mock.calls[0]?.[1] as Blob;
    const payload = JSON.parse(await blob.text()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: "booking_click",
      context: {
        screenWidth: 1512,
        screenHeight: 982,
        viewportWidth: 1280,
        viewportHeight: 820,
        referrer: "https://example.com",
      },
    });
  });

  it("retains a verified event after lost delivery and retries without a beacon", async () => {
    setWindow();
    setAnalyticsConsent(true);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(new Response(null, {
        status: 204,
        headers: { "x-analytics-delivery": "delivered" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("plan_accepted", { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" }, { deliveryToken: "signed-delivery-token" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushVerifiedAnalyticsOutbox();
    if (fetchMock.mock.calls.length === 1) await flushVerifiedAnalyticsOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator.sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
  });

  it("cancels an active flush on revocation and cannot remove a re-granted event", async () => {
    setWindow();
    setAnalyticsConsent(true);
    await flushVerifiedAnalyticsOutbox();
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue(new Response(null, {
        status: 204,
        headers: { "x-analytics-delivery": "delivered" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    trackEvent("plan_accepted", { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" }, { deliveryToken: "revocation-token-a" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    trackEvent("plan_completed", { ending: "get_home" }, { deliveryToken: "revocation-token-b" });

    setAnalyticsConsent(false);
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(true);

    setAnalyticsConsent(true);
    trackEvent("plan_accepted", { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" }, { deliveryToken: "revocation-token-a" });
    resolveFirst(new Response(null, {
      status: 204,
      headers: { "x-analytics-delivery": "delivered" },
    }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await flushVerifiedAnalyticsOutbox();

    const deliveredTokens = fetchMock.mock.calls.flatMap((call) => {
      const body = (call[1] as RequestInit).body;
      return typeof body === "string"
        ? [JSON.parse(body).deliveryToken]
        : [];
    });
    expect(deliveredTokens).toEqual(["revocation-token-a", "revocation-token-a"]);
    expect(deliveredTokens).not.toContain("revocation-token-b");
  });

  it("creates no persistent id before consent and clears it after revocation", () => {
    setWindow();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    expect(anonymousAnalyticsId()).toBeNull();

    setAnalyticsConsent(true);
    const first = anonymousAnalyticsId();
    const second = anonymousAnalyticsId();

    expect(first).toMatch(/^anon_[a-f0-9-]{16,64}$/);
    expect(second).toBe(first);
    expect(first).not.toContain("@");

    setAnalyticsConsent(false);
    expect(anonymousAnalyticsId()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/referrals/claim-attribution",
      expect.anything(),
    );
  });

  it("persists both consent answers so declining does not become a first visit again", () => {
    const storage = setWindow();
    expect(analyticsConsentDecision()).toBeNull();

    setAnalyticsConsent(true);
    expect(analyticsConsentDecision()).toBe("granted");

    setAnalyticsConsent(false);
    expect(analyticsConsentDecision()).toBe("denied");
    expect(storage.get("pubmaxx:analytics-consent:v1")).toBe("denied");
  });

  it("fails closed when storage is blocked unless consent was explicitly granted in memory", () => {
    setWindow();
    makeStorageThrow();
    expect(anonymousAnalyticsId()).toBeNull();

    setAnalyticsConsent(true);
    expect(anonymousAnalyticsId()).toMatch(/^anon_[a-f0-9-]{16,64}$/);
    expect(analyticsConsentDecision()).toBe("granted");

    setAnalyticsConsent(false);
    expect(anonymousAnalyticsId()).toBeNull();
    expect(analyticsConsentDecision()).toBe("denied");
    expect(analyticsCollectionAllowed()).toBe(false);
  });

  it("stays undecided when a fresh session cannot read storage", async () => {
    vi.resetModules();
    setWindow();
    makeStorageThrow();
    const freshAnalytics = await import("@/lib/analytics");

    expect(freshAnalytics.analyticsConsentDecision()).toBeNull();
    expect(freshAnalytics.analyticsCollectionAllowed()).toBe(false);
  });

  it("never infers a consent decision from a missing storage record", () => {
    const storage = setWindow();
    setAnalyticsConsent(false);
    storage.delete("pubmaxx:analytics-consent:v1");

    expect(analyticsConsentDecision()).toBeNull();
    expect(analyticsCollectionAllowed()).toBe(false);
  });

  it("forwards with empty props when none are given", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("tour_complete");
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("drops an unknown event silently (never throws)", () => {
    setWindow();
    expect(() =>
      // @ts-expect-error intentionally invalid event name for this test
      trackEvent("not_a_real_event", { count: 3 }),
    ).not.toThrow();
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
  });

  it("honors Do-Not-Track and never calls sendBeacon", () => {
    setWindow({ doNotTrack: "1" });
    setAnalyticsConsent(true);
    trackEvent("plan_created", { count: 3 });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by sendBeacon (analytics must never break the app)", () => {
    setWindow({
      sendBeacon: vi.fn().mockImplementation(() => {
        throw new Error("blocked by adblocker");
      }),
    });
    setAnalyticsConsent(true);
    expect(() => trackEvent("tour_complete", { completed: true })).not.toThrow();
  });

  it("fires lane_to_plan event with source + stops props via sendBeacon", () => {
    setWindow();
    setAnalyticsConsent(true);
    trackEvent("lane_to_plan", { source: "tonight-lane", stops: 3 });
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe("/api/events");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("sends nothing to any analytics destination before consent", () => {
    setWindow();
    expect(analyticsCollectionAllowed()).toBe(false);
    trackEvent("tonight_screen_view");
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();
    expect(consentAwareBeforeSend({ type: "pageview", url: "/tonight" })).toBeNull();
  });

  it("sends the reviewed Weekly Meaningful Pubmaxxers roll-up through the same consent gate", () => {
    setWindow();
    trackMeaningfulCoreAction("plan_completed");
    const beacon = (globalThis as { navigator: FakeNavigator }).navigator
      .sendBeacon as ReturnType<typeof vi.fn>;
    expect(beacon).not.toHaveBeenCalled();

    setAnalyticsConsent(true);
    trackMeaningfulCoreAction("memory_reviewed");
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]?.[0]).toBe("/api/events");
  });

  it("allows Vercel pageviews only after consent and still honors DNT", () => {
    setWindow();
    setAnalyticsConsent(true);
    const event = { type: "pageview" as const, url: "/tonight" };
    expect(analyticsCollectionAllowed()).toBe(true);
    expect(consentAwareBeforeSend(event)).toBe(event);

    (globalThis as { navigator: FakeNavigator }).navigator.doNotTrack = "1";
    expect(analyticsCollectionAllowed()).toBe(false);
    expect(consentAwareBeforeSend(event)).toBeNull();
  });

  it("does not load Vercel's remote debug script during local development", () => {
    expect(shouldMountVercelAnalytics("development")).toBe(false);
    expect(shouldMountVercelAnalytics("test")).toBe(false);
    expect(shouldMountVercelAnalytics("production")).toBe(false);
    expect(shouldMountVercelAnalytics("production", "1")).toBe(true);
  });
});

describe("laneSourceFromSearch", () => {
  it("returns the canonical token for exact allowlisted src values", () => {
    expect(laneSourceFromSearch("?src=tonight-lane")).toBe("tonight-lane");
    expect(laneSourceFromSearch("?src=tonight-vibes")).toBe("tonight-vibes");
    expect(laneSourceFromSearch("?occasion=coffee&src=landing-why")).toBe("landing-why");
    expect(laneSourceFromSearch("?src=whats-on-quiz&x=1")).toBe("whats-on-quiz");
    expect(laneSourceFromSearch("?src=whats-on-sport")).toBe("whats-on-sport");
    expect(laneSourceFromSearch("?src=whats-on-deal")).toBe("whats-on-deal");
    expect(laneSourceFromSearch("?src=whats-on-music")).toBe("whats-on-music");
  });

  it("returns null without a src param (default /plan visits stay silent)", () => {
    expect(laneSourceFromSearch("")).toBeNull();
    expect(laneSourceFromSearch("?other=1")).toBeNull();
  });

  it("returns null for unknown or empty src values", () => {
    expect(laneSourceFromSearch("?src=")).toBeNull();
    expect(laneSourceFromSearch("?src=nav")).toBeNull();
    expect(laneSourceFromSearch("?src=discover-editorial")).toBeNull();
  });

  it("rejects prefix-extended src values — raw query text never reaches telemetry", () => {
    expect(laneSourceFromSearch("?src=whats-on-jane.doe@example.com")).toBeNull();
    expect(laneSourceFromSearch("?src=tonight-lane-extra")).toBeNull();
    expect(laneSourceFromSearch("?src=whats-on")).toBeNull();
  });
});
