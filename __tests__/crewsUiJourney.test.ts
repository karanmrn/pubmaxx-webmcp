// The crew journey the UI walks, driven through the real route handlers with a
// stubbed store: list, create, invite, accept, leave. Each step asserts the
// exact request the surface sends, because the panel cannot invent a body the
// route will take - every crew write is exact-keys checked and idempotency
// keyed, so a shape drift is a 422 the reader sees as "that did not go through".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SocialCrewListPageDTO } from "@/lib/socialCrew";
import type { SocialPostActor } from "@/lib/socialPostStore";

const ALICE_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const ALICE_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const ALICE_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const BOB_PROFILE_ID = "20000000-0000-4000-8000-000000000002";
const BOB_MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";
const INVITATION_ID = "70000000-0000-4000-8000-000000000001";

const actor: SocialPostActor = {
  accountId: ALICE_ACCOUNT_ID,
  profileId: ALICE_PROFILE_ID,
  handle: "alice",
};

const page: SocialCrewListPageDTO = {
  items: [
    {
      kind: "member",
      crewId: CREW_ID,
      title: "Friday in Camden",
      phase: "planning",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      viewer: { memberId: ALICE_MEMBER_ID, role: "owner" },
    },
  ],
  nextCursor: null,
};

const state = vi.hoisted(() => ({ access: null as unknown, limited: false }));

const store = vi.hoisted(() => ({
  read: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  invite: vi.fn(),
  acceptInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  requestJoin: vi.fn(),
  decideJoin: vi.fn(),
  setRole: vi.fn(),
  transferOwner: vi.fn(),
  removeMember: vi.fn(),
  leave: vi.fn(),
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
  isLimited: vi.fn(async () => state.limited),
}));

vi.mock("@/lib/supabase", () => ({
  hashActor: (value: string) => `hashed-${value}`,
}));

import { SocialCrewStoreError } from "@/lib/socialCrewStore";
import { GET as listCrews, POST as createCrew } from "@/app/api/social/crews/route";
import { POST as inviteMember } from "@/app/api/social/crews/[crewId]/invitations/route";
import { PATCH as decideInvitation } from "@/app/api/social/crews/[crewId]/invitations/[invitationId]/route";
import { POST as leaveCrew } from "@/app/api/social/crews/[crewId]/leave/route";
import { crewIdempotencyKey } from "@/lib/socialCrewsUi";

function context<Params extends Record<string, string>>(
  params: Params,
): { params: Promise<Params> } {
  return { params: Promise.resolve(params) };
}

/** The header set the browser sends on every crew write. */
function writeRequest(
  url: string,
  method: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": crewIdempotencyKey("crew-test", () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.access = { ok: true, actor };
  state.limited = false;
});

