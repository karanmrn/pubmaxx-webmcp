import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Durable limiter unit tests — fully offline. supabase-js is mocked so the
// single check_rate_limit RPC round trip can be exercised without a network.
// lib/supabase caches its client at module level, so each test re-imports it
// via vi.resetModules.
const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}));

async function loadSupabaseLib() {
  vi.resetModules();
  return import("@/lib/supabase");
}

beforeEach(() => {
  rpc.mockReset();
  process.env.SUPABASE_URL = "https://stub.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  delete process.env.RATE_LIMIT_SALT;
});

afterAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RATE_LIMIT_SALT;
});

describe("checkRateLimitDurable", () => {
  it("makes ONE RPC round trip with key/limit/window and returns its verdict", async () => {
    const { checkRateLimitDurable } = await loadSupabaseLib();
    rpc.mockResolvedValue({ data: true, error: null });

    expect(await checkRateLimitDurable("drop:ale:abc123")).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "drop:ale:abc123",
      p_limit: 8,
      p_window_ms: 60_000,
    });
  });

  it("returns false when under the limit", async () => {
    const { checkRateLimitDurable } = await loadSupabaseLib();
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkRateLimitDurable("drop:ale:abc123")).toBe(false);
  });

  it("returns null on an RPC error (caller falls back to in-memory)", async () => {
    const { checkRateLimitDurable } = await loadSupabaseLib();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await checkRateLimitDurable("k")).toBeNull();
  });

  it("returns null when the RPC throws", async () => {
    const { checkRateLimitDurable } = await loadSupabaseLib();
    rpc.mockRejectedValue(new Error("network down"));
    expect(await checkRateLimitDurable("k")).toBeNull();
  });

  it("returns null when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { checkRateLimitDurable } = await loadSupabaseLib();
    expect(await checkRateLimitDurable("k")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("checkRateLimitDurableDetailed", () => {
  it("returns a boolean verdict with no reason on success", async () => {
    const { checkRateLimitDurableDetailed } = await loadSupabaseLib();
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkRateLimitDurableDetailed("k")).toEqual({ verdict: true });
  });

  it("tags missing-rpc when the function is absent", async () => {
    const { checkRateLimitDurableDetailed } = await loadSupabaseLib();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.check_rate_limit" },
    });
    expect(await checkRateLimitDurableDetailed("k")).toEqual({
      verdict: null,
      reason: "missing-rpc",
    });
  });

  it("tags error on a generic RPC failure", async () => {
    const { checkRateLimitDurableDetailed } = await loadSupabaseLib();
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await checkRateLimitDurableDetailed("k")).toEqual({
      verdict: null,
      reason: "error",
    });
  });

  it("tags no-client when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { checkRateLimitDurableDetailed } = await loadSupabaseLib();
    expect(await checkRateLimitDurableDetailed("k")).toEqual({
      verdict: null,
      reason: "no-client",
    });
  });
});

describe("hashIp", () => {
  it("is deterministic sha256 hex that never contains the raw IP", async () => {
    const { hashIp } = await loadSupabaseLib();
    const hash = hashIp("203.0.113.7");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203.0.113.7");
    expect(hashIp("203.0.113.7")).toBe(hash);
  });

  it("changes with RATE_LIMIT_SALT", async () => {
    const { hashIp } = await loadSupabaseLib();
    const unsalted = hashIp("203.0.113.7");
    process.env.RATE_LIMIT_SALT = "different-salt";
    expect(hashIp("203.0.113.7")).not.toBe(unsalted);
  });
});
