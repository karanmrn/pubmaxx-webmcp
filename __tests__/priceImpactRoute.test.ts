import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const authState = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/authServer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authServer")>();
  return {
    ...actual,
    callerUserId: async () => authState.userId,
  };
});

const impactState = vi.hoisted(() => ({
  result: {
    status: "ready" as "ready" | "degraded",
    observationsLogged: 2,
    pricesTrustedNow: 1,
    lifetimeTrustUnlocks: 1,
  } as
    | {
        status: "ready";
        observationsLogged: number;
        pricesTrustedNow: number;
        lifetimeTrustUnlocks: number;
      }
    | { status: "degraded" },
}));
vi.mock("@/lib/priceTrustImpact.server", () => ({
  readPriceTrustImpact: async (userId: string) => {
    if (userId !== authState.userId) {
      return { status: "degraded" as const };
    }
    return impactState.result;
  },
}));

import { GET } from "@/app/api/price-impact/route";

function getRequest(url = "http://localhost/api/price-impact"): Request {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  authState.userId = null;
  impactState.result = {
    status: "ready",
    observationsLogged: 2,
    pricesTrustedNow: 1,
    lifetimeTrustUnlocks: 1,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/price-impact", () => {
  it("refuses a signed-out caller with the house envelope", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.error).toBe("Sign in to view your price impact.");
    expect(body).not.toHaveProperty("observationsLogged");
  });

  it("answers the caller's own measures and ignores a foreign user query", async () => {
    authState.userId = "00000000-0000-4000-8000-0000000000aa";
    const res = await GET(
      getRequest("http://localhost/api/price-impact?userId=somebody-else"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({
      status: "ready",
      observationsLogged: 2,
      pricesTrustedNow: 1,
      lifetimeTrustUnlocks: 1,
    });
  });

  it("does not answer zeros when the read is degraded", async () => {
    authState.userId = "00000000-0000-4000-8000-0000000000aa";
    impactState.result = { status: "degraded" };
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: "degraded" });
    expect(body.observationsLogged).toBeUndefined();
    expect(body.pricesTrustedNow).toBeUndefined();
    expect(body.lifetimeTrustUnlocks).toBeUndefined();
  });
});
