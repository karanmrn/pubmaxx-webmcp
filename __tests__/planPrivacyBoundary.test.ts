import { describe, expect, it } from "vitest";

import type { PlanState } from "@/lib/plan";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { planMemberIdentityResult } from "@/lib/planStore";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "member-capability-token";

function planState(): PlanState {
  return {
    plan: {
      id: PLAN_ID,
      title: "Private stag route",
      startTime: "2026-07-24T19:00:00.000Z",
      createdAt: "2026-07-24T12:00:00.000Z",
      status: "ready",
    },
    stops: [
      { venueId: "venue-the-dove", venueName: "The Dove", position: 0 },
      { venueId: "venue-the-anchor", venueName: "The Anchor", position: 1 },
    ],
    crew: [{ id: "c1", name: "Dave" }] as PlanState["crew"],
    context: null,
    actions: [],
    ending: null,
  };
}

function request(withCapability: boolean): Request {
  return new Request(`http://localhost/api/plans/${PLAN_ID}`, {
    headers: withCapability ? { authorization: `Bearer ${TOKEN}` } : {},
  });
}

type Identity = Awaited<ReturnType<typeof planMemberIdentityResult>>;
const lookupReturning = (value: Identity): typeof planMemberIdentityResult =>
  (async () => value) as unknown as typeof planMemberIdentityResult;
const identity = (role: "host" | "guest"): Identity =>
  ({ ok: true, identity: { memberId: "c1", role, collaborationAuthorized: role === "host" } }) as Identity;

async function resolve(opts: {
  cap: boolean;
  flag: boolean;
  lookup?: typeof planMemberIdentityResult;
}) {
  return resolvePlanProjection({
    request: request(opts.cap),
    planId: PLAN_ID,
    state: planState(),
    memberRehydrationEnabled: opts.flag,
    identityLookup: opts.lookup,
  });
}

describe("resolvePlanProjection — fails closed to preview", () => {
  it("flag OFF returns preview even with a valid capability", async () => {
    const p = await resolve({ cap: true, flag: false, lookup: lookupReturning(identity("host")) });
    expect(p.visibility).toBe("preview");
  });

  it("flag ON + valid HOST capability returns member state", async () => {
    const p = await resolve({ cap: true, flag: true, lookup: lookupReturning(identity("host")) });
    expect(p.visibility).toBe("member");
    if (p.visibility === "member") expect(p.state.stops).toHaveLength(2);
  });

  it("flag ON + valid GUEST capability returns member state", async () => {
    const p = await resolve({ cap: true, flag: true, lookup: lookupReturning(identity("guest")) });
    expect(p.visibility).toBe("member");
  });

  it("flag ON + no capability returns preview", async () => {
    const p = await resolve({ cap: false, flag: true, lookup: lookupReturning(identity("host")) });
    expect(p.visibility).toBe("preview");
  });

  it("flag ON + missing/expired/revoked/wrong-plan identity returns preview", async () => {
    const p = await resolve({ cap: true, flag: true, lookup: lookupReturning({ ok: true, identity: null } as Identity) });
    expect(p.visibility).toBe("preview");
  });

  it("flag ON + store error returns preview (fail closed)", async () => {
    const p = await resolve({ cap: true, flag: true, lookup: lookupReturning({ ok: false, error: "error" } as Identity) });
    expect(p.visibility).toBe("preview");
  });

  it("flag ON + lookup throws returns preview (fail closed)", async () => {
    const throwing = (async () => { throw new Error("db down"); }) as unknown as typeof planMemberIdentityResult;
    const p = await resolve({ cap: true, flag: true, lookup: throwing });
    expect(p.visibility).toBe("preview");
  });

  it("a preview projection serializes with no venue ids or names", async () => {
    const p = await resolve({ cap: false, flag: true, lookup: lookupReturning(identity("host")) });
    const raw = JSON.stringify(p);
    expect(raw).not.toContain("venue-the-dove");
    expect(raw).not.toContain("The Dove");
    expect(raw).not.toContain("Private stag route");
  });
});
