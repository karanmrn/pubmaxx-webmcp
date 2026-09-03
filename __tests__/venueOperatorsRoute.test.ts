import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST/GET /api/venue-operators/claim — the account boundary on create, the
// per-account rate limit, the moderator verify/reject/revoke gate, and the own-
// state read. Supabase is pinned unconfigured so the in-memory limiter + memory
// store back the route (house pattern for keyless-shaped write-route tests).
// callerAuthIdentity is mocked so we can drive signed-in / signed-out at will.

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const auth = vi.hoisted(() => ({ identity: null as { id: string; email: string | null } | null }));
vi.mock("@/lib/authServer", () => ({
  callerAuthIdentity: () => Promise.resolve(auth.identity),
}));

import { GET, POST } from "@/app/api/venue-operators/claim/route";
import { __resetVenueOperators, memoryVenueOperatorStore } from "@/lib/venueOperatorsStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function req(body: unknown, ip = "203.0.113.5"): Request {
  return new Request("http://localhost/api/venue-operators/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function get(qs: string): Request {
  return new Request(`http://localhost/api/venue-operators/claim${qs}`, { method: "GET" });
}
function withAdmin(r: Request): Request {
  r.headers.set("x-admin-token", "test-admin-secret");
  return r;
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.ADMIN_TOKEN = "test-admin-secret";
  auth.identity = null;
  __resetVenueOperators();
  __resetPintDrops();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/venue-operators/claim (create)", () => {
  it("401s an anonymous caller", async () => {
    const res = await POST(req({ venueId: "v1", evidenceKind: "email-domain", evidenceNote: "me@pub" }));
    expect(res.status).toBe(401);
  });

  it("creates a pending claim for a signed-in caller (201)", async () => {
    auth.identity = { id: "acct-1", email: "landlord@thepub.co.uk" };
    const res = await POST(req({ venueId: "v1", evidenceKind: "email-domain", evidenceNote: "on the domain" }));
    expect(res.status).toBe(201);
    const data = (await res.json()) as { claim: { verificationState: string } };
    expect(data.claim.verificationState).toBe("pending");
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "v1")).toBe(false);
  });

  it("returns a retryable 503 when claim persistence is unavailable", async () => {
    auth.identity = { id: "acct-1", email: "landlord@thepub.co.uk" };
    vi.spyOn(memoryVenueOperatorStore, "claim").mockRejectedValueOnce(
      new Error("durable schema missing in production"),
    );

    const res = await POST(
      req({ venueId: "v1", evidenceKind: "email-domain", evidenceNote: "on the domain" }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });

  it("400s an invalid claim (missing evidence kind)", async () => {
    auth.identity = { id: "acct-1", email: null };
    const res = await POST(req({ venueId: "v1", evidenceNote: "hi" }));
    expect(res.status).toBe(400);
  });

  it("429s once the per-account budget is exceeded", async () => {
    auth.identity = { id: "acct-1", email: null };
    let last: Response | null = null;
    for (let i = 0; i < 11; i += 1) {
      last = await POST(req({ venueId: `v${i}`, evidenceKind: "phone", evidenceNote: "ring the bar" }));
    }
    expect(last?.status).toBe(429);
  });
});

describe("POST /api/venue-operators/claim (moderator verify/reject/revoke)", () => {
  it("403s a verify without the admin token", async () => {
    const res = await POST(req({ action: "verify", id: "whatever" }));
    expect(res.status).toBe(403);
  });

  it("verifies a pending claim with the admin token", async () => {
    auth.identity = { id: "acct-1", email: null };
    const created = await POST(req({ venueId: "v1", evidenceKind: "document", evidenceNote: "licence" }));
    const { claim } = (await created.json()) as { claim: { id: string } };
    const res = await POST(withAdmin(req({ action: "verify", id: claim.id })));
    expect(res.status).toBe(200);
    expect(await memoryVenueOperatorStore.isVerifiedOperator("acct-1", "v1")).toBe(true);
  });

  it("404s a moderator action against an unknown id", async () => {
    const res = await POST(withAdmin(req({ action: "reject", id: "nope" })));
    expect(res.status).toBe(404);
  });

  it("returns a retryable 503 when a moderator decision cannot persist", async () => {
    vi.spyOn(memoryVenueOperatorStore, "setState").mockRejectedValueOnce(
      new Error("durable schema missing in production"),
    );

    const res = await POST(withAdmin(req({ action: "verify", id: "claim-1" })));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });
});

describe("GET /api/venue-operators/claim", () => {
  it("returns the signed-in caller's own claim state", async () => {
    auth.identity = { id: "acct-1", email: null };
    await POST(req({ venueId: "v1", evidenceKind: "email-domain", evidenceNote: "domain" }));
    const res = await GET(get("?venueId=v1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { claim: { verificationState: string } | null };
    expect(data.claim?.verificationState).toBe("pending");
  });

  it("401s the own-state read when anonymous", async () => {
    expect((await GET(get("?venueId=v1"))).status).toBe(401);
  });

  it("403s the moderator review queue without the admin token", async () => {
    expect((await GET(get("?state=pending"))).status).toBe(403);
  });

  it("serves the review queue with the admin token", async () => {
    auth.identity = { id: "acct-1", email: null };
    await POST(req({ venueId: "v1", evidenceKind: "phone", evidenceNote: "bar phone" }));
    const res = await GET(withAdmin(get("?state=pending")));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { claims: unknown[] };
    expect(data.claims).toHaveLength(1);
  });
});
