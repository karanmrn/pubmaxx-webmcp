import { afterEach, describe, expect, it, vi } from "vitest";

const durableLimiter = vi.hoisted(() => ({ stalled: false, aborted: false }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    checkRateLimitDurableDetailed: async (
      _key: string,
      _limit: number,
      _windowMs: number,
      signal?: AbortSignal,
    ) => {
      if (durableLimiter.stalled) {
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            durableLimiter.aborted = true;
            reject(signal.reason);
          }, { once: true });
        });
      }
      return { verdict: null, reason: "no-client" as const };
    },
  };
});

import {
  evaluateSocialModerationFindings,
  notifySocialModerationFindings,
  SOCIAL_MODERATION_ALERT_STATE_TIMEOUT_MS,
  SOCIAL_MODERATION_PENDING_AGE_ALERT_MS,
  SOCIAL_MODERATION_PENDING_ALERT_FLOOR,
} from "@/lib/socialModerationNotify";
import type { SocialPostFields } from "@/lib/socialPosts";
import {
  createMemorySocialPostStore,
  type SocialPostActor,
} from "@/lib/socialPostStore";

const actor: SocialPostActor = {
  accountId: "acct-alice",
  profileId: "11111111-1111-4111-8111-111111111111",
  handle: "alice",
};

function baseFields(body: string): SocialPostFields {
  return {
    kind: "standard",
    body,
    visibility: "friends",
    area: null,
    venueId: null,
    hashtags: [],
    commentPolicy: "open",
    photo: null,
  };
}

describe("social moderation operator alert", () => {
  afterEach(() => {
    durableLimiter.stalled = false;
    durableLimiter.aborted = false;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays quiet when the queue is empty and the last drain was clean", () => {
    expect(
      evaluateSocialModerationFindings(
        { pending: 0, strandedTerminal: 0, oldestPendingAgeMs: null },
        { terminalErrors: 0, retried: 0 },
      ),
    ).toEqual({ findings: [] });
  });

  it("reports stranded pending posts as their own named finding", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: 2,
      strandedTerminal: 2,
      oldestPendingAgeMs: 5_000,
    });
    expect(findings.some((f) => f.kind === "stranded_terminal")).toBe(true);
    expect(findings.find((f) => f.kind === "stranded_terminal")?.detail).toMatch(
      /nothing to review/i,
    );
  });

  it("reports a growing pending backlog above the floor", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: SOCIAL_MODERATION_PENDING_ALERT_FLOOR,
      strandedTerminal: 0,
      oldestPendingAgeMs: 1_000,
    });
    expect(findings.some((f) => f.kind === "pending_backlog")).toBe(true);
  });

  it("reports an aged pending backlog even below the count floor", () => {
    const { findings } = evaluateSocialModerationFindings({
      pending: 1,
      strandedTerminal: 0,
      oldestPendingAgeMs: SOCIAL_MODERATION_PENDING_AGE_ALERT_MS,
    });
    expect(findings.some((f) => f.kind === "pending_backlog")).toBe(true);
  });

  it("reports repeated terminal failures from the latest drain", () => {
    const { findings } = evaluateSocialModerationFindings(
      { pending: 1, strandedTerminal: 0, oldestPendingAgeMs: 1_000 },
      { terminalErrors: 3, retried: 0 },
    );
    expect(findings.some((f) => f.kind === "repeated_failures")).toBe(true);
    expect(findings.find((f) => f.kind === "repeated_failures")?.terminalErrors).toBe(3);
  });

  it("logs ALERT lines when notify is called with stranded pending", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await notifySocialModerationFindings({
      pending: 1,
      strandedTerminal: 1,
      oldestPendingAgeMs: 60_000,
    });
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      error.mock.calls.some((call) => String(call[0]).includes("[social-moderation][ALERT]")),
    ).toBe(true);
  });

  it("logs one alert for an unchanged backlog during the cooldown", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const backlog = {
      pending: 1,
      strandedTerminal: 1,
      oldestPendingAgeMs: 45 * 60 * 1000,
    };

    const first = await notifySocialModerationFindings(backlog);
    const second = await notifySocialModerationFindings(backlog);

    expect(first.findings).toEqual(second.findings);
    expect(
      error.mock.calls.filter((call) =>
        String(call[0]).includes("moderation finding(s)"),
      ),
    ).toHaveLength(1);
  });

  it("logs again when the queue state changes during the cooldown", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await notifySocialModerationFindings({
      pending: 2,
      strandedTerminal: 1,
      oldestPendingAgeMs: 45 * 60 * 1000,
    });
    await notifySocialModerationFindings({
      pending: 3,
      strandedTerminal: 1,
      oldestPendingAgeMs: 46 * 60 * 1000,
    });

    expect(
      error.mock.calls.filter((call) =>
        String(call[0]).includes("moderation finding(s)"),
      ),
    ).toHaveLength(2);
  });

  it("falls back to local alert state when the durable lookup stalls", async () => {
    vi.useFakeTimers();
    durableLimiter.stalled = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const notification = notifySocialModerationFindings({
      pending: 4,
      strandedTerminal: 2,
      oldestPendingAgeMs: 45 * 60 * 1000,
    });
    await vi.advanceTimersByTimeAsync(SOCIAL_MODERATION_ALERT_STATE_TIMEOUT_MS);

    await expect(notification).resolves.toMatchObject({ findings: { length: 2 } });
    expect(durableLimiter.aborted).toBe(true);
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes("[social-moderation][ALERT]"),
      ),
    ).toBe(true);
  });

  it("inspectModerationBacklog counts stranded terminal jobs in memory", async () => {
    const store = createMemorySocialPostStore({
      now: () => new Date("2026-08-08T12:00:00.000Z"),
    });
    await store.create(actor, baseFields("held one"));
    await store.create(actor, baseFields("held two"));

    // Non-retryable failures strand immediately (exhausted / terminal hold).
    const failing = {
      moderate: async () => {
        throw Object.assign(new Error("OpenAI down"), { retryable: false });
      },
    };
    const drain = await store.processModerationQueue(failing, 20);
    expect(drain.terminalErrors).toBe(2);

    const backlog = await store.inspectModerationBacklog(
      Date.parse("2026-08-08T12:45:00.000Z"),
    );
    expect(backlog.pending).toBe(2);
    expect(backlog.strandedTerminal).toBe(2);
    expect(backlog.oldestPendingAgeMs).toBeGreaterThan(0);

    const { findings } = evaluateSocialModerationFindings(backlog, {
      terminalErrors: 2,
      retried: 0,
    });
    expect(findings.some((f) => f.kind === "stranded_terminal")).toBe(true);
    expect(findings.some((f) => f.kind === "repeated_failures")).toBe(true);
  });
});
