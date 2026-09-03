import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CRAWL_ENDINGS,
  PLAN_ACTION_TYPES,
  type PlanState,
} from "@/lib/plan";
import {
  projectSocialCrewListPage,
  projectSocialCrewRead,
  type RawSocialCrew,
  type RawSocialCrewListPage,
  type SocialCrewProjectionViewer,
} from "@/lib/socialCrewProjection.server";
import type { SocialPostActor } from "@/lib/socialPostStore";

const OWNER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_PROFILE_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_MEMBER_ID = "30000000-0000-4000-8000-000000000001";
const OWNER_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000001";
const MEMBER_ACCOUNT_ID = "10000000-0000-4000-8000-000000000002";
const MEMBER_PROFILE_ID = "20000000-0000-4000-8000-000000000002";
const MEMBER_ID = "30000000-0000-4000-8000-000000000002";
const MEMBER_PLAN_MEMBER_ID = "40000000-0000-4000-8000-000000000002";
const CREW_ID = "50000000-0000-4000-8000-000000000001";
const SECOND_CREW_ID = "50000000-0000-4000-8000-000000000002";
const PLAN_ID = "60000000-0000-4000-8000-000000000001";

const memberActor: SocialPostActor = {
  accountId: MEMBER_ACCOUNT_ID,
  profileId: MEMBER_PROFILE_ID,
  handle: "stale-handle",
};

function rawCrew(overrides: Partial<RawSocialCrew> = {}): RawSocialCrew {
  return {
    crewId: CREW_ID,
    planId: PLAN_ID,
    ownerAccountId: OWNER_ACCOUNT_ID,
    ownerProfileId: OWNER_PROFILE_ID,
    visibility: "friends",
    authorityRevision: 11,
    joinRequestState: "none",
    members: [
      {
        memberId: OWNER_MEMBER_ID,
        accountId: OWNER_ACCOUNT_ID,
        profileId: OWNER_PROFILE_ID,
        planMemberId: OWNER_PLAN_MEMBER_ID,
        handle: "owner-current",
        role: "owner",
        state: "active",
        joinedAt: "2026-08-05T13:00:00+01:00",
        poisonMemberSecret: "must-not-escape",
      },
      {
        memberId: MEMBER_ID,
        accountId: MEMBER_ACCOUNT_ID,
        profileId: MEMBER_PROFILE_ID,
        planMemberId: MEMBER_PLAN_MEMBER_ID,
        handle: "member-current",
        role: "cohost",
        state: "active",
        joinedAt: "2026-08-05T13:05:00+01:00",
        poisonMemberSecret: "must-not-escape",
      },
    ],
    poisonCrewSecret: "must-not-escape",
    ...overrides,
  } as RawSocialCrew;
}

function planState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: PLAN_ID,
      title: "Friday in Camden",
      startTime: "2026-08-07T19:30:00+01:00",
      createdAt: "2026-08-05T13:00:00+01:00",
      routeRevision: "7",
      status: "ending",
      anchorVenueId: "venue-anchor",
      anchorSource: "tonight",
      outcome: "route",
      routeReadyAt: "2026-08-05T14:00:00+01:00",
      poisonPlanSecret: "must-not-escape",
    },
    stops: [
      {
        venueId: "venue-a",
        venueName: "The First",
        position: 0,
        exactVenueSecret: "must-not-escape",
      },
      {
        venueId: "venue-b",
        venueName: "The Second",
        position: 1,
      },
    ],
    crew: [
      {
        id: "legacy-plan-member",
        name: "Legacy guest",
        status: "in",
        joinedAt: "2026-08-05T12:00:00.000Z",
        updatedAt: "2026-08-05T12:00:00.000Z",
      },
    ],
    context: {
      nightArea: "camden",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      budget: "standard",
      budgetLimitPence: 6_000,
      zeroProof: true,
      wetherspoonsPreferred: false,
      atmosphere: ["lively"],
      foodNeeds: ["vegan"],
      accessibility: ["step-free"],
      transportConstraints: ["tube"],
      poisonContextSecret: "must-not-escape",
    },
    actions: [
      {
        id: "action-arrived",
        type: "arrived",
        stopPosition: 0,
        ending: null,
        createdAt: "2026-08-07T20:00:00+01:00",
        poisonActionSecret: "must-not-escape",
      },
      {
        id: "action-ending",
        type: "ending",
        stopPosition: null,
        ending: "get_home",
        createdAt: "2026-08-07T23:00:00+01:00",
      },
    ],
    ending: "get_home",
    poisonPlanStateSecret: "must-not-escape",
    ...overrides,
  } as PlanState;
}

