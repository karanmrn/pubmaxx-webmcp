import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PlanState } from "@/lib/plan";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { OPEN_PLAN_PLACE_REFUSED_LINE } from "@/lib/openSocialCrew";

const ALICE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const ALICE_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ALICE_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const REQUEST_ID = "80000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "open-plan-route-key01";
const HOST_CAPABILITY = "legacy-host-capability";

const actor: SocialPostActor = {
  accountId: ALICE_ACCOUNT_ID,
  profileId: ALICE_PROFILE_ID,
  handle: "alice",
};

const planState: PlanState = {
  plan: {
    id: PLAN_ID,
    title: "Open Friday",
    startTime: "2026-08-21T18:30:00.000Z",
    createdAt: "2026-08-16T12:00:00.000Z",
    routeRevision: 1,
    status: "ready",
  },
  stops: [{ venueId: "venue-angel-islington", venueName: "The Angel", position: 0 }],
  crew: [],
  context: null,
  actions: [],
  ending: null,
};

const state = vi.hoisted(() => ({
  access: null as unknown,
  plan: null as PlanState | null,
  planOk: true,
  venueIndexReadable: true,
  venue: { id: "venue-angel-islington", name: "The Angel" } as { id: string; name: string } | null,
  places: [
    {
      id: "tube-kings-cross-st-pancras",
      name: "King's Cross",
      coordinates: [-0.124, 51.5308] as [number, number],
    },
  ],
}));

const store = vi.hoisted(() => ({
  read: vi.fn(),
  list: vi.fn(),
  listOpen: vi.fn(),
  create: vi.fn(),
  requestJoin: vi.fn(),
  listJoinRequests: vi.fn(),
  decideJoin: vi.fn(),
  updateVisibility: vi.fn(),
}));

vi.mock("@/lib/socialAccessServer", () => ({
  requireVerifiedSocialActor: vi.fn(async () => state.access),
}));

vi.mock("@/lib/socialCrewStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/socialCrewStore")>()),
  createSocialCrewStore: () => store,
}));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => false),
}));

vi.mock("@/lib/supabase", () => ({
  hashActor: (value: string) => `hashed-${value}`,
}));

vi.mock("@/lib/planStore", () => ({
  planStateResult: vi.fn(async () =>
    state.planOk ? { ok: true, plan: state.plan } : { ok: false, error: "error" },
  ),
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: vi.fn(async (id: string) => {
    if (!state.venueIndexReadable) return { status: "unavailable", canonicalId: id };
    return state.venue && state.venue.id === id
      ? {
          status: "found",
          canonicalId: id,
          venue: { id, name: state.venue.name, borough: "Islington", lat: 51.53, lng: -0.1 },
          slimVenue: { id, name: state.venue.name },
        }
      : { status: "unknown", canonicalId: id };
  }),
}));

vi.mock("@/lib/cultureCrawl.server", () => ({
  cultureWaypointPois: () => state.places,
}));

import { POST as createCrew } from "@/app/api/social/crews/route";
import { PATCH as changeCrew } from "@/app/api/social/crews/[crewId]/route";
import {
  GET as listJoinRequests,
  POST as requestJoin,
} from "@/app/api/social/crews/[crewId]/join-requests/route";
import { PATCH as decideJoinRequest } from "@/app/api/social/crews/[crewId]/join-requests/[requestId]/route";

function context<Params extends Record<string, string>>(
  params: Params,
): { params: Promise<Params> } {
  return { params: Promise.resolve(params) };
}

function mutationRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${HOST_CAPABILITY}`,
      "idempotency-key": IDEMPOTENCY_KEY,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.access = { ok: true, actor };
  state.plan = structuredClone(planState);
  state.planOk = true;
  state.venueIndexReadable = true;
  state.venue = { id: "venue-angel-islington", name: "The Angel" };
  state.places = [
    {
      id: "tube-kings-cross-st-pancras",
      name: "King's Cross",
      coordinates: [-0.124, 51.5308],
    },
  ];
  store.create.mockResolvedValue({
    code: "created",
    replayed: false,
    crewId: CREW_ID,
    memberId: ALICE_MEMBER_ID,
  });
  store.requestJoin.mockResolvedValue({
    code: "requested",
    replayed: false,
    requestId: REQUEST_ID,
  });
  store.listJoinRequests.mockResolvedValue({
    items: [
      {
        requestId: REQUEST_ID,
        requesterHandle: "bob",
      },
    ],
    hasMore: false,
  });
  store.decideJoin.mockResolvedValue({
    code: "accepted",
    replayed: false,
    memberId: ALICE_MEMBER_ID,
  });
  store.updateVisibility.mockResolvedValue({
    code: "updated",
    replayed: false,
    authorityRevision: 2,
  });
  store.read.mockResolvedValue({
    kind: "member",
    crewId: CREW_ID,
    title: "Open Friday",
    visibility: "open",
    phase: "planning",
    nightArea: null,
    startsAt: "2026-08-21T18:30:00.000Z",
    authorityRevision: 1,
    viewer: { memberId: ALICE_MEMBER_ID, role: "owner" },
    owner: { memberId: ALICE_MEMBER_ID, handle: "alice" },
    members: [],
    plan: planState,
  });
});

describe("open crew create", () => {
  it("creates an open crew when Stop 1 is a listed venue", async () => {
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ planId: PLAN_ID, visibility: "open" }),
    );
  });

  it("creates an open crew when Stop 1 is a named public place", async () => {
    state.plan = {
      ...planState,
      stops: [
        {
          venueId: "place:tube-kings-cross-st-pancras",
          venueName: "King's Cross",
          position: 0,
        },
      ],
    };
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalled();
  });

  it("refuses free-text Stop 1 with the house line", async () => {
    state.plan = {
      ...planState,
      stops: [
        { venueId: "by the canal near the bridge", venueName: "Somewhere", position: 0 },
      ],
    };
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: OPEN_PLAN_PLACE_REFUSED_LINE,
    });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("refuses a place Stop 1 the POI layer does not hold", async () => {
    state.plan = {
      ...planState,
      stops: [
        { venueId: "place:not-a-real-poi", venueName: "Nowhere", position: 0 },
      ],
    };
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    expect(response.status).toBe(422);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("says unavailable rather than refused when the venue index cannot be read", async () => {
    state.venueIndexReadable = false;
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    // A listed pub the index could not answer for is not an unlisted pub.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.not.toMatchObject({
      error: OPEN_PLAN_PLACE_REFUSED_LINE,
    });
    expect(store.create).not.toHaveBeenCalled();
  });

  it("refuses an under-18 actor before an open create", async () => {
    state.access = {
      ok: false,
      status: 403,
      code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
      error: "Adult verification is needed for Social.",
    };
    const response = await createCrew(
      mutationRequest("http://localhost/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "open",
      }),
    );
    expect(response.status).toBe(403);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("open crew join, decide, and close", () => {
  it("lists pending requests for a verified host authority", async () => {
    const response = await listJoinRequests(
      new Request(
        `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
      ),
      context({ crewId: CREW_ID }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      items: [
        expect.objectContaining({
          requestId: REQUEST_ID,
          requesterHandle: "bob",
        }),
      ],
      hasMore: false,
    });
    expect(store.listJoinRequests).toHaveBeenCalledWith(CREW_ID, actor);
  });

  it("refuses a malformed queue crew id before the store read", async () => {
    const response = await listJoinRequests(
      new Request("http://localhost/api/social/crews/not-a-crew/join-requests"),
      context({ crewId: "not-a-crew" }),
    );

    expect(response.status).toBe(404);
    expect(store.listJoinRequests).not.toHaveBeenCalled();
  });

  it("keeps queue reads behind verified adult Social access", async () => {
    state.access = {
      ok: false,
      status: 403,
      code: "SOCIAL_ADULT_VERIFICATION_REQUIRED",
      error: "Adult verification is needed for Social.",
    };
    const response = await listJoinRequests(
      new Request(
        `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
      ),
      context({ crewId: CREW_ID }),
    );

    expect(response.status).toBe(403);
    expect(store.listJoinRequests).not.toHaveBeenCalled();
  });

  it("marks a failed private queue read as retryable", async () => {
    store.listJoinRequests.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await listJoinRequests(
      new Request(
        `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
      ),
      context({ crewId: CREW_ID }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
  });

  it("requests a join on an open crew", async () => {
    const response = await requestJoin(
      mutationRequest(
        `http://localhost/api/social/crews/${CREW_ID}/join-requests`,
        "POST",
        {},
      ),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(201);
    expect(store.requestJoin).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ crewId: CREW_ID, action: "request" }),
    );
  });

  it("lets the host decide a join request", async () => {
    const response = await decideJoinRequest(
      mutationRequest(
        `http://localhost/api/social/crews/${CREW_ID}/join-requests/${REQUEST_ID}`,
        "PATCH",
        { decision: "accept" },
      ),
      context({ crewId: CREW_ID, requestId: REQUEST_ID }),
    );
    expect(response.status).toBe(200);
    expect(store.decideJoin).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        crewId: CREW_ID,
        requestId: REQUEST_ID,
        decision: "accept",
      }),
    );
  });

  it("lets the host close an open crew back to private", async () => {
    const response = await changeCrew(
      mutationRequest(`http://localhost/api/social/crews/${CREW_ID}`, "PATCH", {
        visibility: "private",
        expectedAuthorityRevision: 1,
      }),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(200);
    expect(store.updateVisibility).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ crewId: CREW_ID, visibility: "private" }),
    );
  });
});
