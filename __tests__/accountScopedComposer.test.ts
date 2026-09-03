import { describe, expect, it } from "vitest";

import * as accountAuth from "@/lib/accountBoundFetch";
import * as composer from "@/components/identity/ContributionGateDialog";

describe("account-scoped contribution composers", () => {
  it("isolates A's draft from B and restores it only for A", () => {
    const readDraft = Reflect.get(composer, "readAccountScopedDraft");
    const writeDraft = Reflect.get(composer, "writeAccountScopedDraft");

    expect(readDraft).toEqual(expect.any(Function));
    expect(writeDraft).toEqual(expect.any(Function));
    if (typeof readDraft !== "function" || typeof writeDraft !== "function") {
      return;
    }

    const empty = () => ({ reason: "" });
    let drafts = {};
    drafts = writeDraft(drafts, "account-a", empty, { reason: "A's draft" });

    expect(readDraft(drafts, "account-b", empty)).toEqual({ reason: "" });
    drafts = writeDraft(drafts, "account-b", empty, { reason: "B's draft" });
    expect(readDraft(drafts, "account-b", empty)).toEqual({
      reason: "B's draft",
    });
    expect(readDraft(drafts, "account-a", empty)).toEqual({
      reason: "A's draft",
    });
  });

  it("closes on client expiry or server rejection until reauthentication", () => {
    const accountComposerAuth = Reflect.get(accountAuth, "accountComposerAuth");

    expect(accountComposerAuth).toEqual(expect.any(Function));
    if (typeof accountComposerAuth !== "function") return;

    const firstSession = {
      access_token: "session-a-1",
      user: { id: "account-a" },
    };
    const rejected = {
      userId: "account-a",
      accessToken: "session-a-1",
    };

    expect(accountComposerAuth("account-a", null, null)).toBeNull();
    expect(
      accountComposerAuth("account-a", firstSession, rejected),
    ).toBeNull();
    expect(
      accountComposerAuth(
        "account-a",
        { ...firstSession, access_token: "session-a-2" },
        rejected,
      ),
    ).toEqual({
      userId: "account-a",
      accessToken: "session-a-2",
    });
  });

});
