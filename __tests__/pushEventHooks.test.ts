import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Event-wiring coverage: the launch hooks must fire the push send WITHOUT
// blocking the HTTP response. We mock the sender at its module boundary so the
// dispatched promise can be made to hang forever — the route must still return
// promptly, proving the fire-and-forget contract. The real fireAndForgetPush
// wrapper is kept (it schedules + swallows), only the send functions are spies.
const { notifyPlanUpdateMock, maybeBroadcastMock, neverResolves } = vi.hoisted(() => ({
  notifyPlanUpdateMock: vi.fn(),
  maybeBroadcastMock: vi.fn(),
  // A promise that never settles — if a route awaited it, the test would hang.
  neverResolves: new Promise<never>(() => {}),
}));

vi.mock("@/lib/pushSender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pushSender")>();
  return {
    ...actual,
    notifyPlanUpdate: notifyPlanUpdateMock,
    maybeBroadcastNightSignalLive: maybeBroadcastMock,
  };
});

// Keep the decision route's collaboration + plan stores off the network: a
// successful decision so the fire-and-forget hook is reached.
const PROPOSAL = {
  id: "prop-1",
  planId: "11111111-1111-4111-8111-111111111111",
  stops: [],
  expectedRouteRevision: 3,
};
vi.mock("@/lib/planCollaborationStore", () => ({
  planCollaborationStore: () => ({
    decideProposal: vi.fn(async () => ({ ok: true, proposal: PROPOSAL })),
  }),
}));
vi.mock("@/lib/planStore", () => ({
  planStore: () => ({ update: vi.fn(async () => ({ ok: true })) }),
}));

import { POST as decisionPOST } from "@/app/api/plans/[id]/proposals/[proposalId]/decision/route";
import { GET as nightSignalsGET } from "@/app/api/night-signals/route";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  notifyPlanUpdateMock.mockReset();
  maybeBroadcastMock.mockReset();
  notifyPlanUpdateMock.mockReturnValue(neverResolves);
  maybeBroadcastMock.mockReturnValue(neverResolves);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plan proposal decision hook", () => {
  it("returns the decision response without blocking on the push send", async () => {
    const res = await decisionPOST(
      new Request(`http://localhost/api/plans/${PLAN_ID}/proposals/prop-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accepted", memberToken: "member-abc" }),
      }),
      { params: Promise.resolve({ id: PLAN_ID, proposalId: "prop-1" }) },
    );
    expect(res.status).toBe(200);
    // The hook fired fire-and-forget, tagged with the decision reason.
    expect(notifyPlanUpdateMock).toHaveBeenCalledTimes(1);
    expect(notifyPlanUpdateMock.mock.calls[0][0]).toMatchObject({
      planId: PLAN_ID,
      reason: "proposal_accepted",
    });
  });

  it("still responds when a proposal is rejected (reason threads through)", async () => {
    const res = await decisionPOST(
      new Request(`http://localhost/api/plans/${PLAN_ID}/proposals/prop-1/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "rejected", memberToken: "member-abc" }),
      }),
      { params: Promise.resolve({ id: PLAN_ID, proposalId: "prop-1" }) },
    );
    expect(res.status).toBe(200);
    expect(notifyPlanUpdateMock.mock.calls[0][0]).toMatchObject({ reason: "proposal_rejected" });
  });
});

describe("night-signals broadcast hook", () => {
  it("returns the signals response without blocking on the broadcast", async () => {
    const res = await nightSignalsGET(new Request("http://localhost/api/night-signals"));
    expect(res.status).toBe(200);
    expect(maybeBroadcastMock).toHaveBeenCalledTimes(1);
    // Deduped by snapshot version — the first arg is the snapshot's generatedAt.
    expect(typeof maybeBroadcastMock.mock.calls[0][0]).toBe("string");
    const body = await res.json();
    expect(body).toHaveProperty("claims");
  });
});
