import { describe, expect, it, vi } from "vitest";

import {
  captureRoundAppendSnapshot,
  captureRoundRequestIdentity,
  roundHandleForIdentity,
  roundJsonRequest,
  runRoundMutationForCurrentOwner,
  runRoundMutationForCurrentUser,
} from "@/lib/roundRequest";

describe("Round request client", () => {
  it("binds every signed-in Round write to the captured bearer token", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token-a",
      );
      return new Response("{}", { status: 200 });
    });

    await roundJsonRequest(
      "/api/rounds/ABC234",
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      { action: "recordSpend" },
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps anonymous diary writes unauthenticated", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return new Response("{}", { status: 200 });
    });

    await roundJsonRequest(
      "/api/rounds/ABC234",
      { kind: "anonymous" },
      { action: "recordSpend" },
      request,
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("refuses to downgrade a stale authenticated session to anonymous", () => {
    expect(
      captureRoundRequestIdentity(null, {
        access_token: "token-a",
        user: { id: "user-a" },
      } as never),
    ).toBeNull();
    expect(
      captureRoundRequestIdentity("user-b", {
        access_token: "token-a",
        user: { id: "user-a" },
      } as never),
    ).toBeNull();
  });

  it("drops mutation failure after the authenticated owner changes", async () => {
    let currentUserId: string | null = "user-a";
    let fail!: (error: Error) => void;
    const response = new Promise<string>((_resolve, reject) => {
      fail = reject;
    });
    const completion = runRoundMutationForCurrentUser(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      () => currentUserId,
      () => response,
    );

    currentUserId = "user-b";
    fail(new Error("account-a failure"));

    expect(await completion).toEqual({ current: false });
  });

  it("does not invoke a Round mutation after the account owner changes", async () => {
    const operation = vi.fn(async () => "mutated");

    const completion = await runRoundMutationForCurrentUser(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      () => "user-b",
      operation,
    );

    expect(completion).toEqual({ current: false });
    expect(operation).not.toHaveBeenCalled();
  });

  it("does not invoke a Round mutation after its identity owner changes", async () => {
    const operation = vi.fn(async () => "mutated");

    const completion = await runRoundMutationForCurrentOwner(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      () => ({
        kind: "account",
        auth: { userId: "user-b", accessToken: "token-b" },
      }),
      operation,
    );

    expect(completion).toEqual({ current: false });
    expect(operation).not.toHaveBeenCalled();
  });

  it("keeps explicit anonymous Round mutations while signed out", async () => {
    const operation = vi.fn(async () => "saved");

    const completion = await runRoundMutationForCurrentUser(
      { kind: "anonymous" },
      () => null,
      operation,
    );

    expect(completion).toEqual({ current: true, value: "saved" });
    expect(operation).toHaveBeenCalledOnce();
  });

  it("keeps completion when one account refreshes its token", async () => {
    const completion = runRoundMutationForCurrentUser(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-old" },
      },
      () => "user-a",
      async () => "saved",
    );

    expect(await completion).toEqual({ current: true, value: "saved" });
  });

  it("resolves account and anonymous Round handles through separate owners", () => {
    const storage = {
      getItem: (key: string) =>
        key === "pubmax_round_anonymous_identity_v1"
          ? JSON.stringify({ owner: "anonymous", handle: "night_owl" })
          : key === "pubmax_handle"
            ? "stale_account"
            : null,
    };

    expect(
      roundHandleForIdentity(
        {
          kind: "account",
          auth: { userId: "user-a", accessToken: "token-a" },
        },
        "alice",
        storage,
      ),
    ).toBe("alice");
    expect(
      roundHandleForIdentity({ kind: "anonymous" }, "stale_account", storage),
    ).toBe("night_owl");
    expect(roundHandleForIdentity(null, "alice", storage)).toBe("");
  });

  it("captures Round code with identity and handle before an async append", () => {
    let activeCode = "ROUNDX";
    const snapshot = captureRoundAppendSnapshot(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      "alice",
      activeCode,
      null,
    );
    activeCode = "ROUNDY";

    expect(snapshot).toEqual({
      identity: {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      handle: "alice",
      code: "ROUNDX",
    });
    expect(snapshot?.code).not.toBe(activeCode);
  });

  it("drops completion using auth owner updated before rerender effects", async () => {
    let currentUserId: string | null = "user-a";
    let finish!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const completion = runRoundMutationForCurrentUser(
      {
        kind: "account",
        auth: { userId: "user-a", accessToken: "token-a" },
      },
      () => currentUserId,
      () => response,
    );

    currentUserId = "user-b";
    finish("account-a response");

    expect(await completion).toEqual({ current: false });
  });
});
