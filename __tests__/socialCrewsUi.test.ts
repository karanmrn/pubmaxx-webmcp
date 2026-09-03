// What the Crews surface is allowed to say and send.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CREW_DEFAULT_VISIBILITY,
  CREW_NAME_MAX,
  CREW_PHASE_LABEL,
  CREW_ROLE_LABEL,
  canLeaveCrew,
  canManageCrew,
  cleanCrewName,
  crewIdempotencyKey,
  crewInvitePath,
  crewInviteUrl,
  crewStartsCaption,
  isCrewId,
  isUsableCrewName,
  parseCrewListPage,
  parseCrewMutation,
  parseCrewRead,
  startCrewPlanBody,
} from "@/lib/socialCrewsUi";

const CREW_ID = "50000000-0000-4000-8000-000000000001";
const MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const INVITATION_ID = "70000000-0000-4000-8000-000000000001";

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    kind: "member",
    crewId: CREW_ID,
    title: "Friday in Camden",
    phase: "planning",
    nightArea: "camden",
    startsAt: "2026-08-07T18:30:00.000Z",
    viewer: { memberId: MEMBER_ID, role: "owner" },
    ...overrides,
  };
}

describe("crew name", () => {
  it("caps at 30, the width a phone row can hold beside a date and a role", () => {
    expect(CREW_NAME_MAX).toBe(30);
    expect(cleanCrewName("x".repeat(60))).toHaveLength(30);
  });

  it("collapses whitespace so two names that look alike are alike", () => {
    expect(cleanCrewName("  Friday   in  Soho ")).toBe("Friday in Soho");
    expect(cleanCrewName("   ")).toBe("");
    expect(isUsableCrewName("   ")).toBe(false);
    expect(isUsableCrewName("Soho")).toBe(true);
  });

  it("refuses anything that is not a string", () => {
    expect(cleanCrewName(null)).toBe("");
    expect(cleanCrewName(42)).toBe("");
  });
});

