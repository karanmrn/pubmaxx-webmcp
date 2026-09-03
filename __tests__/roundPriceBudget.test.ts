import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The account budget a Round's drink lines pay before they may become community
// observations. supabase-js is mocked so the check_rate_limit RPC outcome is
// fully controllable offline (the house pattern — see rateLimitFailOpen.test).
//
// The case that matters most here is the OUTAGE: the durable limiter's own
// fallback tightens to a handful of calls, which one honest itemised round
// would exhaust on its fourth drink. This module must instead hand out a
// bounded allowance sized for one genuine round, and say so in the log.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

async function loadBudget() {
  vi.resetModules();
  return import("@/lib/roundPriceBudget");
}

function failOpenRecords(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call: unknown[]) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r != null && r.event === "rate_limit.fail_open");
}

function priceLines(spendId: string, count: number) {
  return Array.from({ length: count }, (_, lineIndex) => ({
    clientRef: spendId,
    spendId,
    lineIndex,
  }));
}

beforeEach(() => {
  rpc.mockReset();
  process.env.SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  delete process.env.RATE_LIMIT_STRICT;
});

afterAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RATE_LIMIT_STRICT;
});

describe("chargeRoundPriceLines", () => {
  it("charges one durable unit per line while the limiter answers", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: "charged", error: null });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const verdict = await chargeRoundPriceLines(
      "actor-a",
      "account-a",
      priceLines("spend-a", 6),
    );

    expect(verdict).toEqual({ allowed: true, mode: "durable" });
    expect(rpc).toHaveBeenCalledTimes(6);
    expect(rpc).toHaveBeenNthCalledWith(1, "charge_round_price_line", {
      p_actor: "account-a",
      p_key: "price-submit-actor:actor-a",
      p_limit: 30,
      p_line_index: 0,
      p_spend_id: "spend-a",
      p_window_ms: 3_600_000,
    });
    expect(failOpenRecords(logSpy)).toHaveLength(0);
    logSpy.mockRestore();
  });

  it("asks the durable receipt owner again when a saved line retries", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc
      .mockResolvedValueOnce({ data: "charged", error: null })
      .mockResolvedValueOnce({ data: "already_charged", error: null });
    const savedLine = priceLines("spend-durable-retry", 1);

    expect(
      await chargeRoundPriceLines("actor-retry", "account-retry", savedLine),
    ).toEqual({ allowed: true, mode: "durable" });
    expect(
      await chargeRoundPriceLines("actor-retry", "account-retry", savedLine),
    ).toEqual({ allowed: true, mode: "durable" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("refuses on the limiter's own verdict, blaming nobody's outage", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: "limited", error: null });

    expect(
      await chargeRoundPriceLines(
        "actor-b",
        "account-b",
        priceLines("spend-b", 3),
      ),
    ).toEqual({
      allowed: false,
      mode: "durable",
    });
  });

  it("hands out one genuine round's worth while the limiter is unreachable", async () => {
    const { chargeRoundPriceLines, ROUND_PRICE_WINDOW_MS } = await loadBudget();
    const { ROUND_SPEND_PRICE_LINE_MAX } = await import("@/lib/rounds");
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // A full itemised round lands rather than dying on its fourth drink.
    const first = await chargeRoundPriceLines(
      "actor-c",
      "account-c",
      priceLines("spend-c-1", ROUND_SPEND_PRICE_LINE_MAX),
    );
    expect(first).toEqual({ allowed: true, mode: "degraded" });

    // ONE warn per turn, not one per line, so the log drain stays readable
    // during exactly the incident an operator is reading.
    const records = failOpenRecords(logSpy);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "warn",
      event: "rate_limit.fail_open",
      reason: "error",
      mode: "degraded",
      surface: "round.price_lines",
      effectiveLimit: ROUND_SPEND_PRICE_LINE_MAX,
      windowMs: ROUND_PRICE_WINDOW_MS,
      allowed: true,
    });

    // The allowance is one round, so an account cannot spray during the outage.
    const second = await chargeRoundPriceLines(
      "actor-c",
      "account-c",
      priceLines("spend-c-2", ROUND_SPEND_PRICE_LINE_MAX),
    );
    expect(second).toEqual({ allowed: false, mode: "degraded" });
    expect(failOpenRecords(logSpy)).toHaveLength(2);

    // Another account still gets its own round.
    expect(
      await chargeRoundPriceLines(
        "actor-d",
        "account-d",
        priceLines("spend-d", ROUND_SPEND_PRICE_LINE_MAX),
      ),
    ).toEqual({ allowed: true, mode: "degraded" });
    logSpy.mockRestore();
  });

  it("refuses under RATE_LIMIT_STRICT rather than opening an allowance", async () => {
    const { chargeRoundPriceLines } = await loadBudget();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    process.env.RATE_LIMIT_STRICT = "1";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(
      await chargeRoundPriceLines(
        "actor-e",
        "account-e",
        priceLines("spend-e", 2),
      ),
    ).toEqual({
      allowed: false,
      mode: "degraded",
    });
    expect(failOpenRecords(logSpy)[0]).toMatchObject({ allowed: false, effectiveLimit: 0 });
    logSpy.mockRestore();
  });

  it("uses the local budget when there is no durable limiter to ask", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { chargeRoundPriceLines, ROUND_PRICE_ACTOR_LIMIT } = await loadBudget();

    expect(
      await chargeRoundPriceLines(
        "actor-f",
        "account-f",
        priceLines("spend-f-1", ROUND_PRICE_ACTOR_LIMIT),
      ),
    ).toEqual({ allowed: true, mode: "memory" });
    expect(
      await chargeRoundPriceLines(
        "actor-f",
        "account-f",
        priceLines("spend-f-2", 1),
      ),
    ).toEqual({ allowed: false, mode: "memory" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("charges a saved line once across retries", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { chargeRoundPriceLines, ROUND_PRICE_ACTOR_LIMIT } =
      await loadBudget();
    const savedLine = priceLines("spend-g-1", 1);

    expect(
      await chargeRoundPriceLines("actor-g", "account-g", savedLine),
    ).toEqual({
      allowed: true,
      mode: "memory",
    });
    expect(
      await chargeRoundPriceLines("actor-g", "account-g", savedLine),
    ).toEqual({
      allowed: true,
      mode: "memory",
    });
    expect(
      await chargeRoundPriceLines(
        "actor-g",
        "account-g",
        priceLines("spend-g-2", ROUND_PRICE_ACTOR_LIMIT - 1),
      ),
    ).toEqual({ allowed: true, mode: "memory" });
    expect(
      await chargeRoundPriceLines(
        "actor-g",
        "account-g",
        priceLines("spend-g-3", 1),
      ),
    ).toEqual({ allowed: false, mode: "memory" });
  });

  it("expires local receipts with their rate-limit window", async () => {
    vi.useFakeTimers();
    try {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      vi.setSystemTime(new Date("2026-07-29T10:00:00.000Z"));
      const {
        chargeRoundPriceLines,
        ROUND_PRICE_ACTOR_LIMIT,
        ROUND_PRICE_WINDOW_MS,
      } = await loadBudget();
      const savedLine = priceLines("spend-expiring", 1);

      expect(
        await chargeRoundPriceLines(
          "actor-expiring",
          "account-expiring",
          savedLine,
        ),
      ).toEqual({ allowed: true, mode: "memory" });
      vi.advanceTimersByTime(ROUND_PRICE_WINDOW_MS + 1);
      expect(
        await chargeRoundPriceLines(
          "actor-expiring",
          "account-expiring",
          savedLine,
        ),
      ).toEqual({ allowed: true, mode: "memory" });
      expect(
        await chargeRoundPriceLines(
          "actor-expiring",
          "account-expiring",
          priceLines("spend-window-fill", ROUND_PRICE_ACTOR_LIMIT - 1),
        ),
      ).toEqual({ allowed: true, mode: "memory" });
      expect(
        await chargeRoundPriceLines(
          "actor-expiring",
          "account-expiring",
          priceLines("spend-window-over", 1),
        ),
      ).toEqual({ allowed: false, mode: "memory" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Round price line charge migration", () => {
  it("serialises spend charges and records each line once", () => {
    const sql = readFileSync(
      new URL(
        "../supabase/migrations/20260729133000_0063_round_price_line_charges.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sql).toMatch(/primary key \(spend_id, line_index\)/);
    expect(sql).toMatch(
      /from public\.round_spends[\s\S]*where id = p_spend_id[\s\S]*for update/,
    );
    expect(sql).toMatch(
      /v_owner is distinct from p_actor[\s\S]*return 'forbidden'/,
    );
    expect(sql).toMatch(
      /from public\.round_price_line_charges[\s\S]*return case[\s\S]*'already_charged'/,
    );
  });
});
