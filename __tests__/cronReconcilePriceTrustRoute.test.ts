import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DrainResult = {
  processed: number;
  synced: number;
  pending: number;
  degraded: boolean;
};

const drainState = vi.hoisted(() => ({
  calls: 0,
  queued: null as number | null,
  result: {
    processed: 0,
    synced: 0,
    pending: 0,
    degraded: false,
  } as DrainResult,
}));

vi.mock("@/lib/priceTrustImpact.server", () => ({
  drainPendingPriceTrustReconciliations: async (
    limit?: number,
  ): Promise<DrainResult> => {
    drainState.calls += 1;
    if (drainState.queued === null) return drainState.result;
    const bounded = typeof limit === "number" ? limit : drainState.queued;
    const processed = Math.min(bounded, drainState.queued);
    return {
      processed,
      synced: processed,
      pending: 0,
      degraded: false,
    };
  },
}));

import { GET } from "@/app/api/cron/reconcile-price-trust/route";

function req(auth?: string): Request {
  return new Request("https://pubmaxxing.com/api/cron/reconcile-price-trust", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  drainState.calls = 0;
  drainState.queued = null;
  drainState.result = {
    processed: 0,
    synced: 0,
    pending: 0,
    degraded: false,
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/reconcile-price-trust", () => {
  it("refuses an invalid cron credential before queue work starts", async () => {
    const response = await GET(req("Bearer wrong"));

    expect(response.status).toBe(401);
    expect(drainState.calls).toBe(0);
  });

  it("returns the successful bounded drain summary", async () => {
    drainState.result = {
      processed: 1,
      synced: 1,
      pending: 0,
      degraded: false,
    };

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true,
      processed: 1,
      synced: 1,
      pending: 0,
    });
  });

  it.each([
    {
      label: "unavailable work remains pending",
      result: { processed: 1, synced: 0, pending: 1, degraded: false },
    },
    {
      label: "queue read is degraded",
      result: { processed: 0, synced: 0, pending: 0, degraded: true },
    },
  ])("returns retryable 503 when $label", async ({ result }) => {
    drainState.result = result;

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      retryable: true,
    });
  });

  it("processes at most twenty queued pairs per run", async () => {
    drainState.queued = 21;

    const response = await GET(req("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      processed: 20,
      synced: 20,
      pending: 0,
    });
  });

  it("has an independent production schedule", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path?: string }> };

    expect(
      config.crons?.some(
        (cron) => cron.path === "/api/cron/reconcile-price-trust",
      ),
    ).toBe(true);
  });
});
