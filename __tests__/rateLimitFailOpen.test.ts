import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fail-open observability: when the durable Supabase limiter cannot answer,
// isLimited() drops to the in-memory budget AND emits ONE structured WARN
// (event "rate_limit.fail_open") so an operator can alert on it. supabase-js is
// mocked so the check_rate_limit RPC outcome is fully controllable offline.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

async function loadPintDrops() {
  vi.resetModules();
  return import("@/lib/pintDrops");
}

function failOpenRecords(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((c: unknown[]) => {
      try {
        return JSON.parse(String(c[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r != null && r.event === "rate_limit.fail_open");
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

describe("isLimited fail-open WARN", () => {
  it("emits a degraded fail_open WARN on a transient durable error", async () => {
    const { isLimited } = await loadPintDrops();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } }); // reason: error
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await isLimited("local:a", "durable:a", 8, 60_000);

    const recs = failOpenRecords(logSpy);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      level: "warn",
      event: "rate_limit.fail_open",
      reason: "error",
      mode: "degraded",
      effectiveLimit: 3,
      windowMs: 60_000,
    });
    logSpy.mockRestore();
  });

  it("emits a full-budget fail_open WARN when the RPC is missing", async () => {
    const { isLimited } = await loadPintDrops();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.check_rate_limit" },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await isLimited("local:b", "durable:b", 8, 60_000);

    const recs = failOpenRecords(logSpy);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      event: "rate_limit.fail_open",
      reason: "missing-rpc",
      mode: "full",
      effectiveLimit: 8,
    });
    logSpy.mockRestore();
  });

  it("does NOT emit fail_open when the durable limiter answers", async () => {
    const { isLimited } = await loadPintDrops();
    rpc.mockResolvedValue({ data: false, error: null });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const limited = await isLimited("local:c", "durable:c", 8, 60_000);

    expect(limited).toBe(false);
    expect(failOpenRecords(logSpy)).toHaveLength(0);
    logSpy.mockRestore();
  });

  it("does NOT emit fail_open for a fail-CLOSED caller (it refuses instead)", async () => {
    const { isLimited } = await loadPintDrops();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const limited = await isLimited("local:d", "durable:d", 8, 60_000, { failClosed: true });

    expect(limited).toBe(true);
    expect(failOpenRecords(logSpy)).toHaveLength(0);
    logSpy.mockRestore();
  });
});
