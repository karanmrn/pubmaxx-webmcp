import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic route test: no Supabase env (store is process-memory), Exa driven
// through a stubbed global fetch — no live network, no paid Exa calls.

import { GET } from "@/app/api/cron/refresh-night-signals/route";
import { __resetFeedFreshnessStore, memoryFeedFreshnessStore } from "@/lib/feedFreshnessStore";
import { NIGHT_SIGNAL_CANDIDATES_FEED_KEY } from "@/lib/freshnessStoreOverlay";

// A recent, dated, https, area-attributable, pub-relevant Exa result — the only
// shape that survives the candidate honesty bar (exaResultToCandidate).
function exaOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: [{
        title: "New Shoreditch taproom The Old Street Tap opens with cask ale this week",
        url: "https://www.example-london-guide.com/shoreditch/old-street-tap",
        publishedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        text: "A new pub and craft-beer taproom pouring proper pints has opened near Old Street in Shoreditch.",
      }],
    }),
  };
}

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/refresh-night-signals", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  __resetFeedFreshnessStore();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/cron/refresh-night-signals", () => {
  it("401s without the cron secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("is a safe no-op without EXA_API_KEY (never stamps a fake freshness)", async () => {
    // vitest.setup strips EXA_API_KEY, so the baseline is keyless.
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: "no-exa-key", staged: 0 });
    expect(await memoryFeedFreshnessStore.read(NIGHT_SIGNAL_CANDIDATES_FEED_KEY)).toBeNull();
  });

  it("sweeps pending candidates and stamps honest freshness on success", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    vi.stubGlobal("fetch", vi.fn(async () => exaOk()));

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.staged).toBeGreaterThanOrEqual(1);
    // Candidates are PENDING and route-neutral — never published.
    for (const candidate of body.candidates) {
      expect(candidate.reviewState).toBe("pending");
      expect(candidate.routeEffect).toBe("none");
    }
    const stamp = await memoryFeedFreshnessStore.read(NIGHT_SIGNAL_CANDIDATES_FEED_KEY);
    expect(stamp?.observedAt).toBe(body.observedAt);
    expect(stamp?.rowsServed).toBe(body.staged);
  });

  it("502s with a loud [ALERT] and stamps nothing when Exa is down", async () => {
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(502);
    expect(await memoryFeedFreshnessStore.read(NIGHT_SIGNAL_CANDIDATES_FEED_KEY)).toBeNull();
    const alerted = errorSpy.mock.calls.some(([first]) =>
      typeof first === "string" && first.includes("[night-signals][ALERT]"),
    );
    expect(alerted).toBe(true);
  });
});
