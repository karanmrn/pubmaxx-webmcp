import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const V1_RELEASE_NAME = "20260806035204_0070_v1_release_security.sql";
const PLAN_ID = "67676767-6767-4767-8767-676767676767";
const HOST_MEMBER_ID = "68686868-6868-4868-8868-686868686868";
const HOST_TOKEN = "host-route-token";
const ROUTE = [
  { venueId: "venue-1f5ygjb" },
  { venueId: "venue-xjf3n0" },
  { venueId: "venue-3h52h" },
];

type Session = {
  sqlFile(path: string): void;
  sql(statement: string): { ok: boolean; err: string };
  reloadPostgrestSchema(): Promise<void>;
  stop(): Promise<void>;
  restBaseUrl: string;
  serviceRoleKey: string;
};
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

let session: Session | null = null;
const previousEnv: Record<string, string | undefined> = {};
let handlers: Record<string, Handler> = {};
const nativeFetch = globalThis.fetch;

const context = (values: Record<string, string>) => ({ params: Promise.resolve(values) });

function request(path: string, options: {
  token?: string;
  key?: string;
  body?: Record<string, unknown>;
  method?: string;
} = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.key) headers.set("idempotency-key", options.key);
  return new Request(`http://localhost${path}`, {
    method: options.method ?? "POST",
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
}

beforeAll(async () => {
  // @ts-expect-error Session harness is an executable MJS helper without declarations.
  const { startRlsSession } = await import("../scripts/rls/session-harness.mjs") as {
    startRlsSession(): Promise<Session>;
  };
  session = await startRlsSession();
  for (const name of readdirSync(MIGRATIONS)
    .filter((candidate) => candidate.endsWith(".sql") && candidate > V1_RELEASE_NAME)
    .sort()) {
    session.sqlFile(join(MIGRATIONS, name));
  }
  await session.reloadPostgrestSchema();

  if (!session.restBaseUrl || !session.serviceRoleKey) {
    throw new Error("RLS session did not expose its PostgREST service-role boundary.");
  }
  for (const name of [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PLAN_MEMBER_TOKEN_SALT",
    "PLAN_INVITE_TOKEN_SALT",
    "PLAN_IDEMPOTENCY_SECRET",
    "RATE_LIMIT_SALT",
    "PUBMAX_FRIEND_MEMBER_REHYDRATION_V2",
  ]) previousEnv[name] = process.env[name];
  process.env.SUPABASE_URL = session.restBaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = session.serviceRoleKey;
  process.env.PLAN_MEMBER_TOKEN_SALT = "route-proof-plan-member-salt";
  process.env.PLAN_INVITE_TOKEN_SALT = "route-proof-plan-invite-salt";
  process.env.PLAN_IDEMPOTENCY_SECRET = "route-proof-idempotency-secret-32-bytes";
  process.env.RATE_LIMIT_SALT = "route-proof-rate-limit-secret-32-bytes";
  process.env.PUBMAX_FRIEND_MEMBER_REHYDRATION_V2 = "1";
  globalThis.fetch = (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const rewrittenUrl = rawUrl.replace(`${session!.restBaseUrl}/rest/v1`, session!.restBaseUrl);
    const rewrittenInput = input instanceof Request
      ? new Request(rewrittenUrl, input)
      : rewrittenUrl;
    return nativeFetch(rewrittenInput, init);
  };

  const [
    planRoute,
    inviteRoute,
    inviteMemberRoute,
    joinRoute,
    constraintRoute,
    resolveRoute,
    proposalRoute,
    voteRoute,
    decisionRoute,
    planStore,
  ] = await Promise.all([
    import("@/app/api/plans/[id]/route"),
    import("@/app/api/plans/[id]/invites/route"),
    import("@/app/api/plans/[id]/invites/[inviteId]/route"),
    import("@/app/api/plans/[id]/join/route"),
    import("@/app/api/plans/[id]/constraints/route"),
    import("@/app/api/plans/[id]/constraints/[constraintId]/resolve/route"),
    import("@/app/api/plans/[id]/proposals/route"),
    import("@/app/api/plans/[id]/proposals/[proposalId]/votes/route"),
    import("@/app/api/plans/[id]/proposals/[proposalId]/decision/route"),
    import("@/lib/planStore"),
  ]);
  handlers = {
    readPlan: planRoute.GET as Handler,
    createInvite: inviteRoute.POST as Handler,
    revokeInvite: inviteMemberRoute.DELETE as Handler,
    join: joinRoute.POST as Handler,
    addConstraint: constraintRoute.POST as Handler,
    resolveConstraint: resolveRoute.POST as Handler,
    createProposal: proposalRoute.POST as Handler,
    vote: voteRoute.POST as Handler,
    decide: decisionRoute.POST as Handler,
  };

  const seeded = session.sql(`
    insert into public.plans(id,title,start_time,status,route_revision)
      values('${PLAN_ID}','Route-backed legacy night',now()+interval '4 hours','ready',1);
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ('${PLAN_ID}','venue-1f5ygjb','Venue One',0),
      ('${PLAN_ID}','venue-xjf3n0','Venue Two',1),
      ('${PLAN_ID}','venue-3h52h','Venue Three',2);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
    ) values(
      '${HOST_MEMBER_ID}','${PLAN_ID}','Host','${planStore.hashPlanMemberToken(HOST_TOKEN)}',
      'in',now(),now(),true
    )
  `);
  if (!seeded.ok) throw new Error(`Could not seed legacy route proof: ${seeded.err}`);
}, 120_000);

afterAll(async () => {
  globalThis.fetch = nativeFetch;
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await session?.stop();
}, 30_000);

describe("legacy Plan HTTP routes against production-order migrations", () => {
  it("runs invite, constraint, proposal, vote, and join lifecycles through PostgREST", async () => {
    const planContext = context({ id: PLAN_ID });
    const firstInviteResponse = await handlers.createInvite(
      request(`/api/plans/${PLAN_ID}/invites`, {
        token: HOST_TOKEN,
        key: "route-invite-revoke",
        body: { expiresInMinutes: 30 },
      }),
      planContext,
    );
    expect(firstInviteResponse.status).toBe(201);
    const firstInvite = await firstInviteResponse.json() as { invite: { id: string } };
    const revoked = await handlers.revokeInvite(
      request(`/api/plans/${PLAN_ID}/invites/${firstInvite.invite.id}`, {
        method: "DELETE",
        token: HOST_TOKEN,
        key: "route-invite-revoke-action",
        body: {},
      }),
      context({ id: PLAN_ID, inviteId: firstInvite.invite.id }),
    );
    expect(revoked.status).toBe(200);

    const secondInviteResponse = await handlers.createInvite(
      request(`/api/plans/${PLAN_ID}/invites`, {
        token: HOST_TOKEN,
        key: "route-invite-redeem",
        body: { expiresInMinutes: 30 },
      }),
      planContext,
    );
    expect(secondInviteResponse.status).toBe(201);
    const secondInvite = await secondInviteResponse.json() as { token: string };
    const invitedJoin = await handlers.join(
      request(`/api/plans/${PLAN_ID}/join`, {
        key: "route-invited-join",
        body: { name: "Guest", inviteToken: secondInvite.token },
      }),
      planContext,
    );
    const guest = await invitedJoin.json() as { memberToken: string; collaborationAuthorized: boolean };
    expect(invitedJoin.status, JSON.stringify(guest)).toBe(200);
    expect(guest.collaborationAuthorized).toBe(true);

    const constraintResponse = await handlers.addConstraint(
      request(`/api/plans/${PLAN_ID}/constraints`, {
        token: guest.memberToken,
        key: "route-constraint-create",
        body: { kind: "accessibility", value: "Step-free required", priority: "required" },
      }),
      planContext,
    );
    expect(constraintResponse.status).toBe(201);
    const constraint = await constraintResponse.json() as { constraint: { id: string } };

    const proposalResponse = await handlers.createProposal(
      request(`/api/plans/${PLAN_ID}/proposals`, {
        token: guest.memberToken,
        key: "route-proposal-create",
        body: {
          reason: "Keep every stop step-free",
          expectedRouteRevision: 1,
          stops: ROUTE,
          resolvedConstraintIds: [],
        },
      }),
      planContext,
    );
    expect(proposalResponse.status).toBe(201);
    const proposal = await proposalResponse.json() as { proposal: { id: string } };

    const voted = await handlers.vote(
      request(`/api/plans/${PLAN_ID}/proposals/${proposal.proposal.id}/votes`, {
        token: guest.memberToken,
        key: "route-proposal-vote",
        body: { value: "approve" },
      }),
      context({ id: PLAN_ID, proposalId: proposal.proposal.id }),
    );
    expect(voted.status).toBe(201);

    const resolved = await handlers.resolveConstraint(
      request(`/api/plans/${PLAN_ID}/constraints/${constraint.constraint.id}/resolve`, {
        token: HOST_TOKEN,
        key: "route-constraint-resolve",
        body: {
          evidence: {
            proposalId: proposal.proposal.id,
            routeRevision: 1,
            sources: ROUTE.map((stop) => ({
              venueId: stop.venueId,
              sourceUrl: `https://evidence.example/${stop.venueId}`,
              publisher: "Venue",
              observedAt: new Date().toISOString(),
              note: "Checked",
            })),
          },
        },
      }),
      context({ id: PLAN_ID, constraintId: constraint.constraint.id }),
    );
    expect(resolved.status).toBe(200);

    const decided = await handlers.decide(
      request(`/api/plans/${PLAN_ID}/proposals/${proposal.proposal.id}/decision`, {
        token: HOST_TOKEN,
        key: "route-proposal-decision",
        body: { decision: "rejected" },
      }),
      context({ id: PLAN_ID, proposalId: proposal.proposal.id }),
    );
    expect(decided.status).toBe(200);

    const openJoin = await handlers.join(
      request(`/api/plans/${PLAN_ID}/join`, {
        key: "route-open-join",
        body: { name: "Reader" },
      }),
      planContext,
    );
    expect(openJoin.status).toBe(403);
    await expect(openJoin.json()).resolves.toMatchObject({ code: "PLAN_INVITE_REQUIRED" });

    const browserRead = await handlers.readPlan(
      request(`/api/plans/${PLAN_ID}`, { method: "GET", token: HOST_TOKEN }),
      planContext,
    );
    expect(browserRead.status).toBe(200);
    const browserPlan = await browserRead.json() as {
      plan: { id: string; title: string };
      crew: Array<{ id: string }>;
    };
    expect(browserPlan.plan).toMatchObject({ id: PLAN_ID, title: "Route-backed legacy night" });
    expect(browserPlan.crew).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: HOST_MEMBER_ID }),
    ]));
  });
});
