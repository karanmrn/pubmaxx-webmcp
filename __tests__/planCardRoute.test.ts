import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { GET } from "@/app/api/plan-card/route";
import { __resetMemoryPlans, memoryPlanStore } from "@/lib/planStore";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetPlanCollaboration, planCollaborationStore } from "@/lib/planCollaborationStore";

// Vercel runs vitest under NODE_ENV=production; neutralize the prod-only
// guards (durable rate-limit path, Supabase reads) the same way
// lastTrainRoute.test.ts does, so the in-memory limiter/store paths are
// exercised deterministically regardless of preset SUPABASE_* env vars.
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  __resetMemoryPlans();
  __resetPintDrops();
  __resetPlanCollaboration();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("GET /api/plan-card", () => {
  it("renders the public Plan through the shared OG image pipeline", async () => {
    const created = await memoryPlanStore.create({
      title: "Thursday, sorted",
      startTime: "2026-07-16T17:30:00.000Z",
      creatorName: "Karan",
      stops: [{ venueId: "venue-1", venueName: "The George" }],
    });
    if (!created.ok) throw new Error("fixture Plan was not created");

    const response = await GET(new Request(`http://localhost/api/plan-card?id=${created.plan.plan.id}`, { headers: { "x-forwarded-for": "198.51.100.1" } }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
  });

  it("404s rather than leaking whether a malformed capability resembles a Plan", async () => {
    const response = await GET(new Request("http://localhost/api/plan-card?id=not-a-plan", { headers: { "x-forwarded-for": "198.51.100.2" } }));
    expect(response.status).toBe(404);
  });

  it("429s after 30 requests/min from one IP, matching sibling OG card routes", async () => {
    const created = await memoryPlanStore.create({
      title: "Thursday, sorted",
      startTime: "2026-07-16T17:30:00.000Z",
      creatorName: "Karan",
      stops: [{ venueId: "venue-1", venueName: "The George" }],
    });
    if (!created.ok) throw new Error("fixture Plan was not created");
    const url = `http://localhost/api/plan-card?id=${created.plan.plan.id}`;

    const responses: Response[] = [];
    for (let i = 0; i < 31; i++) {
      responses.push(
        await GET(new Request(url, { headers: { "x-forwarded-for": "198.51.100.30" } })),
      );
    }

    expect(responses.slice(0, 30).every((res) => res.status === 200)).toBe(true);
    expect(responses[30].status).toBe(429);
  });

  it("renders the crew vibe tally without breaking the card when the plan has votes", async () => {
    const created = await memoryPlanStore.create({
      title: "Thursday, sorted",
      startTime: "2026-07-19T17:30:00.000Z",
      creatorName: "Karan",
      stops: [{ venueId: "venue-1", venueName: "The George" }],
    });
    if (!created.ok) throw new Error("fixture Plan was not created");
    const id = created.plan.plan.id;
    const guest = await memoryPlanStore.join(id, "Mate", { collaborationAuthorized: true });
    if (!guest.ok) throw new Error("guest join failed");
    const store = planCollaborationStore();
    expect(await store.recordVibeVote(id, created.memberToken, "bender", "card-vibe-1")).toMatchObject({ ok: true });
    expect(await store.recordVibeVote(id, guest.memberToken, "quiet", "card-vibe-2")).toMatchObject({ ok: true });

    const response = await GET(new Request(`http://localhost/api/plan-card?id=${id}&vibe=on-a-bender`, { headers: { "x-forwarded-for": "198.51.100.44" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});
