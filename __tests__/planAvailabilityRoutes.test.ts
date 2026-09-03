import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const seams = vi.hoisted(() => ({
  state: vi.fn(),
  completion: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => undefined }));
vi.mock("@/lib/planStore", () => ({
  planStateResult: seams.state,
  planCompletionResult: seams.completion,
  planStore: () => ({ update: seams.update }),
}));

import { GET as GET_PLAN, PATCH } from "@/app/api/plans/[id]/route";
import { GET as GET_COMPLETION } from "@/app/api/plans/[id]/complete/route";

const ID = "6ab5ca40-836b-4970-9477-d1779fdd31ab";
const context = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  seams.state.mockReset();
  seams.completion.mockReset();
  seams.update.mockReset();
});

describe("configured Plan availability errors", () => {
  it("keeps a Plan read outage distinct from a missing public Plan", async () => {
    seams.state.mockResolvedValue({ ok: false, error: "error" });
    const response = await GET_PLAN(new Request(`http://localhost/api/plans/${ID}`), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Plan data is temporarily unavailable.", code: "PLAN_STORE_UNAVAILABLE", retryable: true });
  });

  it("returns a stable retryable error for completion preflight outages", async () => {
    seams.state.mockResolvedValue({ ok: false, error: "error" });
    seams.completion.mockResolvedValue({ ok: false, error: "error" });
    const response = await GET_COMPLETION(new Request(`http://localhost/api/plans/${ID}/complete`), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PLAN_COMPLETION_UNAVAILABLE", retryable: true });
  });

  it("does not collapse a configured update failure into a 400", async () => {
    seams.update.mockResolvedValue({ ok: false, error: "error" });
    const response = await PATCH(new Request(`http://localhost/api/plans/${ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: "Bearer member" },
      body: JSON.stringify({ status: "ready" }),
    }), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PLAN_UPDATE_UNAVAILABLE", retryable: true });
  });
});
