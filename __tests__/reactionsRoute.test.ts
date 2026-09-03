import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { HandleActionGate } from "@/lib/profileOwnership";

// Handler-level coverage for app/api/pint-drops/reactions/route.ts. The route
// talks to the ReactionsStore seam only; we pin the process-memory store
// deterministically by mocking isSupabaseConfigured() === false at the
// @/lib/supabase seam — NOT by stubbing NODE_ENV, which Vite bakes at transform
// time (a runtime stub is a silent no-op under a production build; backend
// selection reads SUPABASE_* here, never NODE_ENV). See profileOwnershipRoute /
// pintDrops for the house pattern.
//
// Note on the memory store: memoryReactionsStore keeps a module-level Set that
// has no FK, so it NEVER raises UnknownDropError (any id is reactable in dev).
// To exercise the 404 UnknownDropError contract we drive the SUPABASE path with
// a stubbed store whose toggle throws UnknownDropError — see that describe block.
const { supaGuard, emitSpy, gateSpy } = vi.hoisted(() => ({
  supaGuard: { configured: false },
  emitSpy: vi.fn().mockResolvedValue(undefined),
  gateSpy: vi.fn(
    async (_request: Request, handle: string): Promise<HandleActionGate> => ({
      allowed: true,
      handle,
      callerUserId: "user-1",
    }),
  ),
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => supaGuard.configured };
});
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/notificationsStore", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notificationsStore")>();
  return {
    ...actual,
    emitNotification: emitSpy,
    dropOwnerHandle: async () => "owner",
  };
});
vi.mock("@/lib/profileOwnership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileOwnership")>();
  return { ...actual, gateHandleAction: gateSpy };
});

import { GET, POST } from "@/app/api/pint-drops/reactions/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import { __resetMemoryReactions } from "@/lib/reactionsStore";

const URL_BASE = "http://localhost/api/pint-drops/reactions";

function getSummaries(query: string): Promise<Response> {
  return GET(new Request(`${URL_BASE}?${query}`));
}