describe("see your crews", () => {
  it("answers the list the panel reads, and never caches it", async () => {
    store.list.mockResolvedValue(page);
    const response = await listCrews(new Request("https://x.test/api/social/crews"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(page);
    expect(store.list).toHaveBeenCalledWith(actor, {});
  });

  it("passes a cursor and a limit through untouched", async () => {
    store.list.mockResolvedValue({ items: [], nextCursor: null });
    await listCrews(
      new Request("https://x.test/api/social/crews?cursor=abc&limit=5"),
    );
    expect(store.list).toHaveBeenCalledWith(actor, { cursor: "abc", limit: 5 });
  });

  it("refuses a limit outside the store's own window before asking it", async () => {
    for (const limit of ["0", "51", "2.5", "many"]) {
      const response = await listCrews(
        new Request(`https://x.test/api/social/crews?limit=${limit}`),
      );
      expect(response.status).toBe(422);
    }
    expect(store.list).not.toHaveBeenCalled();
  });

  it("shows nothing to a reader Social has not verified", async () => {
    state.access = {
      ok: false,
      error: "Social is invite-only for now.",
      code: "SOCIAL_PREVIEW",
      status: 403,
    };
    const response = await listCrews(new Request("https://x.test/api/social/crews"));
    expect(response.status).toBe(403);
    expect(store.list).not.toHaveBeenCalled();
  });

  it("turns a store outage into a retryable answer, never a blank list", async () => {
    store.list.mockRejectedValue(
      new SocialCrewStoreError("UNAVAILABLE", 503, "nope"),
    );
    const response = await listCrews(new Request("https://x.test/api/social/crews"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
  });
});

describe("start a crew", () => {
  it("takes the plan id and the host capability the plan create just handed back", async () => {
    store.create.mockResolvedValue({
      code: "created",
      replayed: false,
      crewId: CREW_ID,
      memberId: ALICE_MEMBER_ID,
    });
    const response = await createCrew(
      writeRequest(
        "https://x.test/api/social/crews",
        "POST",
        { planId: PLAN_ID, visibility: "private" },
        { authorization: "Bearer plan-host-token" },
      ),
    );
    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        planId: PLAN_ID,
        visibility: "private",
        hostCapability: "plan-host-token",
      }),
    );
  });

  it("refuses without the host capability, so a crew can never outrun its night", async () => {
    const response = await createCrew(
      writeRequest("https://x.test/api/social/crews", "POST", {
        planId: PLAN_ID,
        visibility: "private",
      }),
    );
    expect(response.status).toBe(422);
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("invite a mate", () => {
  it("sends the target's profile id and gets the invitation id the link needs", async () => {
    store.invite.mockResolvedValue({
      code: "invited",
      replayed: false,
      invitationId: INVITATION_ID,
    });
    const response = await inviteMember(
      writeRequest(
        `https://x.test/api/social/crews/${CREW_ID}/invitations`,
        "POST",
        { targetProfileId: BOB_PROFILE_ID },
      ),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      invitationId: INVITATION_ID,
    });
  });

  it("reads a non-mutual target as not found, which is what the picker must say", async () => {
    store.invite.mockRejectedValue(
      new SocialCrewStoreError("NOT_FOUND", 404, "nope"),
    );
    const response = await inviteMember(
      writeRequest(
        `https://x.test/api/social/crews/${CREW_ID}/invitations`,
        "POST",
        { targetProfileId: BOB_PROFILE_ID },
      ),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(404);
  });
});

describe("accept or decline an invitation", () => {
  it("accepts with the id the link carried", async () => {
    store.acceptInvitation.mockResolvedValue({
      code: "accepted",
      replayed: false,
      memberId: BOB_MEMBER_ID,
    });
    const response = await decideInvitation(
      writeRequest(
        `https://x.test/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
        "PATCH",
        { action: "accept" },
      ),
      context({ crewId: CREW_ID, invitationId: INVITATION_ID }),
    );
    expect(response.status).toBe(200);
    expect(store.acceptInvitation).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ action: "accept", invitationId: INVITATION_ID }),
    );
  });

  it("declines through the same route, so one control drives both answers", async () => {
    store.acceptInvitation.mockResolvedValue({ code: "declined", replayed: false });
    const response = await decideInvitation(
      writeRequest(
        `https://x.test/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
        "PATCH",
        { action: "decline" },
      ),
      context({ crewId: CREW_ID, invitationId: INVITATION_ID }),
    );
    expect(response.status).toBe(200);
  });

  it("refuses any third answer", async () => {
    const response = await decideInvitation(
      writeRequest(
        `https://x.test/api/social/crews/${CREW_ID}/invitations/${INVITATION_ID}`,
        "PATCH",
        { action: "maybe" },
      ),
      context({ crewId: CREW_ID, invitationId: INVITATION_ID }),
    );
    expect(response.status).toBe(422);
    expect(store.acceptInvitation).not.toHaveBeenCalled();
  });
});

describe("leave", () => {
  it("sends an empty body, which is the only body the route accepts", async () => {
    store.leave.mockResolvedValue({
      code: "left",
      replayed: false,
      memberId: BOB_MEMBER_ID,
    });
    const response = await leaveCrew(
      writeRequest(`https://x.test/api/social/crews/${CREW_ID}/leave`, "POST", {}),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(200);
    expect(store.leave).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ crewId: CREW_ID }),
    );
  });

  it("reads a host's refusal as a conflict, matching the copy that hides the control", async () => {
    store.leave.mockRejectedValue(
      new SocialCrewStoreError("CONFLICT", 409, "owner cannot leave"),
    );
    const response = await leaveCrew(
      writeRequest(`https://x.test/api/social/crews/${CREW_ID}/leave`, "POST", {}),
      context({ crewId: CREW_ID }),
    );
    expect(response.status).toBe(409);
  });
});
