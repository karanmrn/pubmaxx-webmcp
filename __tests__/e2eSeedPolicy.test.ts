import { describe, expect, it } from "vitest";

import {
  E2E_QA_DISPLAY_NAME,
  E2E_QA_HANDLE,
  assertSeedProfileSafety,
  assertSeedEnvironment,
  buildQaProfileInsert,
} from "@/lib/e2eSeedPolicy";

describe("E2E QA seed policy", () => {
  it("uses one clearly marked handle and display name", () => {
    expect(E2E_QA_HANDLE).toBe("e2e_qa");
    expect(E2E_QA_DISPLAY_NAME).toBe("QA (automated)");
  });

  it("builds a profile insert without a founding-member field", () => {
    expect(buildQaProfileInsert("user-1")).toEqual({
      user_id: "user-1",
      handle: "e2e_qa",
      display_name: "QA (automated)",
    });
    expect("founding_member_number" in buildQaProfileInsert("user-1")).toBe(false);
  });

  it("rejects any founding-member count or QA number change", () => {
    expect(() =>
      assertSeedProfileSafety({
        foundingCountBefore: 12,
        foundingCountAfter: 12,
        profile: { founding_member_number: null },
      }),
    ).not.toThrow();

    expect(() =>
      assertSeedProfileSafety({
        foundingCountBefore: 12,
        foundingCountAfter: 13,
        profile: { founding_member_number: null },
      }),
    ).toThrow(/founding-member count/i);

    expect(() =>
      assertSeedProfileSafety({
        foundingCountBefore: 12,
        foundingCountAfter: 12,
        profile: { founding_member_number: 13 },
      }),
    ).toThrow(/e2e_qa.*founding-member number/i);
  });

  it("requires the flag and blocks remote production targets from CI", () => {
    expect(() => assertSeedEnvironment({}, [])).toThrow(/PUBMAX_E2E_LOGIN=1/i);
    expect(() =>
      assertSeedEnvironment(
        { PUBMAX_E2E_LOGIN: "1", CI: "true" },
        ["https://pubmaxxing.com"],
      ),
    ).toThrow(/production target/i);
    expect(() =>
      assertSeedEnvironment(
        { PUBMAX_E2E_LOGIN: "1", CI: "true" },
        ["https://project.supabase.co"],
      ),
    ).toThrow(/production target/i);
    expect(() =>
      assertSeedEnvironment(
        { PUBMAX_E2E_LOGIN: "1", NODE_ENV: "production", VERCEL_ENV: "development" },
        ["http://127.0.0.1:3000"],
      ),
    ).not.toThrow();
  });
});
