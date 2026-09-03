import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST/GET /api/visit-reports — validation, the durable rate-limit boundary, the
// public report queue, contributor count, and moderator gate. The @/lib/supabase seam is
// pinned so isSupabaseConfigured reads false: the in-memory limiter and the
// process-memory store back the route (the house pattern for keyless write-route
// tests), so the suite is hermetic with no network.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

const contributionIdentityState = vi.hoisted(() => ({
  resolution: {
    ok: true as const,
    accountId: "attacker-account",
    actor: "profile:attacker-profile",
    handle: "sam",
  } as import("@/lib/contributionIdentity.server").ContributionIdentityResolution,
}));

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: async () => contributionIdentityState.resolution,
}));

const rateLimitCalls = vi.hoisted(() => [] as Array<[string, string]>);

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return {
    ...actual,
    isLimited: async (localKey: string, durableKey: string, ...rest: unknown[]) => {
      rateLimitCalls.push([localKey, durableKey]);
      return actual.isLimited(
        localKey,
        durableKey,
        rest[0] as number | undefined,
        rest[1] as number | undefined,
        rest[2] as { failClosed?: boolean } | undefined,
      );
    },
  };
});

import { GET, POST } from "@/app/api/visit-reports/route";
import { __resetVisitReports, memoryVisitReportStore } from "@/lib/visitReportsStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function post(body: unknown, ip = "203.0.113.9"): Request {
  return new Request("http://localhost/api/visit-reports", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(qs: string, adminToken?: string): Request {
  const request = new Request(`http://localhost/api/visit-reports${qs}`, { method: "GET" });
  if (adminToken) request.headers.set("x-admin-token", adminToken);
  return request;
}

// The route validates against the REAL clock, so a night it posts has to be
// relative to today rather than a literal that ages out of the 90-day window.
function dayKey(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PUBMAX_SOCIAL_FREEZE;
  // Set an admin token so isModerator requires it (it defaults OPEN under
  // NODE_ENV=test when unset); the gate tests then send no token and get 403.
  process.env.ADMIN_TOKEN = "test-admin-secret";
  __resetVisitReports();
  __resetPintDrops();
  rateLimitCalls.length = 0;
  contributionIdentityState.resolution = {
    ok: true,
    accountId: "attacker-account",
    actor: "profile:attacker-profile",
    handle: "sam",
  };
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/visit-reports (create)", () => {
  it("attributes an attacker's post to the authenticated account, not the claimed victim", async () => {
    contributionIdentityState.resolution = {
      ok: true,
      accountId: "attacker-account",
      actor: "profile:attacker-profile",
      handle: "attacker",
    };

    const res = await POST(
      post({
        venueId: "venue-1",
        handle: "victim",
        visitedAt: dayKey(2),
        busyness: "steady",
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      report: { handle: "attacker" },
    });
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toEqual([
      expect.objectContaining({ handle: "attacker" }),
    ]);
  });

  it("requires the established account prompt without orphaning a legacy unlinked row", async () => {
    await memoryVisitReportStore.create({
      venueId: "venue-legacy",
      handle: "legacy_writer",
      visitedAt: dayKey(3),
      busyness: "quiet",
      noise: null,
      seating: null,
      serviceWait: null,
      note: "",
    });
    contributionIdentityState.resolution = {
      ok: false,
      body: {
        status: "sign_in_required",
        error: "Sign in to contribute.",
      },
      httpStatus: 401,
    };

    const rejected = await POST(
      post({
        venueId: "venue-legacy",
        handle: "legacy_writer",
        visitedAt: dayKey(1),
        busyness: "rammed",
      }),
    );

    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({
      status: "sign_in_required",
      error: "Sign in to contribute.",
    });
    const legacyRead = await GET(get("?venueId=venue-legacy"));
    expect(await legacyRead.json()).toMatchObject({
      status: "ready",
      reports: [expect.objectContaining({ handle: "legacy_writer" })],
    });
  });

  it("keys the creation budget by immutable profile actor plus hashed IP", async () => {
    contributionIdentityState.resolution = {
      ok: true,
      accountId: "attacker-account",
      actor: "profile:attacker-profile",
      handle: "attacker",
    };

    const res = await POST(
      post({
        venueId: "venue-1",
        handle: "victim",
        visitedAt: dayKey(2),
        busyness: "steady",
      }),
    );

    expect(res.status).toBe(201);
    expect(rateLimitCalls).toHaveLength(1);
    const [localKey, durableKey] = rateLimitCalls[0];
    expect(localKey).toBe(durableKey);
    expect(localKey).toMatch(
      /^visit-report:profile:attacker-profile:[a-f0-9]{64}$/,
    );
    expect(localKey).not.toContain("victim");
  });

  it("creates a valid report (201) and stores it", async () => {
    const res = await POST(
      post({
        venueId: "venue-1",
        handle: "sam",
        visitedAt: dayKey(2),
        busyness: "steady",
        noise: "easy-to-talk",
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { report: { id: string; handle: string } };
    expect(data.report.handle).toBe("sam");
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
  });

  it("400s a night outside the 90-day window before the store is touched", async () => {
    const res = await POST(
      post({ venueId: "venue-1", handle: "sam", visitedAt: dayKey(200), busyness: "steady" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_REPORT" });
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(0);
  });

  it("returns a retryable 503 when report persistence is unavailable", async () => {
    vi.spyOn(memoryVisitReportStore, "create").mockRejectedValueOnce(
      new Error("durable schema missing in production"),
    );

    const res = await POST(
      post({ venueId: "venue-1", handle: "sam", busyness: "steady", noise: "loud" }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });

  it("400s a malformed body", async () => {
    expect((await POST(post("{oops"))).status).toBe(400);
  });

  it("400s a report with no signal", async () => {
    const res = await POST(post({ venueId: "venue-1", handle: "sam" }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_REPORT");
  });

  it("429s once the per-profile durable budget is exceeded", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 9; i += 1) {
      last = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "steady" }));
    }
    expect(last?.status).toBe(429);
    const data = (await last!.json()) as { code: string; retryable: boolean };
    expect(data.code).toBe("RATE_LIMITED");
    expect(data.retryable).toBe(true);
  });

  it("pauses creation under the social freeze (503)", async () => {
    process.env.PUBMAX_SOCIAL_FREEZE = "social";
    const res = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "steady" }));
    expect(res.status).toBe(503);
  });
});

describe("POST /api/visit-reports (report + moderation)", () => {
  it("derives reporter identity from the request and leaves removal to a moderator", async () => {
    const created = await POST(post({ venueId: "venue-1", handle: "sam", busyness: "rammed" }));
    const { report } = (await created.json()) as { report: { id: string } };

    const first = await POST(
      post({ action: "report", id: report.id, actor: "client-claim-a" }, "203.0.113.10"),
    );
    expect(first.status).toBe(200);
    // Same origin cannot manufacture a second actor by changing the body.
    const duplicate = await POST(
      post({ action: "report", id: report.id, actor: "client-claim-b" }, "203.0.113.10"),
    );
    expect(duplicate.status).toBe(429);

    const second = await POST(
      post({ action: "report", id: report.id, actor: "client-claim-c" }, "203.0.113.11"),
    );
    expect(second.status).toBe(200);
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(1);
    const queue = await memoryVisitReportStore.listForReview();
    expect(queue).toHaveLength(1);
    expect(queue[0].reportCount).toBe(2);

    const hide = post({ action: "hide", id: report.id });
    hide.headers.set("x-admin-token", "test-admin-secret");
    expect((await POST(hide)).status).toBe(200);
    expect((await memoryVisitReportStore.readForVenue("venue-1")).reports).toHaveLength(0);
  });

  it("404s a report against an unknown id", async () => {
    const res = await POST(post({ action: "report", id: "nope", actor: "a" }));
    expect(res.status).toBe(404);
  });

  it("403s a moderator action without the admin token", async () => {
    const res = await POST(post({ action: "hide", id: "whatever" }));
    expect(res.status).toBe(403);
  });

  it("returns a retryable 503 when an abuse report cannot persist", async () => {
    vi.spyOn(memoryVisitReportStore, "report").mockRejectedValueOnce(
      new Error("durable schema missing in production"),
    );

    const res = await POST(post({ action: "report", id: "report-1", actor: "actor-a" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });

  it("returns a retryable 503 when moderation cannot persist", async () => {
    vi.spyOn(memoryVisitReportStore, "moderate").mockRejectedValueOnce(
      new Error("durable schema missing in production"),
    );
    const request = post({ action: "restore", id: "report-1" });
    request.headers.set("x-admin-token", "test-admin-secret");

    const res = await POST(request);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });
});

describe("GET /api/visit-reports", () => {
  it("400s without a venueId", async () => {
    expect((await GET(get(""))).status).toBe(400);
  });

  it("returns newest-first individual reports with honest read status", async () => {
    const base = {
      venueId: "venue-2",
      busyness: "steady" as const,
      noise: "easy-to-talk" as const,
      seating: "plenty" as const,
      serviceWait: "quick" as const,
      note: "",
    };
    // The two keys DISAGREE: the older night is submitted last. A row shows its
    // visit date only, so the lane orders on the night, not on the submission.
    await memoryVisitReportStore.create(
      { ...base, handle: "user1", visitedAt: "2026-07-20" },
      1,
    );
    await memoryVisitReportStore.create(
      { ...base, handle: "user0", visitedAt: "2026-07-19" },
      2,
    );
    const res = await GET(get("?venueId=venue-2"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      status: string;
      reports: { visitedAt: string }[];
      summary?: unknown;
    };
    expect(data.status).toBe("ready");
    expect(data.reports.map((report) => report.visitedAt)).toEqual([
      "2026-07-20",
      "2026-07-19",
    ]);
    expect(data.summary).toBeUndefined();
  });

  it("exposes the visible count a leaderboard can read", async () => {
    await memoryVisitReportStore.create({
      venueId: "venue-2",
      handle: "sam",
      visitedAt: "2026-07-20",
      busyness: "steady",
      noise: null,
      seating: null,
      serviceWait: null,
      note: "",
    });

    const res = await GET(get("?contributor=  SAM "));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      contributor: "sam",
      count: 1,
      status: "ready",
    });
  });

  it("403s the moderator queue without the admin token", async () => {
    expect((await GET(get("?status=reported"))).status).toBe(403);
    expect((await GET(get("?status=hidden"))).status).toBe(403);
  });

  it("lists hidden reports with the identity a moderator restores them by", async () => {
    const created = await POST(post({ venueId: "venue-3", handle: "sam", busyness: "rammed" }));
    const { report } = (await created.json()) as { report: { id: string } };

    const hide = post({ action: "hide", id: report.id, note: "abuse" });
    hide.headers.set("x-admin-token", "test-admin-secret");
    expect((await POST(hide)).status).toBe(200);
    expect((await memoryVisitReportStore.readForVenue("venue-3")).reports).toHaveLength(0);

    // The hidden lane is the only place the id survives a hide, so this is what
    // makes the decision reversible from the admin surface.
    const listed = await GET(get("?status=hidden", "test-admin-secret"));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      reports: { id: string; venueId: string; handle: string; visitedAt: string }[];
    };
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({
      id: report.id,
      venueId: "venue-3",
      handle: "sam",
    });
    expect(body.reports[0].visitedAt).toBeTruthy();

    const restore = post({ action: "restore", id: body.reports[0].id });
    restore.headers.set("x-admin-token", "test-admin-secret");
    expect((await POST(restore)).status).toBe(200);
    // Restored means back on PUBLIC reads, not just out of the hidden lane.
    expect((await memoryVisitReportStore.readForVenue("venue-3")).reports).toHaveLength(1);
    const after = (await (await GET(get("?status=hidden", "test-admin-secret"))).json()) as {
      reports: unknown[];
    };
    expect(after.reports).toHaveLength(0);
  });
});
