import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin both Vercel-vs-local seams (see checkInsRoute.test.ts for the full note):
// assertServerEnv() runs at module scope, and the store seam must resolve to the
// memory backend deterministically. Mock serverEnv to a no-op and pin
// @/lib/supabase so isSupabaseConfigured()/requiresSupabaseStore() both read
// false — the memory followStore is selected regardless of Vercel's env timing.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { GET } from "@/app/api/profiles/[handle]/lot/route";
import { __resetMemoryFollows, followStore } from "@/lib/followStore";
import { __resetMemoryProfiles } from "@/lib/profileStore";

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryFollows();
  __resetMemoryProfiles();
});

function call(handle: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/profiles/${handle}/lot`), {
    params: Promise.resolve({ handle }),
  });
}

describe("GET /api/profiles/[handle]/lot", () => {
  it("returns the mutual-follow handles (the lot)", async () => {
    const s = followStore();
    await s.follow("karan", "amy");
    await s.follow("amy", "karan");
    await s.follow("karan", "ben"); // one-way, not in the lot

    const res = await call("karan");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { lot: string[] };
    expect(data.lot).toEqual(["amy"]);
  });

  it("returns an empty lot for an empty handle (never 400)", async () => {
    const res = await GET(new Request("http://localhost/api/profiles//lot"), {
      params: Promise.resolve({ handle: "" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { lot: string[] }).toEqual({ lot: [] });
  });
});
