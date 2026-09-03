import { afterEach, describe, expect, it, vi } from "vitest";

const posthogState = vi.hoisted(() => ({
  captures: [] as Array<[string, Record<string, unknown>]>,
  initConfig: null as Record<string, unknown> | null,
  initCount: 0,
  moduleLoads: 0,
  optedOut: true,
  resetCalls: [] as boolean[],
}));

vi.mock("posthog-js", () => {
  posthogState.moduleLoads += 1;
  return {
    default: {
      capture: (name: string, properties: Record<string, unknown>) => {
        if (!posthogState.optedOut) posthogState.captures.push([name, properties]);
      },
      init: (_token: string, config: Record<string, unknown>) => {
        posthogState.initCount += 1;
        posthogState.initConfig = config;
      },
      opt_in_capturing: () => { posthogState.optedOut = false; },
      opt_out_capturing: () => { posthogState.optedOut = true; },
      reset: (resetDeviceId?: boolean) => {
        posthogState.resetCalls.push(resetDeviceId === true);
      },
    },
  };
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  posthogState.captures = [];
  posthogState.initConfig = null;
  posthogState.initCount = 0;
  posthogState.moduleLoads = 0;
  posthogState.optedOut = true;
  posthogState.resetCalls = [];
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("explicit PostHog pageviews", () => {
  it("boots a returning consented session with its persisted device identity", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";
    const values = new Map([
      ["pubmaxx:analytics-consent:v1", "granted"],
      ["pubmaxx:analytics-id:v1", anonymousId],
    ]);
    vi.stubGlobal("navigator", { doNotTrack: "0" });
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      location: { pathname: "/map" },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
      },
    });

    await import("@/instrumentation-client");
    const { anonymousAnalyticsId } = await import("@/lib/analytics");
    const { capturePosthogPageview } = await import("@/lib/posthogClient");
    const returningId = anonymousAnalyticsId();
    capturePosthogPageview("/map", returningId);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
    });
    expect(posthogState.initCount).toBe(1);
    const getDeviceId = posthogState.initConfig?.get_device_id as
      | ((generatedId: string) => string)
      | undefined;
    expect(getDeviceId?.("generated-after-reload")).toBe(anonymousId);
  });

  it("preserves post-consent route order while the SDK initializes", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/tonight", anonymousId);
    capturePosthogPageview("/map", anonymousId);
    capturePosthogPageview("/privacy", anonymousId);
    expect(posthogState.captures).toEqual([]);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/tonight",
          $pubmaxx_anonymous_id: anonymousId,
        }],
        ["$pageview", {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        }],
        ["$pageview", {
          $pathname: "/privacy",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
    });

    capturePosthogPageview("/privacy", anonymousId);
    capturePosthogPageview("/terms", anonymousId);

    expect(posthogState.captures).toEqual([
      ["$pageview", {
        $pathname: "/tonight",
        $pubmaxx_anonymous_id: anonymousId,
      }],
      ["$pageview", {
        $pathname: "/map",
        $pubmaxx_anonymous_id: anonymousId,
      }],
      ["$pageview", {
        $pathname: "/privacy",
        $pubmaxx_anonymous_id: anonymousId,
      }],
      ["$pageview", {
        $pathname: "/terms",
        $pubmaxx_anonymous_id: anonymousId,
      }],
    ]);
  });

  it("discards pre-consent pageviews and starts with the current path at acceptance", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    capturePosthogPageview("/map", anonymousId);
    syncPosthogConsent(true);
    capturePosthogPageview("/tonight", anonymousId);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/tonight",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
    });
  });

  it("discards a queued pageview when consent is declined", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");

    syncPosthogConsent(true);
    capturePosthogPageview("/map", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    syncPosthogConsent(false);
    syncPosthogConsent(true);

    await vi.waitFor(() => expect(posthogState.initCount).toBe(1));
    expect(posthogState.captures).toEqual([]);
  });

  it("waits for the SDK to opt back in before capturing after re-consent", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/tonight", anonymousId);
    await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));

    syncPosthogConsent(false);
    syncPosthogConsent(true);
    capturePosthogPageview("/map", anonymousId);

    await vi.waitFor(() => {
      expect(posthogState.captures.at(-1)).toEqual([
        "$pageview",
        {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        },
      ]);
    });
    expect(posthogState.resetCalls).toEqual([true]);
  });

  it("does not count query-only navigation and never sends query data", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/map", anonymousId);
    await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));

    capturePosthogPageview("/map?sel=venue-secret", anonymousId);
    capturePosthogPageview("/map", anonymousId);

    expect(posthogState.captures).toEqual([
      ["$pageview", {
        $pathname: "/map",
        $pubmaxx_anonymous_id: anonymousId,
      }],
    ]);
  });

  it("excludes moderation routes from product pageviews", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/admin", anonymousId);
    capturePosthogPageview("/admin/community-prices", anonymousId);

    await vi.waitFor(() => expect(posthogState.initCount).toBe(1));
    expect(posthogState.captures).toEqual([]);
  });

  it.each(["/admin", "/unknown/private-value"])(
    "captures a return to the same product route after excluded route %s",
    async (excludedPath) => {
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
      const {
        capturePosthogPageview,
        syncPosthogConsent,
      } = await import("@/lib/posthogClient");
      const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

      syncPosthogConsent(true);
      capturePosthogPageview("/map", anonymousId);
      await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));

      capturePosthogPageview(excludedPath, anonymousId);
      capturePosthogPageview("/map", anonymousId);

      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        }],
        ["$pageview", {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
      expect(JSON.stringify(posthogState.captures)).not.toContain(excludedPath);
    },
  );

  it("queues only a stable template for a dynamic route", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/messages/private-thread", anonymousId);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/messages/[id]",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
    });
    expect(JSON.stringify(posthogState.captures)).not.toContain("private-thread");

    capturePosthogPageview("/messages/second-private-thread", anonymousId);
    expect(posthogState.captures).toHaveLength(2);
    expect(posthogState.captures[1]?.[1].$pathname).toBe("/messages/[id]");
    expect(JSON.stringify(posthogState.captures)).not.toContain("second-private-thread");
  });
});
