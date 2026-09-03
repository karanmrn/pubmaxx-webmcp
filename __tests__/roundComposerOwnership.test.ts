import { describe, expect, it } from "vitest";

import {
  roundComposerOwnerKey,
  roundViewerHandle,
} from "@/app/rounds/[code]/RoundPageClient";
import type { RoundRequestIdentity } from "@/lib/roundRequest";

describe("Round composer ownership", () => {
  it("changes scope when authenticated account owner changes", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).not.toBe(
      roundComposerOwnerKey({ userId: "user-b", accessToken: "token-b" }),
    );
  });

  it("keeps scope across token refresh for one account", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).toBe(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-new" }),
    );
  });

  it("clears authenticated scope on sign-out", () => {
    expect(
      roundComposerOwnerKey({ userId: "user-a", accessToken: "token-a" }),
    ).not.toBe(roundComposerOwnerKey(null));
  });

  it("fails closed while the current account viewer projection is unavailable", () => {
    const accountB: RoundRequestIdentity = {
      kind: "account",
      auth: { userId: "user-b", accessToken: "token-b" },
    };

    expect(
      roundViewerHandle(
        "account-a-handle",
        "account:user-a",
        accountB,
        "account-a-handle",
        "account:user-a",
      ),
    ).toBe("");
    expect(
      roundViewerHandle(
        "account-a-handle",
        "account:user-a",
        accountB,
        "account-a-handle",
        "account:user-a",
      ),
    ).toBe("");
  });

  it("uses only a viewer projection tagged to the current account", () => {
    const accountB: RoundRequestIdentity = {
      kind: "account",
      auth: { userId: "user-b", accessToken: "token-b" },
    };

    expect(
      roundViewerHandle(
        "round-member-b",
        "account:user-b",
        accountB,
        "stored-anonymous-handle",
        "anonymous",
      ),
    ).toBe("round-member-b");
  });

  it("does not restore an account handle after sign-out", () => {
    const signedOut: RoundRequestIdentity = { kind: "anonymous" };

    expect(
      roundViewerHandle(
        undefined,
        null,
        signedOut,
        "former-account-handle",
        "account:user-a",
      ),
    ).toBe("");
    expect(
      roundViewerHandle(
        undefined,
        null,
        signedOut,
        "anonymous-diary-handle",
        "anonymous",
      ),
    ).toBe("anonymous-diary-handle");
  });
});
