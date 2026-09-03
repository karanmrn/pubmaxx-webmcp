import { describe, expect, it } from "vitest";
import { validatePlanCollaborationChange } from "@/lib/planContinuity";

const planId = "6ab5ca40-836b-4970-9477-d1779fdd31ab";

describe("safe Plan collaboration continuity", () => {
  it("validates a versioned invalidation marker without mutation authority", () => {
    const marker = validatePlanCollaborationChange({ version: 1, planId, kind: "proposal", changedAt: "2026-07-16T20:00:00Z" });
    expect(marker).toMatchObject({ version: 1, planId, kind: "proposal" });
    expect(JSON.stringify(marker)).not.toMatch(/token|constraint|route|location|voice/i);
  });

  it("rejects malformed versions, plan ids, kinds, and timestamps", () => {
    expect(validatePlanCollaborationChange({ version: 2, planId, kind: "proposal", changedAt: "2026-07-16T20:00:00Z" })).toBeNull();
    expect(validatePlanCollaborationChange({ version: 1, planId: "bad", kind: "proposal", changedAt: "2026-07-16T20:00:00Z" })).toBeNull();
    expect(validatePlanCollaborationChange({ version: 1, planId, kind: "mutate", changedAt: "now" })).toBeNull();
  });
});
