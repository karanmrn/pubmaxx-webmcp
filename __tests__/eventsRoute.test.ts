import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/events/route";
import { analyticsSurfaceFromPath } from "@/lib/analyticsSurface";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryAnalyticsReceipts } from "@/lib/analyticsReceiptStore";
import {
  crewCommittedEventToken,
  mintVerifiedAnalyticsToken,
  planDraftSavedEventToken,
} from "@/lib/verifiedAnalytics.server";

const VITEST_PLAN_SIGNING_SECRET = process.env.PLAN_IDEMPOTENCY_SECRET;

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

// Neutralize prod Supabase config so isEventsRateLimited always takes the
// deterministic in-memory path here — on Vercel, vitest runs under
// NODE_ENV=production with real SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set,
// which would otherwise route these checks through the durable RPC limiter.
beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (VITEST_PLAN_SIGNING_SECRET) process.env.PLAN_IDEMPOTENCY_SECRET = VITEST_PLAN_SIGNING_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.POSTHOG_PROJECT_API_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  __resetPintDrops();
  __resetMemoryAnalyticsReceipts();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (VITEST_PLAN_SIGNING_SECRET) process.env.PLAN_IDEMPOTENCY_SECRET = VITEST_PLAN_SIGNING_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
});

describe("POST /api/events", () => {
  it("accepts a known event and logs a PII-free line, returning 204", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      post(
        JSON.stringify({
          name: "tonight_filter_select",
          props: { kind: "gig", secret: "drop-me" },
          path: "/tonight?ref=x",
          anonymousId: "anon_0123456789abcdef",
          analyticsConsent: true,
          ts: 123,
        }),
      ),
    );
    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain("[pubmax-analytics]");
    expect(line).toContain('"kind":"gig"');
    expect(line).not.toContain("secret");
    expect(line).not.toContain("drop-me");
    // path is coarsened — query dropped.
    expect(line).toContain('"path":"/tonight"');
    expect(line).not.toContain("ref=x");
  });

  it("silently drops an unknown event (204, no log)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(post(JSON.stringify({ name: "totally_made_up" })));
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([undefined, "arrived", "plan_generated"])(
    "silently drops a meaningful core action with discriminator %s",
    async (action) => {
      process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const res = await POST(post(JSON.stringify({
        name: "meaningful_core_action",
        props: action === undefined ? {} : { action },
        anonymousId: "anon_0123456789abcdef",
        analyticsConsent: true,
      })));

      expect(res.status).toBe(204);
      expect(log).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("fail-softs on malformed JSON without throwing", async () => {
    const res = await POST(post("{not json"));
    expect(res.status).toBe(204);
  });

  it("ignores an oversized body", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const huge = JSON.stringify({ name: "tonight_screen_view", props: { x: "y".repeat(5000) } });
    const res = await POST(post(huge));
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("drops the 121st event from the same IP within a minute (204, no log)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const body = JSON.stringify({
      name: "tonight_screen_view",
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    });
    const headers = { "x-forwarded-for": "203.0.113.9" };

    for (let i = 0; i < 120; i++) {
      const res = await POST(post(body, headers));
      expect(res.status).toBe(204);
    }
    expect(log).toHaveBeenCalledTimes(120);

    const overLimit = await POST(post(body, headers));
    expect(overLimit.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(120); // 121st is rate-limited, never logged/recorded.
  });

  it("honors DNT: 1 server-side — no log even for a known event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await POST(
      post(JSON.stringify({ name: "tonight_screen_view" }), { dnt: "1" }),
    );
    expect(res.status).toBe(204);
    expect(log).not.toHaveBeenCalled();
  });

  it("forwards a sanitized event to PostHog EU when configured", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const before = Date.now();
    const res = await POST(post(
      JSON.stringify({
        name: "plan_created",
        props: { count: 3, freeText: "do not forward" },
        path: "/plan?memberToken=secret",
        anonymousId: "anon_0123456789abcdef",
        analyticsConsent: true,
        context: {
          screenWidth: 1512,
          screenHeight: 982,
          viewportWidth: 1280,
          viewportHeight: 820,
          referrer: "http://localhost/u/private-handle?ask=free-text#results",
        },
        ts: 123,
      }),
      {
        "x-forwarded-for": "203.0.113.24",
        "user-agent": "Mozilla/5.0 PubmaxxBrowser/18.0",
        referer: "https://pubmaxxing.com/plan?memberToken=secret",
      },
    ));
    const after = Date.now();

    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/capture/");
    const payload = JSON.parse(String(init.body)) as {
      api_key: string;
      event: string;
      properties: Record<string, unknown>;
      timestamp: string;
    };
    expect(payload.api_key).toBe("phc_test_project");
    expect(payload.event).toBe("plan_created");
    expect(Date.parse(payload.timestamp)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(payload.timestamp)).toBeLessThanOrEqual(after);
    expect(payload.properties).toMatchObject({
      count: 3,
      path: "/plan",
      distinct_id: "anon_0123456789abcdef",
      $ip: "203.0.113.24",
      $raw_user_agent: "Mozilla/5.0 PubmaxxBrowser/18.0",
      $referrer: "http://localhost/u/[handle]",
      $screen_width: 1512,
      $screen_height: 982,
      $viewport_width: 1280,
      $viewport_height: 820,
    });
    expect(payload.properties).not.toHaveProperty("$process_person_profile");
    expect(JSON.stringify(payload)).not.toContain("memberToken");
    expect(JSON.stringify(payload)).not.toContain("freeText");
    expect(JSON.stringify(payload)).not.toContain("ask=");
    expect(JSON.stringify(log.mock.calls)).not.toContain("203.0.113.24");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Mozilla/5.0");
  });

  it("drops malformed client context before forwarding", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await POST(post(JSON.stringify({
      name: "tonight_screen_view",
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
      context: {
        screenWidth: -1,
        screenHeight: 1_000_000,
        viewportWidth: "1280",
        viewportHeight: Number.NaN,
        referrer: "javascript:alert(document.cookie)",
        accountId: "supabase-user-id",
      },
    })));

    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.properties).not.toHaveProperty("$screen_width");
    expect(payload.properties).not.toHaveProperty("$screen_height");
    expect(payload.properties).not.toHaveProperty("$viewport_width");
    expect(payload.properties).not.toHaveProperty("$viewport_height");
    expect(payload.properties).not.toHaveProperty("$referrer");
    expect(JSON.stringify(payload)).not.toContain("supabase-user-id");
    expect(JSON.stringify(payload)).not.toContain("javascript:");
  });

  it("uses the public PostHog project token without adding an SDK identity seam", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_public_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await POST(post(JSON.stringify({
      name: "user_signed_in",
      props: {
        accountId: "supabase-user-id",
        email: "person@example.com",
      },
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.api_key).toBe("phc_public_test_project");
    expect(payload.properties.distinct_id).toBe("anon_0123456789abcdef");
    expect(JSON.stringify(payload)).not.toContain("supabase-user-id");
    expect(JSON.stringify(payload)).not.toContain("person@example.com");
  });

  it("durably deduplicates a verified event and never forwards its token", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = {
      name: "plan_accepted" as const,
      props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
    };
    const deliveryToken = mintVerifiedAnalyticsToken(event, "plan:dedupe", new Date().toISOString());
    const body = JSON.stringify({
      ...event,
      deliveryToken,
      path: "/plan",
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    });

    const first = await POST(post(body));
    const replay = await POST(post(body));

    expect(first.headers.get("x-analytics-delivery")).toBe("delivered");
    expect(replay.headers.get("x-analytics-delivery")).toBe("delivered");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(deliveryToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const providerPayload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(providerPayload.properties.$insert_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(providerPayload)).not.toContain(deliveryToken);
  });

  it("preserves the signed occurrence timestamp across delayed verified delivery", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const event = { name: "plan_completed" as const, props: { ending: "get_home" } };
    const occurredAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
    const deliveryToken = mintVerifiedAnalyticsToken(event, "completion:delayed", occurredAt);

    const response = await POST(post(JSON.stringify({
      ...event,
      deliveryToken,
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(response.headers.get("x-analytics-delivery")).toBe("delivered");
    const providerPayload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(providerPayload.timestamp).toBe(occurredAt);
  });

  it("retains a verified event for retry when the trusted signing key is temporarily unavailable", async () => {
    const event = {
      name: "plan_accepted" as const,
      props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
    };
    process.env.PLAN_IDEMPOTENCY_SECRET = "configured-random-signing-key-0123456789abcdef";
    const deliveryToken = mintVerifiedAnalyticsToken(event, "plan:key-outage", new Date().toISOString());
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.PLAN_IDEMPOTENCY_SECRET;

    const response = await POST(post(JSON.stringify({
      ...event,
      deliveryToken,
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(response.status).toBe(204);
    expect(response.headers.get("x-analytics-delivery")).toBe("retry");
  });

  it("delivers server-verified draft and join outcomes", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const occurredAt = new Date().toISOString();
    const draft = {
      name: "plan_draft_saved" as const,
      props: { stops: 1, grounded: true, anchored: true, routeReady: false, source: "tonight" },
    };
    const crew = {
      name: "crew_committed" as const,
      props: { source: "shared-plan", participants: 3, routeReady: true },
    };

    const draftResponse = await POST(post(JSON.stringify({
      ...draft,
      deliveryToken: planDraftSavedEventToken({ planId: "plan-draft", savedAt: occurredAt, source: "tonight" }),
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));
    const crewResponse = await POST(post(JSON.stringify({
      ...crew,
      deliveryToken: crewCommittedEventToken({
        joinId: "join-one",
        joinedAt: occurredAt,
        participants: 3,
        routeReady: true,
      }),
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(draftResponse.headers.get("x-analytics-delivery")).toBe("delivered");
    expect(crewResponse.headers.get("x-analytics-delivery")).toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "plan_draft_saved",
      props: { stops: 1, grounded: true, anchored: true, routeReady: false, source: "near" },
    },
    {
      name: "crew_committed",
      props: { source: "shared-plan", participants: 2, routeReady: true },
    },
  ])("rejects spoofed verified outcome $name without a server token", async (event) => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await POST(post(JSON.stringify({
      ...event,
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(response.headers.get("x-analytics-delivery")).toBe("discard");
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects spoofed acceptance and completion events without a server token", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await POST(post(JSON.stringify({
      name: "plan_completed",
      props: { ending: "get_home" },
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(response.headers.get("x-analytics-delivery")).toBe("discard");
    expect(log).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("templates dynamic paths before logging or forwarding", async () => {
    expect(analyticsSurfaceFromPath("/u/night_owl?token=secret")).toBe("/u/[handle]");
    expect(analyticsSurfaceFromPath("/plan/6ab5ca40-836b-4970-9477-d1779fdd31ab")).toBe("/plan/[id]");
    expect(analyticsSurfaceFromPath("/messages/private-thread")).toBe("/messages/[id]");
    expect(analyticsSurfaceFromPath("/rounds/secret-share-code")).toBe("/rounds/[code]");
    expect(analyticsSurfaceFromPath("/privacy")).toBeNull();
    expect(analyticsSurfaceFromPath("/unknown/private-value")).toBeNull();
  });

  it("does not log or forward when analytics consent is absent", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await POST(post(JSON.stringify({ name: "tonight_screen_view", path: "/tonight" })));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("fails soft when PostHog is unavailable", async () => {
    process.env.POSTHOG_PROJECT_API_KEY = "phc_test_project";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(post(JSON.stringify({
      name: "tonight_screen_view",
      anonymousId: "anon_0123456789abcdef",
      analyticsConsent: true,
    })));

    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
