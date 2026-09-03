import { beforeEach, describe, expect, it, vi } from "vitest";

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

const moderatorState = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/adminAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/adminAuth")>();
  return {
    ...actual,
    isModerator: () => moderatorState.on,
  };
});

// One case simulates the city pack failing to load; every other case passes
// through to the real canonical lookup on disk, so an unknown id really is
// unknown.
const venueIndexState = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/lib/venueAliases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueAliases")>();
  return {
    ...actual,
    resolveCanonicalVenueId: async (id: string) =>
      id === "legacy-occupancy-pub" ? "venue-xjf3n0" : actual.resolveCanonicalVenueId(id),
  };
});
vi.mock("@/lib/venueIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/venueIndex")>();
  return {
    ...actual,
    lookupCanonicalVenue: async (id: string) => {
      const canonicalId =
        id === "legacy-occupancy-pub" ? "venue-xjf3n0" : id;
      return venueIndexState.unavailable
        ? { status: "unavailable" as const, canonicalId }
        : actual.lookupCanonicalVenue(canonicalId);
    },
  };
});

const storeState = vi.hoisted(() => ({ failRead: false }));
vi.mock("@/lib/occupancyStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/occupancyStore")>();
  return {
    ...actual,
    occupancyStore: () => {
      const store = actual.occupancyStore();
      return {
        ...store,
        async readNow(venueId: string, now?: number) {
          if (storeState.failRead) throw new Error("lookup failed");
          return store.readNow(venueId, now);
        },
      };
    },
  };
});

import { GET, POST } from "@/app/api/venues/[id]/occupancy/route";
import { __resetMemoryOccupancyReports } from "@/lib/occupancyStore";
import { __resetPintDrops } from "@/lib/pintDrops";

const VENUE = "venue-xjf3n0";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/venues/venue-1/occupancy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.9",
    },
    body: JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request("http://localhost/api/venues/venue-1/occupancy");
}

beforeEach(() => {
  authState.userId = null;
  storeState.failRead = false;
  venueIndexState.unavailable = false;
  moderatorState.on = false;
  __resetMemoryOccupancyReports();
  __resetPintDrops();
});

describe("GET /api/venues/[id]/occupancy", () => {
  it("answers an empty ready read, never a missing city", async () => {
    const response = await GET(getRequest(), params("venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: null,
      ageMinutes: null,
      reportersLast90: 0,
      degraded: false,
      state: "none",
    });
  });

  it("marks a failed read degraded rather than empty", async () => {
    storeState.failRead = true;
    const response = await GET(getRequest(), params("venue-1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: null,
      degraded: true,
      state: "degraded",
    });
  });
});

describe("POST /api/venues/[id]/occupancy", () => {
  it("requires a signed-in account", async () => {
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("writes a crowd report and reads it back", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "some seats" }),
      params(VENUE),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: "some-seats",
      ageMinutes: 0,
      reportersLast90: 1,
      degraded: false,
      state: "fresh",
      level: "some-seats",
    });
  });

  it("updates a re-tap by the same account", async () => {
    authState.userId = "user-a";
    await POST(postRequest({ level: "empty" }), params(VENUE));
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      now: "full",
      reportersLast90: 1,
    });
  });

  it("refuses a venue the index does not hold", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "full" }),
      params("totally-fake-venue-xyz"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Pick a venue from the map.",
      code: "INVALID_REQUEST",
    });

    const read = await GET(getRequest(), params("totally-fake-venue-xyz"));
    expect(await read.json()).toMatchObject({ now: null, state: "none" });
  });

  it("stores a report under the canonical id when an alias was tapped", async () => {
    authState.userId = "user-a";
    const response = await POST(
      postRequest({ level: "full" }),
      params("legacy-occupancy-pub"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ now: "full" });

    const canonical = await GET(getRequest(), params(VENUE));
    expect(await canonical.json()).toMatchObject({
      now: "full",
      reportersLast90: 1,
    });

    const viaAlias = await GET(getRequest(), params("legacy-occupancy-pub"));
    expect(await viaAlias.json()).toMatchObject({
      now: "full",
      reportersLast90: 1,
    });
  });

  it("answers a retryable 503 when the venue list cannot be read", async () => {
    authState.userId = "user-a";
    venueIndexState.unavailable = true;
    const response = await POST(postRequest({ level: "full" }), params(VENUE));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("rate-limits repeated posts from one account", async () => {
    authState.userId = "user-a";
    let limited = 0;
    for (let i = 0; i < 20; i += 1) {
      const response = await POST(postRequest({ level: "empty" }), params(VENUE));
      if (response.status === 429) {
        limited += 1;
        expect(await response.json()).toMatchObject({ code: "RATE_LIMITED" });
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe("occupancy reader flag and moderator hide", () => {
  it("flags a reading without taking it down", async () => {
    authState.userId = "user-a";
    const written = await POST(postRequest({ level: "full" }), params(VENUE));
    const body = (await written.json()) as { id?: string };
    expect(typeof body.id).toBe("string");

    authState.userId = null;
    const flagged = await POST(
      postRequest({ action: "report", id: body.id }),
      params(VENUE),
    );
    expect(flagged.status).toBe(200);
    expect(await flagged.json()).toEqual({ ok: true });

    const stillUp = await GET(getRequest(), params(VENUE));
    expect(await stillUp.json()).toMatchObject({
      now: "full",
      reportersLast90: 1,
    });
  });

  it("lets a moderator hide and restore a reading", async () => {
    authState.userId = "user-a";
    const written = await POST(postRequest({ level: "full" }), params(VENUE));
    const { id } = (await written.json()) as { id: string };

    const refused = await POST(
      postRequest({ action: "hide", id }),
      params(VENUE),
    );
    expect(refused.status).toBe(403);

    moderatorState.on = true;
    const hidden = await POST(
      postRequest({ action: "hide", id }),
      params(VENUE),
    );
    expect(hidden.status).toBe(200);

    const gone = await GET(getRequest(), params(VENUE));
    expect(await gone.json()).toMatchObject({
      now: null,
      reportersLast90: 0,
    });

    const restored = await POST(
      postRequest({ action: "restore", id }),
      params(VENUE),
    );
    expect(restored.status).toBe(200);
    const back = await GET(getRequest(), params(VENUE));
    expect(await back.json()).toMatchObject({ now: "full", reportersLast90: 1 });
  });
});
