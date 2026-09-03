import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/area-demand — validation, the durable rate-limit boundary, and the
// certification posture. The @/lib/supabase seam is pinned so isSupabaseConfigured
// reads false: the in-memory limiter and the process-memory store back the route
// (the house pattern for keyless write-route tests — see checkInsRoute.test.ts),
// so the suite is hermetic with no network.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { POST } from "@/app/api/area-demand/route";
import { __resetAreaDemand, memoryAreaDemandStore } from "@/lib/areaDemandStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function post(body: unknown): Request {
  return new Request("http://localhost/api/area-demand", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetAreaDemand();
  __resetPintDrops();
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/area-demand", () => {
  it("records demand for an area with no email (200)", async () => {
    const res = await POST(post({ area: "Peckham", source: "area-picker" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; status: string };
    expect(data.ok).toBe(true);
    expect(data.status).toBe("recorded");
    expect(await memoryAreaDemandStore.countForArea("peckham")).toBe(1);
  });

  it("returns a retryable 503 when demand persistence is unavailable", async () => {
    vi.spyOn(memoryAreaDemandStore, "record").mockResolvedValueOnce({
      status: "recorded",
      failed: true,
    });

    const res = await POST(post({ area: "Peckham", source: "area-picker" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "STORE_UNAVAILABLE", retryable: true });
  });

  it("records demand with an offered email (200)", async () => {
    const res = await POST(post({ area: "Deptford", email: "me@example.com" }));
    expect(res.status).toBe(200);
    expect(await memoryAreaDemandStore.countForArea("deptford")).toBe(1);
  });

  it("400s a malformed body", async () => {
    const res = await POST(post("{oops"));
    expect(res.status).toBe(400);
  });

  it("400s a missing area", async () => {
    const res = await POST(post({ source: "map-miss" }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_AREA");
  });

  it("400s a non-empty invalid email", async () => {
    const res = await POST(post({ area: "Peckham", email: "nope" }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_EMAIL");
  });

  it("429s once the per-IP durable budget is exceeded", async () => {
    // PER_IP_LIMIT = 8: the ninth hit from one origin in the window trips.
    let last: Response | null = null;
    for (let i = 0; i < 9; i += 1) {
      last = await POST(post({ area: `Area ${i}` }));
    }
    expect(last?.status).toBe(429);
    const data = (await last!.json()) as { code: string; retryable: boolean };
    expect(data.code).toBe("RATE_LIMITED");
    expect(data.retryable).toBe(true);
  });
});
