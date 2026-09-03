import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  accountBoundFetch,
  captureAccountAuth,
} from "@/lib/accountBoundFetch";

function session(userId: string, accessToken: string): Session {
  return {
    access_token: accessToken,
    user: { id: userId },
  } as Session;
}

describe("account-bound fetch", () => {
  it("captures one account token and rejects mismatched identity", () => {
    const current = session("user-a", "token-a");

    expect(captureAccountAuth("user-a", current)).toEqual({
      userId: "user-a",
      accessToken: "token-a",
    });
    expect(captureAccountAuth("user-b", current)).toBeNull();
    expect(captureAccountAuth("user-a", null)).toBeNull();
  });

  it("uses the captured token even after the live session changes", async () => {
    const current = session("user-a", "token-a");
    const auth = captureAccountAuth("user-a", current);
    current.access_token = "token-b";
    current.user.id = "user-b";
    const request = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("ok");
      },
    );

    await accountBoundFetch(
      auth,
      "/api/identity/onboarding",
      {
        method: "PATCH",
        headers: { authorization: "Bearer wrong-token" },
      },
      request,
    );

    const init = request.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer token-a",
    );
  });

  it("does not send a request without a matching account snapshot", async () => {
    const request = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("ok");
      },
    );

    await expect(
      accountBoundFetch(null, "/api/identity/onboarding", {}, request),
    ).rejects.toThrow("Authenticated account changed.");
    expect(request).not.toHaveBeenCalled();
  });
});
