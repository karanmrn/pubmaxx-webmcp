import { describe, expect, it } from "vitest";

import {
  contributionGateReducer,
  type ContributionGateState,
} from "@/components/identity/ContributionGateDialog";

describe("contribution gate account state", () => {
  it("clears mode and errors whenever account owner changes", () => {
    const stale: ContributionGateState = {
      userId: "user-a",
      mode: "sign_in_required",
      error: "Your sign-in expired.",
    };

    expect(
      contributionGateReducer(stale, {
        type: "account_changed",
        userId: "user-b",
      }),
    ).toEqual({
      userId: "user-b",
      mode: null,
      error: null,
    });
  });

  it("ignores a response from the previous account", () => {
    const current: ContributionGateState = {
      userId: "user-b",
      mode: null,
      error: null,
    };

    expect(
      contributionGateReducer(current, {
        type: "show",
        userId: "user-a",
        mode: "onboarding_required",
        error: "Old account error.",
      }),
    ).toBe(current);
  });
});