function viewer(overrides: Partial<SocialCrewProjectionViewer> = {}): SocialCrewProjectionViewer {
  return {
    actor: memberActor,
    ownerRelationship: "mutual",
    plan: planState(),
    ...overrides,
  };
}

function expectUnavailable(run: () => unknown): void {
  expect(run).toThrow(/unavailable/i);
}

describe("Social Crew detail projection", () => {
  it("uses Plan-owned action and ending vocabularies", () => {
    expect(PLAN_ACTION_TYPES).toEqual(["arrived", "skipped", "swapped", "ending"]);
    expect(CRAWL_ENDINGS).toEqual(["food", "get_home", "keep_going"]);
  });

  it("projects exact current fields, canonical dates, distinct revisions, and no legacy Plan crew", () => {
    const result = projectSocialCrewRead(rawCrew(), viewer());

    expect(result).toEqual({
      kind: "member",
      crewId: CREW_ID,
      title: "Friday in Camden",
      visibility: "friends",
      phase: "live",
      nightArea: "camden",
      startsAt: "2026-08-07T18:30:00.000Z",
      authorityRevision: 11,
      viewer: { memberId: MEMBER_ID, role: "cohost" },
      owner: { memberId: OWNER_MEMBER_ID, handle: "owner-current" },
      members: [
        {
          memberId: OWNER_MEMBER_ID,
          handle: "owner-current",
          role: "owner",
          joinedAt: "2026-08-05T12:00:00.000Z",
        },
        {
          memberId: MEMBER_ID,
          handle: "member-current",
          role: "cohost",
          joinedAt: "2026-08-05T12:05:00.000Z",
        },
      ],
      plan: {
        plan: {
          id: PLAN_ID,
          title: "Friday in Camden",
          startTime: "2026-08-07T18:30:00.000Z",
          createdAt: "2026-08-05T12:00:00.000Z",
          routeRevision: 7,
          status: "ending",
          anchorVenueId: "venue-anchor",
          anchorSource: "tonight",
          outcome: "route",
          routeReadyAt: "2026-08-05T13:00:00.000Z",
        },
        stops: [
          { venueId: "venue-a", venueName: "The First", position: 0 },
          { venueId: "venue-b", venueName: "The Second", position: 1 },
        ],
        context: {
          nightArea: "camden",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "standard",
          budgetLimitPence: 6_000,
          zeroProof: true,
          wetherspoonsPreferred: false,
          atmosphere: ["lively"],
          foodNeeds: ["vegan"],
          accessibility: ["step-free"],
          transportConstraints: ["tube"],
        },
        actions: [
          {
            id: "action-arrived",
            type: "arrived",
            stopPosition: 0,
            ending: null,
            createdAt: "2026-08-07T19:00:00.000Z",
          },
          {
            id: "action-ending",
            type: "ending",
            stopPosition: null,
            ending: "get_home",
            createdAt: "2026-08-07T22:00:00.000Z",
          },
        ],
        ending: "get_home",
      },
    });
    expect(JSON.stringify(result)).not.toContain("poison");
    expect(JSON.stringify(result)).not.toContain("legacy-plan-member");
    expect(JSON.stringify(result)).not.toContain(MEMBER_ACCOUNT_ID);
    expect(JSON.stringify(result)).not.toContain(MEMBER_PROFILE_ID);
    expect(JSON.stringify(result)).not.toContain(MEMBER_PLAN_MEMBER_ID);
  });

  it("keeps nullable Night Area while explicitly copying every context field", () => {
    const plan = planState();
    plan.context = { ...plan.context!, nightArea: null };

    expect(projectSocialCrewRead(rawCrew(), viewer({ plan }))).toMatchObject({
      nightArea: null,
      plan: { context: { nightArea: null } },
    });
  });

  it.each([
    ["draft", "planning"],
    ["ready", "planning"],
    ["active", "live"],
    ["ending", "live"],
    ["completed", "ended"],
    ["abandoned", "ended"],
  ] as const)("maps %s status to %s phase", (status, phase) => {
    const plan = planState();
    plan.plan.status = status;

    expect(projectSocialCrewRead(rawCrew(), viewer({ plan }))).toMatchObject({ phase });
  });

  it("projects a preview through its exact allowlist", () => {
    const raw = rawCrew({
      joinRequestState: "pending",
      members: rawCrew().members.slice(0, 1),
    });
    const plan = planState();
    plan.context = { ...plan.context!, nightArea: null };

    const result = projectSocialCrewRead(raw, viewer({ plan }));

    expect(result).toEqual({
      kind: "preview",
      title: "Friday in Camden",
      phase: "live",
      nightArea: null,
      startsAt: "2026-08-07T18:30:00.000Z",
      joinRequestState: "pending",
    });
    expect(JSON.stringify(result)).not.toContain(CREW_ID);
    expect(JSON.stringify(result)).not.toContain(PLAN_ID);
    expect(JSON.stringify(result)).not.toContain("venue-a");
    expect(JSON.stringify(result)).not.toContain("owner-current");
  });

  it.each([
    ["Plan status", () => {
      const plan = planState();
      plan.plan.status = "paused" as never;
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["Crew UUID", () => projectSocialCrewRead(rawCrew({ crewId: "bad" }), viewer())],
    ["Plan date", () => {
      const plan = planState();
      plan.plan.createdAt = "0";
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["member role", () => {
      const members = structuredClone(rawCrew().members);
      members[1]!.role = "host" as never;
      return projectSocialCrewRead(rawCrew({ members }), viewer());
    }],
    ["membership state", () => {
      const members = structuredClone(rawCrew().members);
      members[1]!.state = "pending" as never;
      return projectSocialCrewRead(rawCrew({ members }), viewer());
    }],
    ["route revision", () => {
      const plan = planState();
      plan.plan.routeRevision = "7.5";
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["Stop", () => {
      const plan = planState();
      plan.stops[0]!.position = -1;
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["action", () => {
      const plan = planState();
      plan.actions![0] = { ...plan.actions![0]!, ending: "food" };
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["ending", () => {
      const plan = planState();
      plan.ending = "taxi" as never;
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
    ["context", () => {
      const plan = planState();
      plan.context = { ...plan.context!, zeroProof: "yes" } as never;
      return projectSocialCrewRead(rawCrew(), viewer({ plan }));
    }],
  ] as const)("fails closed for malformed %s", (_label, run) => {
    expectUnavailable(run);
  });

  it.each([
    ["member ID", "memberId", OWNER_MEMBER_ID],
    ["account binding", "accountId", OWNER_ACCOUNT_ID],
    ["profile binding", "profileId", OWNER_PROFILE_ID],
    ["Plan member binding", "planMemberId", OWNER_PLAN_MEMBER_ID],
  ] as const)("rejects duplicate %s", (_label, field, duplicate) => {
    const members = structuredClone(rawCrew().members);
    members[1] = { ...members[1]!, [field]: duplicate };

    expectUnavailable(() => projectSocialCrewRead(rawCrew({ members }), viewer()));
  });

  it("rejects duplicate Stop positions", () => {
    const plan = planState();
    plan.stops[1]!.position = 0;

    expectUnavailable(() => projectSocialCrewRead(rawCrew(), viewer({ plan })));
  });

  it("rejects an action for a Stop absent from the canonical route", () => {
    const plan = planState();
    plan.actions![0]!.stopPosition = 7;

    expectUnavailable(() => projectSocialCrewRead(rawCrew(), viewer({ plan })));
  });
});

function rawListPage(overrides: Partial<RawSocialCrewListPage> = {}): RawSocialCrewListPage {
  return {
    items: [
      {
        crewId: CREW_ID,
        title: "Friday in Camden",
        status: "active",
        nightArea: "camden",
        startsAt: "2026-08-07T19:30:00+01:00",
        memberId: MEMBER_ID,
        accountId: MEMBER_ACCOUNT_ID,
        profileId: MEMBER_PROFILE_ID,
        role: "cohost",
        state: "active",
        joinedAt: "2026-08-05T13:05:00+01:00",
        poisonListSecret: "must-not-escape",
      },
      {
        crewId: SECOND_CREW_ID,
        title: "Saturday in Soho",
        status: "ready",
        nightArea: null,
        startsAt: "2026-08-08T19:00:00+01:00",
        memberId: "30000000-0000-4000-8000-000000000003",
        accountId: MEMBER_ACCOUNT_ID,
        profileId: MEMBER_PROFILE_ID,
        role: "member",
        state: "active",
        joinedAt: "2026-08-05T12:00:00+01:00",
      },
    ],
    hasMore: true,
    cursorPosition: {
      joinedAt: "2026-08-05T12:00:00+01:00",
      memberId: "30000000-0000-4000-8000-000000000003",
      poisonCursorSecret: "must-not-escape",
    },
    poisonPageSecret: "must-not-escape",
    ...overrides,
  } as RawSocialCrewListPage;
}

describe("Social Crew list projection", () => {
  it("preserves PostgreSQL microseconds when rows share one millisecond", () => {
    const first = rawListPage().items[0]!;
    const second = rawListPage().items[1]!;
    const encodeCursor = vi.fn(() => "microsecond-cursor");
    const result = projectSocialCrewListPage(rawListPage({
      items: [
        {
          ...first,
          memberId: MEMBER_ID,
          joinedAt: "2026-08-05T12:00:00.123456+01:00",
        },
        {
          ...second,
          memberId: "30000000-0000-4000-8000-000000000003",
          joinedAt: "2026-08-05T12:00:00.123123+01:00",
        },
      ],
      cursorPosition: {
        joinedAt: "2026-08-05T12:00:00.123123+01:00",
        memberId: "30000000-0000-4000-8000-000000000003",
      },
    }), memberActor, encodeCursor);

    expect(result.nextCursor).toBe("microsecond-cursor");
    expect(encodeCursor).toHaveBeenCalledWith({
      joinedAt: "2026-08-05T11:00:00.123123Z",
      memberId: "30000000-0000-4000-8000-000000000003",
    });
  });

  it("returns exact narrow items and encodes only the canonical last position", () => {
    const encodeCursor = vi.fn(() => "signed-cursor");

    const result = projectSocialCrewListPage(rawListPage(), memberActor, encodeCursor);

    expect(result).toEqual({
      items: [
        {
          kind: "member",
          crewId: CREW_ID,
          title: "Friday in Camden",
          phase: "live",
          nightArea: "camden",
          startsAt: "2026-08-07T18:30:00.000Z",
          viewer: { memberId: MEMBER_ID, role: "cohost" },
        },
        {
          kind: "member",
          crewId: SECOND_CREW_ID,
          title: "Saturday in Soho",
          phase: "planning",
          nightArea: null,
          startsAt: "2026-08-08T18:00:00.000Z",
          viewer: {
            memberId: "30000000-0000-4000-8000-000000000003",
            role: "member",
          },
        },
      ],
      nextCursor: "signed-cursor",
    });
    expect(encodeCursor).toHaveBeenCalledOnce();
    expect(encodeCursor).toHaveBeenCalledWith({
      joinedAt: "2026-08-05T11:00:00.000000Z",
      memberId: "30000000-0000-4000-8000-000000000003",
    });
    expect(JSON.stringify(result)).not.toContain("poison");
    expect(JSON.stringify(result)).not.toContain(MEMBER_ACCOUNT_ID);
    expect(JSON.stringify(result)).not.toContain(MEMBER_PROFILE_ID);
    expect(result.items[0]).not.toHaveProperty("plan");
    expect(result.items[0]).not.toHaveProperty("joinRequestState");
  });

  it("returns no cursor for a coherent terminal page", () => {
    const encodeCursor = vi.fn(() => "must-not-run");
    const result = projectSocialCrewListPage(rawListPage({
      hasMore: false,
      cursorPosition: null,
    }), memberActor, encodeCursor);

    expect(result.nextCursor).toBeNull();
    expect(encodeCursor).not.toHaveBeenCalled();
  });

  it.each([
    ["non-boolean hasMore", { hasMore: "yes" }],
    ["missing position for hasMore", { cursorPosition: null }],
    ["position on terminal page", { hasMore: false }],
    ["position not equal to last item", {
      cursorPosition: {
        joinedAt: "2026-08-05T13:05:00+01:00",
        memberId: MEMBER_ID,
      },
    }],
    ["inactive membership", {
      items: rawListPage().items.map((item, index) => index === 0
        ? { ...item, state: "left" }
        : item),
    }],
    ["viewer binding mismatch", {
      items: rawListPage().items.map((item, index) => index === 0
        ? { ...item, profileId: OWNER_PROFILE_ID }
        : item),
    }],
    ["unknown phase source", {
      items: rawListPage().items.map((item, index) => index === 0
        ? { ...item, status: "paused" }
        : item),
    }],
    ["invalid member UUID", {
      items: rawListPage().items.map((item, index) => index === 0
        ? { ...item, memberId: "bad" }
        : item),
    }],
  ] as const)("fails closed for %s", (_label, override) => {
    expectUnavailable(() => projectSocialCrewListPage(
      rawListPage(override as Partial<RawSocialCrewListPage>),
      memberActor,
      () => "signed-cursor",
    ));
  });

  it("rejects a blank cursor returned by the injected encoder", () => {
    expectUnavailable(() => projectSocialCrewListPage(
      rawListPage(),
      memberActor,
      () => "",
    ));
  });
});
