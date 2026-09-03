import { describe, expect, it } from "vitest";

import {
  assertE2ELoginSafe,
  isE2ELoginEnabled,
} from "@/lib/e2eReviewAuth";

describe("E2E login safety policy", () => {
  it("enables only for the exact opt-in value", () => {
    expect(isE2ELoginEnabled({ PUBMAX_E2E_LOGIN: "1" })).toBe(true);
    expect(isE2ELoginEnabled({ PUBMAX_E2E_LOGIN: "0" })).toBe(false);
    expect(isE2ELoginEnabled({ PUBMAX_E2E_LOGIN: "true" })).toBe(false);
    expect(isE2ELoginEnabled({})).toBe(false);
  });

  it("rejects the flag on a deployed production process", () => {
    expect(() =>
      assertE2ELoginSafe({
        PUBMAX_E2E_LOGIN: "1",
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).toThrow(/PUBMAX_E2E_LOGIN.*production/i);
  });

  it("rejects production-style processes without an explicit local marker", () => {
    expect(() =>
      assertE2ELoginSafe({
        PUBMAX_E2E_LOGIN: "1",
        NODE_ENV: "production",
      }),
    ).toThrow(/VERCEL_ENV=development/i);
  });

  it("allows a local production-style process with the explicit marker", () => {
    expect(() =>
      assertE2ELoginSafe({
        PUBMAX_E2E_LOGIN: "1",
        NODE_ENV: "production",
        VERCEL_ENV: "development",
      }),
    ).not.toThrow();
  });

  it("does not inspect production state when the flag is off", () => {
    expect(() =>
      assertE2ELoginSafe({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).not.toThrow();
  });
});