describe("crew write keys", () => {
  it("mints an idempotency key inside the 16 to 128 window every write demands", () => {
    const key = crewIdempotencyKey("crew-create", () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("stays inside the window even when the prefix is junk or enormous", () => {
    const key = crewIdempotencyKey(
      "<<<>>>".repeat(80),
      () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key.startsWith("crew-")).toBe(true);
  });

  it("gives two attempts two keys, so a real retry replays and a new one does not", () => {
    let index = 0;
    const next = () => `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${index++}`;
    expect(crewIdempotencyKey("crew-invite", next)).not.toBe(
      crewIdempotencyKey("crew-invite", next),
    );
  });
});

describe("crew ids", () => {
  it("accepts only the UUID shape every crew route validates", () => {
    expect(isCrewId(CREW_ID)).toBe(true);
    expect(isCrewId("not-a-uuid")).toBe(false);
    expect(isCrewId("")).toBe(false);
    expect(isCrewId(undefined)).toBe(false);
  });
});

describe("crew list parsing", () => {
  it("reads a well-formed page", () => {
    const page = parseCrewListPage({ items: [listRow()], nextCursor: null });
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.title).toBe("Friday in Camden");
  });

  it("refuses the whole page when one row is malformed", () => {
    expect(
      parseCrewListPage({ items: [listRow(), listRow({ phase: "party" })], nextCursor: null }),
    ).toBeNull();
    expect(
      parseCrewListPage({ items: [listRow({ crewId: "nope" })], nextCursor: null }),
    ).toBeNull();
    expect(parseCrewListPage({ items: [listRow()], nextCursor: 7 })).toBeNull();
    expect(parseCrewListPage(null)).toBeNull();
  });
});

describe("crew read parsing", () => {
  it("keeps the preview and the member snapshot apart", () => {
    const preview = parseCrewRead({
      kind: "preview",
      title: "Friday in Camden",
      phase: "planning",
      nightArea: null,
      startsAt: "2026-08-07T18:30:00.000Z",
      joinRequestState: "pending",
    });
    expect(preview?.kind).toBe("preview");

    const member = parseCrewRead({
      kind: "member",
      crewId: CREW_ID,
      title: "Friday in Camden",
      visibility: "friends",
      phase: "planning",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      authorityRevision: 1,
      viewer: { memberId: MEMBER_ID, role: "owner" },
      owner: { memberId: MEMBER_ID, handle: "alice" },
      members: [
        { memberId: MEMBER_ID, handle: "alice", role: "owner", joinedAt: "2026-08-05T12:00:00.000Z" },
      ],
    });
    expect(member?.kind).toBe("member");
  });

  it("refuses an unknown join-request state and an unknown role", () => {
    expect(
      parseCrewRead({
        kind: "preview",
        title: "x",
        phase: "planning",
        nightArea: null,
        startsAt: "2026-08-07T18:30:00.000Z",
        joinRequestState: "maybe",
      }),
    ).toBeNull();
  });
});

describe("crew mutation parsing", () => {
  it("keeps the ids the surface needs and drops anything that is not an id", () => {
    const outcome = parseCrewMutation({
      code: "invited",
      replayed: false,
      invitationId: INVITATION_ID,
      crewId: "not-a-uuid",
    });
    expect(outcome?.invitationId).toBe(INVITATION_ID);
    expect(outcome?.crewId).toBeUndefined();
    expect(parseCrewMutation({ replayed: true })).toBeNull();
  });
});

describe("crew authority", () => {
  it("lets only a host or co-host manage, matching the database rule", () => {
    expect(canManageCrew("owner")).toBe(true);
    expect(canManageCrew("cohost")).toBe(true);
    expect(canManageCrew("member")).toBe(false);
  });

  it("refuses a host the leave control, because the database answers 409", () => {
    expect(canLeaveCrew("owner")).toBe(false);
    expect(canLeaveCrew("cohost")).toBe(true);
    expect(canLeaveCrew("member")).toBe(true);
  });
});

describe("start a crew", () => {
  it("shapes exactly the plan create the route accepts", () => {
    const body = startCrewPlanBody({
      name: "  Friday in Soho  ",
      startTime: "2026-08-07T19:00",
      hostName: "alice",
      venue: { id: "venue-a", name: "The First" },
    });
    expect(body).toMatchObject({
      title: "Friday in Soho",
      creatorName: "alice",
      stops: [{ venueId: "venue-a", venueName: "The First" }],
    });
    expect(typeof body?.startTime).toBe("string");
  });

  it("refuses before the network when any of the three facts is missing", () => {
    const base = {
      name: "Friday",
      startTime: "2026-08-07T19:00",
      hostName: "alice",
      venue: { id: "venue-a", name: "The First" },
    };
    expect(startCrewPlanBody({ ...base, name: "  " })).toBeNull();
    expect(startCrewPlanBody({ ...base, hostName: "" })).toBeNull();
    expect(startCrewPlanBody({ ...base, startTime: "not a time" })).toBeNull();
    expect(startCrewPlanBody({ ...base, venue: { id: "", name: "" } })).toBeNull();
  });

  it("starts invite only, because nobody can read who asked to join", () => {
    expect(CREW_DEFAULT_VISIBILITY).toBe("private");
  });
});

describe("crew invite link", () => {
  it("carries the crew and the invitation, and encodes both", () => {
    expect(crewInvitePath(CREW_ID, INVITATION_ID)).toBe(
      `/social/crews/${CREW_ID}?invitation=${INVITATION_ID}`,
    );
    expect(crewInviteUrl(CREW_ID, INVITATION_ID, "https://pubmaxx.com/")).toBe(
      `https://pubmaxx.com/social/crews/${CREW_ID}?invitation=${INVITATION_ID}`,
    );
  });
});

describe("crew captions", () => {
  it("says started once the night has begun", () => {
    const startsAt = "2026-08-07T18:30:00.000Z";
    expect(crewStartsCaption(startsAt, Date.parse("2026-08-07T12:00:00.000Z"))).toMatch(/^Starts /);
    expect(crewStartsCaption(startsAt, Date.parse("2026-08-07T20:00:00.000Z"))).toMatch(/^Started /);
  });

  it("says nothing rather than printing an invalid date", () => {
    expect(crewStartsCaption("not a date")).toBeNull();
  });
});

describe("crew copy", () => {
  const source = readFileSync(join(process.cwd(), "lib/socialCrewsUi.ts"), "utf8");

  it("gives every phase and role its own word", () => {
    expect(new Set(Object.values(CREW_PHASE_LABEL)).size).toBe(3);
    expect(new Set(Object.values(CREW_ROLE_LABEL)).size).toBe(3);
  });

  it("never promises an invitations inbox", () => {
    const copy = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    expect(copy).not.toMatch(/pending invitations/i);
    expect(copy).not.toMatch(/invitation inbox/i);
    expect(copy).not.toMatch(/requests waiting/i);
  });

  it("keeps the em dash out, like every other copy owner", () => {
    expect(source).not.toContain("—");
  });
});
