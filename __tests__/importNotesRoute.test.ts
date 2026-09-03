import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverEnvGuard = vi.hoisted(() => ({
  assertServerEnv: vi.fn<() => void>(() => {
    throw new Error("durable production store unavailable");
  }),
}));

// Mock Supabase to use in-memory rate limiting, and disable serverEnv checks.
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
  };
});

vi.mock("@/lib/serverEnv", () => ({
  assertServerEnv: serverEnvGuard.assertServerEnv,
  assertProductionSecrets: () => {},
}));

// Mock the admin auth so we can control moderator status
vi.mock("@/lib/adminAuth", () => ({
  isModerator: () => true,
}));

const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  serverEnvGuard.assertServerEnv.mockReset();
  serverEnvGuard.assertServerEnv.mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
});

describe("POST /api/admin/import-notes", () => {
  it("loads without requiring the durable production store", async () => {
    await expect(import("@/app/api/admin/import-notes/route")).resolves.toMatchObject({
      GET: expect.any(Function),
      POST: expect.any(Function),
      PATCH: expect.any(Function),
    });
    expect(serverEnvGuard.assertServerEnv).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", () => new Request("http://localhost/api/admin/import-notes")],
    [
      "POST",
      () =>
        new Request("http://localhost/api/admin/import-notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "A note", provenance: "sourced" }),
        }),
    ],
    [
      "PATCH",
      () =>
        new Request("http://localhost/api/admin/import-notes", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "note-1", action: "dismiss" }),
        }),
    ],
  ] as const)("enforces production store safety when handling %s", async (method, request) => {
    const route = await import("@/app/api/admin/import-notes/route");
    const handler = route[method] as (request: Request) => Promise<Response>;
    serverEnvGuard.assertServerEnv.mockImplementationOnce(() => {
      throw new Error("durable production store unavailable");
    });

    await expect(handler(request())).rejects.toThrow(
      "durable production store unavailable",
    );
    expect(serverEnvGuard.assertServerEnv).toHaveBeenCalledOnce();
  });

  it("rate-limits import-notes submissions per hashed client IP", async () => {
    const { POST } = await import("@/app/api/admin/import-notes/route");
    const responses: Response[] = [];
    for (let i = 0; i < 11; i++) {
      responses.push(
        await POST(
          new Request("http://localhost/api/admin/import-notes", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-forwarded-for": "198.51.100.40",
            },
            body: JSON.stringify({
              body: `https://example.com/note-${i}`,
              venueId: "venue-test",
              venueName: "Test Venue",
              provenance: "sourced",
            }),
          }),
        ),
      );
    }

    expect(responses.slice(0, 10).every((res) => res.status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(await responses[10].json()).toEqual({ error: "Too many requests, slow down.", code: "RATE_LIMITED", retryable: true });
  });
});