function toggle(body: unknown): Promise<Response> {
  return POST(new Request(URL_BASE, { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  // Pin the memory store via the mocked seam (isSupabaseConfigured() === false);
  // the Supabase-path block below flips supaGuard.configured true for its cases.
  supaGuard.configured = false;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  __resetMemoryReactions();
  // The reactions POST is now flood-limited per hashed actor (in the same
  // in-memory rate window every route shares). Reset it between cases so one
  // test's toggles never bleed into another's budget.
  __resetPintDrops();
  emitSpy.mockClear();
  gateSpy.mockClear();
  gateSpy.mockImplementation(
    async (_request: Request, handle: string): Promise<HandleActionGate> => ({
      allowed: true,
      handle,
      callerUserId: "user-1",
    }),
  );
});

describe("GET /api/pint-drops/reactions (batched summaries)", () => {
  it("returns an empty summaries map when no ids are given", async () => {
    const res = await getSummaries("actor=dev-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summaries: {} });
  });

  it("returns a per-id summary for every requested id (zero-state before any toggle)", async () => {
    const res = await getSummaries("ids=a,b,c&actor=dev-1");
    expect(res.status).toBe(200);
    const { summaries } = await res.json();
    expect(Object.keys(summaries).sort()).toEqual(["a", "b", "c"]);
    // Zero-state: no counts, empty `mine`.
    expect(summaries.a).toEqual({ counts: {}, mine: [] });
  });

  it("reflects a toggled reaction in the batched summary, incl. the actor's own `mine`", async () => {
    await toggle({ id: "drop-x", actor: "dev-1", reaction: "cheers" });

    const mine = await getSummaries("ids=drop-x&actor=dev-1");
    const forActor = (await mine.json()).summaries["drop-x"];
    expect(forActor.counts).toEqual({ cheers: 1 });
    expect(forActor.mine).toEqual(["cheers"]);

    // A different actor sees the count but not it in their `mine`.
    const other = await getSummaries("ids=drop-x&actor=dev-2");
    const forOther = (await other.json()).summaries["drop-x"];
    expect(forOther.counts).toEqual({ cheers: 1 });
    expect(forOther.mine).toEqual([]);
  });

  it("trims/dedupes/caps ids and ignores blank entries", async () => {
    const res = await getSummaries("ids= a , ,b ,&actor=dev-1");
    const { summaries } = await res.json();
    // Blank fragments dropped; whitespace trimmed.
    expect(Object.keys(summaries).sort()).toEqual(["a", "b"]);
  });
});

describe("POST /api/pint-drops/reactions (toggle)", () => {
  it("toggles a reaction ON then OFF for the same actor", async () => {
    const on = await toggle({ id: "d1", actor: "dev-1", reaction: "bargain" });
    expect(on.status).toBe(200);
    expect((await on.json()).summary).toEqual({ counts: { bargain: 1 }, mine: ["bargain"] });

    const off = await toggle({ id: "d1", actor: "dev-1", reaction: "bargain" });
    expect(off.status).toBe(200);
    // Toggling the same reaction again removes it.
    expect((await off.json()).summary).toEqual({ counts: {}, mine: [] });
  });

  it("400s a reaction off the server allowlist (never stored)", async () => {
    const res = await toggle({ id: "d1", actor: "dev-1", reaction: "spicy" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown reaction.", code: "INVALID_REQUEST", retryable: false });

    // Confirm the bad reaction did not land: the drop's summary is still zero.
    const check = await getSummaries("ids=d1&actor=dev-1");
    expect((await check.json()).summaries.d1).toEqual({ counts: {}, mine: [] });
  });

  it("400s a missing pint drop id", async () => {
    const res = await toggle({ actor: "dev-1", reaction: "cheers" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing pint drop id.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s a blank/whitespace-only id", async () => {
    const res = await toggle({ id: "   ", actor: "dev-1", reaction: "cheers" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing pint drop id.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s a non-string reaction", async () => {
    const res = await toggle({ id: "d1", actor: "dev-1", reaction: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown reaction.", code: "INVALID_REQUEST", retryable: false });
  });

  it("400s a malformed JSON body", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed request body.", code: "MALFORMED_REQUEST", retryable: false });
  });

  it("does NOT leak actor_hash/status/moderation fields in any response body", async () => {
    const res = await toggle({ id: "d1", actor: "dev-secret", reaction: "cheers" });
    const json = await res.json();
    const blob = JSON.stringify(json);
    // The public summary is { counts, mine } only.
    expect(Object.keys(json.summary).sort()).toEqual(["counts", "mine"]);
    expect(blob).not.toMatch(/actor_?hash/i);
    expect(blob).not.toMatch(/"status"/);
    expect(blob).not.toContain("dev-secret"); // the raw actor id never echoes back
  });

  it("emits a notification only when the handle passes ownership gate", async () => {
    await toggle({ id: "d1", actor: "dev-1", reaction: "cheers", handle: "ken" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateSpy).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({ actorHandle: "ken", kind: "reaction" }),
    );

    emitSpy.mockClear();
    gateSpy.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      error: "This handle belongs to a signed-in account. Sign in as its owner to continue.",
    });
    await toggle({ id: "d1", actor: "dev-1", reaction: "bargain", handle: "spoof" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("429s once one actor floods past the reaction limit (a fresh actor is unaffected)", async () => {
    // The generous budget is 40 per actor per window; the 41st POST from the
    // SAME actor trips the flood guard. We toggle a valid reaction each time so
    // the request is otherwise well-formed and only the rate limit can 429.
    for (let i = 0; i < 40; i++) {
      const ok = await toggle({ id: "flood", actor: "spammer", reaction: "cheers" });
      expect(ok.status).toBe(200); // every request up to the limit is accepted
    }

    // The 41st from the same actor is refused.
    const limited = await toggle({ id: "flood", actor: "spammer", reaction: "cheers" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "Too many reactions, slow down.", code: "RATE_LIMITED", retryable: true });

    // A different actor has its own budget — the limit is keyed per hashed
    // actor, so it is completely unaffected by the spammer's flood.
    const fresh = await toggle({ id: "flood", actor: "innocent", reaction: "cheers" });
    expect(fresh.status).toBe(200);
  });
});

// The 404 UnknownDropError contract only exists on the Supabase (FK-backed)
// path — a reaction on a drop that isn't in visit_reports. We stub the store to
// throw it and confirm the route maps it to 404 (not 500), and maps any other
// store error to 503.
describe("POST reaction — store error contracts (Supabase path)", () => {
  beforeEach(() => {
    vi.resetModules();
    // This block drives the Supabase (FK-backed) store: flip the mocked guard so
    // isSupabaseConfigured() === true and the route selects supabaseReactionsStore.
    supaGuard.configured = true;
    process.env.SUPABASE_URL = "https://stub.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
  });

  afterAll(() => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("404s an unknown (non-persisted) drop id via UnknownDropError", async () => {
    // Visibility gate must pass so we actually reach the store — stub it open
    // for this contract (Supabase admin isn't real in this suite, so the real
    // gate now returns null (outage) and would 503 first).
    vi.doMock("@/lib/pintDropLookup", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pintDropLookup")>("@/lib/pintDropLookup");
      return {
        ...actual,
        filterPubliclyReadableDropIds: async (ids: readonly string[]) =>
          ids.map((id) => id.trim()).filter(Boolean),
      };
    });
    vi.doMock("@/lib/reactionsStore", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/reactionsStore")>("@/lib/reactionsStore");
      // Mock the factory the route calls — not only the named supabase export
      // (the actual factory closes over the original binding).
      return {
        ...actual,
        reactionsStore: () => ({
          toggle: vi.fn(async (dropId: string) => {
            throw new actual.UnknownDropError(dropId);
          }),
          summarize: async () => ({}),
        }),
      };
    });
    const { POST: PostFresh } = await import("@/app/api/pint-drops/reactions/route");
    const res = await PostFresh(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({ id: "demo-seed", actor: "dev-1", reaction: "cheers" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Pint drop not found.", code: "NOT_FOUND", retryable: false });
    vi.doUnmock("@/lib/reactionsStore");
    vi.doUnmock("@/lib/pintDropLookup");
  });

  it("503s any other store failure (reactions are non-critical)", async () => {
    // Visibility gate must pass so we reach the store — stub it open for this
    // contract (Supabase admin isn't real in this suite).
    vi.doMock("@/lib/pintDropLookup", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/pintDropLookup")>("@/lib/pintDropLookup");
      return {
        ...actual,
        filterPubliclyReadableDropIds: async (ids: readonly string[]) =>
          ids.map((id) => id.trim()).filter(Boolean),
      };
    });
    vi.doMock("@/lib/reactionsStore", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/reactionsStore")>("@/lib/reactionsStore");
      return {
        ...actual,
        reactionsStore: () => ({
          toggle: vi.fn(async () => {
            throw new Error("boom");
          }),
          summarize: async () => ({}),
        }),
      };
    });
    const { POST: PostFresh } = await import("@/app/api/pint-drops/reactions/route");
    const res = await PostFresh(
      new Request(URL_BASE, {
        method: "POST",
        body: JSON.stringify({ id: "d1", actor: "dev-1", reaction: "cheers" }),
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Reactions are unavailable.", code: "UNAVAILABLE", retryable: true });
    vi.doUnmock("@/lib/reactionsStore");
    vi.doUnmock("@/lib/pintDropLookup");
  });

  // 45s: this case exercises the durable-limiter fail-open path, whose fetch
  // retries legitimately take ~18s on Vercel's 4-core CI box — the default 20s
  // timeout left a margin thin enough to flake the production deploy gate.
  it("GET degrades to an empty summaries map on a store error (feed stays up)", { timeout: 45_000 }, async () => {
    vi.doMock("@/lib/reactionsStore", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/reactionsStore")>("@/lib/reactionsStore");
      return {
        ...actual,
        reactionsStore: () => ({
          toggle: async () => ({ counts: {}, mine: [] }),
          summarize: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      };
    });
    const { GET: GetFresh } = await import("@/app/api/pint-drops/reactions/route");
    const res = await GetFresh(new Request(`${URL_BASE}?ids=a,b&actor=dev-1`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summaries: {} });
    vi.doUnmock("@/lib/reactionsStore");
  });
});
