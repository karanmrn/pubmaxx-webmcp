import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: 0,
  requeueCalls: 0,
  purgeCalls: 0,
  inspectCalls: 0,
  backlogPending: 1,
  drainThrown: null as unknown,
  drainResult: {
    processed: 0,
    approved: 0,
    needsReview: 0,
    retried: 0,
    terminalErrors: 0,
  },
}));

vi.mock("@/lib/socialPostStore", () => ({
  socialPostStore: () => ({
    processModerationQueue: async () => {
      state.calls += 1;
      if (state.drainThrown !== null) throw state.drainThrown;
      return state.drainResult;
    },
    requeueTerminalModeration: async () => {
      state.requeueCalls += 1;
      return 3;
    },
    inspectModerationBacklog: async () => {
      state.inspectCalls += 1;
      return {
        pending: state.backlogPending,
        strandedTerminal: state.backlogPending > 0 ? 1 : 0,
        oldestPendingAgeMs: state.backlogPending > 0 ? 45 * 60 * 1000 : null,
      };
    },
  }),
}));
vi.mock("@/lib/socialModerationNotify", () => ({
  notifySocialModerationFindings: (
    backlog: { pending: number; strandedTerminal: number; oldestPendingAgeMs: number | null },
    lastRun?: { terminalErrors?: number },
  ) => ({
    findings: [
      {
        kind: "stranded_terminal",
        detail: "stranded",
        ...backlog,
        ...(lastRun?.terminalErrors ? { terminalErrors: lastRun.terminalErrors } : {}),
      },
    ],
  }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  isOpenAISocialModerationConfigured: () => Boolean((process.env.OPENAI_API_KEY ?? "").trim()),
  OpenAISocialPostModerationAdapter: class {
    constructor() {
      if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
        throw new Error("OpenAI moderation is not configured.");
      }
    }
  },
}));
vi.mock("@/lib/socialPostMedia.server", () => ({
  purgeDetachedSocialPhotos: async () => {
    state.purgeCalls += 1;
    return 4;
  },
}));

import { GET } from "@/app/api/cron/moderate-social-posts/route";

function request(token?: string, action?: string) {
  const query = action ? `?action=${action}` : "";
  return new Request(`http://localhost/api/cron/moderate-social-posts${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  state.calls = 0;
  state.requeueCalls = 0;
  state.purgeCalls = 0;
  state.inspectCalls = 0;
  state.backlogPending = 1;
  state.drainThrown = null;
  state.drainResult = {
    processed: 0,
    approved: 0,
    needsReview: 0,
    retried: 0,
    terminalErrors: 0,
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("Social post moderation worker", () => {
  it("refuses an unauthenticated queue drain", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it("skips every Social worker action during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "social_rollback",
    });
    expect(state.calls).toBe(0);
    expect(state.inspectCalls).toBe(0);
    expect(state.purgeCalls).toBe(0);
  });

  it("drains the durable queue behind cron authentication", async () => {
    state.drainResult = {
      processed: 2,
      approved: 1,
      needsReview: 0,
      retried: 1,
      terminalErrors: 1,
    };
    const response = await GET(request("cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      approved: 1,
      needsReview: 0,
      retried: 1,
      terminalErrors: 1,
      backlog: {
        pending: 1,
        strandedTerminal: 1,
        oldestPendingAgeMs: 45 * 60 * 1000,
      },
      findings: [
        {
          kind: "stranded_terminal",
          detail: "stranded",
          pending: 1,
          strandedTerminal: 1,
          oldestPendingAgeMs: 45 * 60 * 1000,
          terminalErrors: 1,
        },
      ],
    });
    expect(state.calls).toBe(1);
    expect(state.purgeCalls).toBe(0);
  });

  it("skips before claiming jobs when OpenAI moderation is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "openai_not_configured",
      backlog: { pending: 1, strandedTerminal: 1, oldestPendingAgeMs: 45 * 60 * 1000 },
      findings: [
        {
          kind: "stranded_terminal",
          detail: "stranded",
          pending: 1,
          strandedTerminal: 1,
          oldestPendingAgeMs: 45 * 60 * 1000,
        },
      ],
    });
    expect(state.calls).toBe(0);
    expect(state.inspectCalls).toBe(1);
  });

  it("answers queue_empty when nothing is waiting", async () => {
    state.backlogPending = 0;

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: "queue_empty",
      processed: 0,
      backlog: { pending: 0, strandedTerminal: 0, oldestPendingAgeMs: null },
    });
    expect(state.calls).toBe(1);
  });

  it("returns the house envelope when the store drain throws, and logs why", async () => {
    state.drainThrown = new Error("claim_social_post_moderation_jobs is unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Social post moderation queue is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(state.calls).toBe(1);
    // The reader is told nothing extra, so the store's own reason has to reach
    // the operator log or the outage is undiagnosable.
    expect(
      logged.mock.calls.some((call) =>
        call.some((part) => String(part).includes("claim_social_post_moderation_jobs is unavailable")),
      ),
    ).toBe(true);
    logged.mockRestore();
  });

  it("logs the reason when the store throws a PostgrestError rather than an Error", async () => {
    // supabase-js does `if (error) throw error` with a plain object, so an
    // `instanceof Error` read alone logs "[object Object]".
    state.drainThrown = {
      message: "function claim_social_post_moderation_jobs does not exist",
      code: "42883",
      details: null,
      hint: null,
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    const lines = logged.mock.calls.map((call) => call.map((part) => String(part)).join(" "));
    expect(
      lines.some((line) =>
        line.includes("function claim_social_post_moderation_jobs does not exist"),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("[object Object]"))).toBe(false);
    logged.mockRestore();
  });

  it("requeues terminal holds only through the authenticated operator action", async () => {
    const response = await GET(request("cron-secret", "requeue-terminal"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, requeued: 3 });
    expect(state.requeueCalls).toBe(1);
    expect(state.calls).toBe(0);
    expect(state.purgeCalls).toBe(0);
  });

  it("runs detached media cleanup through the authenticated operator action", async () => {
    const response = await GET(request("cron-secret", "purge-detached-media"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, purged: 4 });
    expect(state.purgeCalls).toBe(1);
    expect(state.calls).toBe(0);
  });
});
