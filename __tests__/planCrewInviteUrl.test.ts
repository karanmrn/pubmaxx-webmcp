import { describe, expect, it } from "vitest";

import {
  isClassicPlanInviteToken,
  planCrewSharePath,
} from "@/lib/planCrewInviteUrl";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const CLASSIC = "a".repeat(32);
const COLLAB = "b".repeat(64);

describe("planCrewSharePath", () => {
  it("attaches classic #invite= so WhatsApp guests can join", () => {
    expect(planCrewSharePath(PLAN_ID, CLASSIC)).toBe(
      `/plan/${PLAN_ID}#invite=${CLASSIC}`,
    );
  });

  it("keeps ?vibe= before the invite hash", () => {
    expect(planCrewSharePath(PLAN_ID, CLASSIC, "cosy")).toBe(
      `/plan/${PLAN_ID}?vibe=cosy#invite=${CLASSIC}`,
    );
  });

  it("refuses to mint a join URL without a classic invite token", () => {
    expect(planCrewSharePath(PLAN_ID, COLLAB)).toBe(`/plan/${PLAN_ID}`);
    expect(planCrewSharePath(PLAN_ID, "")).toBe(`/plan/${PLAN_ID}`);
  });
});

describe("isClassicPlanInviteToken", () => {
  it("accepts 32-hex classic tokens and rejects collaboration tokens", () => {
    expect(isClassicPlanInviteToken(CLASSIC)).toBe(true);
    expect(isClassicPlanInviteToken(CLASSIC.toUpperCase())).toBe(true);
    expect(isClassicPlanInviteToken(COLLAB)).toBe(false);
    expect(isClassicPlanInviteToken(PLAN_ID)).toBe(false);
  });
});
