import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  drainThrown: null as unknown,
  drainResult: {
    processed: 2,
    approved: 1,
    needsReview: 1,
    retried: 0,
    terminalErrors: 0,
  },
}));

const processModerationQueue = vi.fn(async () => {
  if (state.drainThrown !== null) throw state.drainThrown;
  return state.drainResult;
});

vi.mock("@/lib/cronAuth", () => ({ assertCronRequest: vi.fn(() => null) }));
vi.mock("@/lib/socialInteractionStore", () => ({
  socialInteractionStore: () => ({ processModerationQueue }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  isOpenAISocialModerationConfigured: () => Boolean((process.env.OPENAI_API_KEY ?? "").trim()),
  OpenAISocialPostModerationAdapter: class {},
}));

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  state.drainThrown = null;
  state.drainResult = {
    processed: 2,
    approved: 1,
    needsReview: 1,
    retried: 0,
    terminalErrors: 0,
  };
  processModerationQueue.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Social interaction moderation worker", () => {
  it("drains held comments and quotes through authenticated cron", async () => {
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      approved: 1,
      needsReview: 1,
      retried: 0,
      terminalErrors: 0,
    });
    expect(processModerationQueue).toHaveBeenCalledWith(expect.anything(), 20);
  });

  it("skips the Social queue during emergency rollback", async () => {
    vi.stubEnv("PUBMAX_SOCIAL_FRIENDS_LAUNCH", "0");
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");

    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "social_rollback" });
    expect(processModerationQueue).not.toHaveBeenCalled();
  });

  it("skips before claiming jobs when OpenAI moderation is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "openai_not_configured" });
    expect(processModerationQueue).not.toHaveBeenCalled();
  });

  it("names an unclaimed drain honestly rather than calling the queue empty", async () => {
    state.drainResult = {
      processed: 0,
      approved: 0,
      needsReview: 0,
      retried: 0,
      terminalErrors: 0,
    };
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "no_jobs_claimed",
      processed: 0,
      approved: 0,
      needsReview: 0,
      retried: 0,
      terminalErrors: 0,
    });
  });

  it("returns the house envelope when the store drain throws, and logs why", async () => {
    state.drainThrown = new Error("claim_social_interaction_moderation_jobs is unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Social interaction moderation is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
    // The reader is told nothing extra, so the store's own reason has to reach
    // the operator log or the outage is undiagnosable.
    expect(
      logged.mock.calls.some((call) =>
        call.some((part) =>
          String(part).includes("claim_social_interaction_moderation_jobs is unavailable"),
        ),
      ),
    ).toBe(true);
    logged.mockRestore();
  });

  it("logs the reason when the store throws a PostgrestError rather than an Error", async () => {
    // supabase-js does `if (error) throw error` with a plain object, so an
    // `instanceof Error` read alone logs "[object Object]".
    state.drainThrown = {
      message: "function claim_social_interaction_moderation_jobs does not exist",
      code: "42883",
      details: null,
      hint: null,
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(503);
    const lines = logged.mock.calls.map((call) => call.map((part) => String(part)).join(" "));
    expect(
      lines.some((line) =>
        line.includes("function claim_social_interaction_moderation_jobs does not exist"),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("[object Object]"))).toBe(false);
    logged.mockRestore();
  });

  it("schedules the held-interaction queue without request-owned background work", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/moderate-social-interactions",
      // Services audit 2026-08: every-minute invocations while social tables are empty.
      schedule: "*/10 * * * *",
    });
  });
});
