import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({
  getAccessToken: vi.fn(async () => "test-jwt-token"),
}));

import { getAccessToken } from "@/lib/authClient";
import {
  AuthActionSessionError,
  authedActionFetch,
  authedActionJson,
  authedFetch,
  publishAuthActionState,
  readFallbackFollowerCountForTest,
  readRetainedActionSignalForTest,
  signedInActionFetch,
} from "@/lib/authedFetch";
import {
  readProviderIdentitySignal,
  setProviderIdentity,
} from "@/lib/authProviderRevision";

function deferredResponseBoundTo(signal: AbortSignal): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener("abort", () => controller.error(signal.reason), {
        once: true,
      });
    },
  }));
}

beforeEach(() => {
  vi.mocked(getAccessToken).mockReset().mockResolvedValue("test-jwt-token");
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  setProviderIdentity("supabase", null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("authedFetch (Wave I2)", () => {
  it("attaches Authorization Bearer when a token is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken");
    expect(getAccessToken).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-jwt-token");
    fetchSpy.mockRestore();
  });

  it("proceeds anonymously when getAccessToken returns null", async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await authedFetch("/api/messages?handle=ken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    fetchSpy.mockRestore();
  });

  it("waits for a token that arrives after the first lookup before sending an action", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("late-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await authedActionFetch("/api/referrals/invite-link", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer late-jwt-token");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("does not let an account A action use account B auth after switch unmounts its owner", async () => {
    let resolveToken!: (token: string | null) => void;
    const token = new Promise<string | null>((resolve) => {
      resolveToken = resolve;
    });
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockReturnValueOnce(token);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const owner = new AbortController();

    const request = authedActionFetch("/api/identity/adult-assertion", {
      method: "POST",
      signal: owner.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();

    setProviderIdentity("supabase", "account-b");
    owner.abort();
    resolveToken("account-b-token");

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("aborts token lookup when the provider changes without a caller abort", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockImplementation(() => new Promise(() => undefined));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const action = authedActionFetch("/api/social/posts", { method: "POST" });
    const rejection = expect(action).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();

    setProviderIdentity("supabase", "account-b");

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("aborts an account A action already in flight when the account changes", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Account-bound fetch signal missing.");
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
    );

    const request = authedActionFetch("/api/social/tags", { method: "POST" });
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer account-a-token");
    setProviderIdentity("supabase", "account-b");

    await rejection;
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(actionSignal?.aborted).toBe(true);
  });

  it("merges a Request signal into the active account-bound fetch", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Account-bound fetch signal missing.");
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
    );
    const owner = new AbortController();
    const input = new Request("https://pubmaxx.example/api/social/posts", {
      signal: owner.signal,
    });
    const reason = new Error("request owner left");

    const action = authedActionFetch(input, { method: "POST" });
    const rejection = action.then(
      () => expect.unreachable("Request abort must reject the active fetch."),
      (error: unknown) => expect(error).toBe(reason),
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    owner.abort(reason);

    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(actionSignal?.aborted).toBe(true);
    expect(actionSignal?.reason).toBe(reason);
    await rejection;
  });

  it("gives an explicit init signal precedence over a Request signal", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const requestOwner = new AbortController();
    const initOwner = new AbortController();
    const requestReason = new Error("stale Request owner left");
    const initReason = new Error("active dialog closed");
    const input = new Request("https://pubmaxx.example/api/social/posts", {
      signal: requestOwner.signal,
    });
    requestOwner.abort(requestReason);

    await authedActionFetch(input, {
      method: "POST",
      signal: initOwner.signal,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(actionSignal?.aborted).toBe(false);
    initOwner.abort(initReason);
    expect(actionSignal?.aborted).toBe(true);
    expect(actionSignal?.reason).toBe(initReason);
  });

  it("keeps caller and provider aborts active without AbortSignal.any", async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });
    try {
      setProviderIdentity("supabase", "account-a");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
      const providerSignal = readProviderIdentitySignal();
      const providerListenerSpy = vi.spyOn(providerSignal, "addEventListener");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_input, init) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Account-bound fetch signal missing.");
          return deferredResponseBoundTo(signal);
        },
      );
      const firstOwner = new AbortController();
      const secondOwner = new AbortController();

      const firstResponse = await authedActionFetch("/api/social/posts/first", {
        signal: firstOwner.signal,
      });
      const secondResponse = await authedActionFetch("/api/social/posts/second", {
        signal: secondOwner.signal,
      });
      const firstBody = firstResponse.text();
      const secondBody = secondResponse.text();
      const firstSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
      const secondSignal = fetchSpy.mock.calls[1]?.[1]?.signal;
      const callerReason = new Error("first owner left");

      firstOwner.abort(callerReason);
      setProviderIdentity("supabase", "account-b");

      expect(firstSignal?.aborted).toBe(true);
      expect(firstSignal?.reason).toBe(callerReason);
      expect(secondSignal?.aborted).toBe(true);
      expect(secondSignal?.reason).toMatchObject({ name: "AbortError" });
      expect(providerListenerSpy.mock.calls.filter(([type]) => type === "abort"))
        .toHaveLength(1);
      await expect(firstBody).rejects.toBe(callerReason);
      await expect(secondBody).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, "any", anyDescriptor);
      } else {
        Reflect.deleteProperty(AbortSignal, "any");
      }
    }
  });

  it("retains the fallback composite through the returned native Response", async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });
    try {
      setProviderIdentity("supabase", "account-a");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
      const owner = new AbortController();
      const source = new Response("ok");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(source);

      const response = await authedActionFetch("/api/social/posts", {
        signal: owner.signal,
      });
      const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;

      expect(response).toBe(source);
      expect(readRetainedActionSignalForTest(response)).toBe(actionSignal);
    } finally {
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, "any", anyDescriptor);
      } else {
        Reflect.deleteProperty(AbortSignal, "any");
      }
    }
  });

  it("removes a fallback dependent from every source after its first abort", async () => {
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });
    try {
      setProviderIdentity("supabase", "account-a");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
      const providerSignal = readProviderIdentitySignal();
      const owner = new AbortController();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

      await authedActionFetch("/api/social/posts", {
        signal: owner.signal,
      });

      expect(readFallbackFollowerCountForTest(providerSignal)).toBe(1);
      expect(readFallbackFollowerCountForTest(owner.signal)).toBe(1);

      owner.abort(new Error("owner left"));

      expect(readFallbackFollowerCountForTest(providerSignal)).toBe(0);
      expect(readFallbackFollowerCountForTest(owner.signal)).toBe(0);
    } finally {
      if (anyDescriptor) {
        Object.defineProperty(AbortSignal, "any", anyDescriptor);
      } else {
        Reflect.deleteProperty(AbortSignal, "any");
      }
    }
  });

  it("preserves a custom init abort reason during token lookup", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockImplementation(() => new Promise(() => undefined));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const owner = new AbortController();
    const reason = new Error("dialog closed");

    const action = authedActionFetch("/api/social/posts", {
      signal: owner.signal,
    });
    const rejection = action.then(
      () => expect.unreachable("Caller abort must reject token lookup."),
      (error: unknown) => expect(error).toBe(reason),
    );
    await Promise.resolve();
    owner.abort(reason);

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps a Request abort active after response headers arrive", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const owner = new AbortController();
    const input = new Request("https://pubmaxx.example/api/social/posts", {
      signal: owner.signal,
    });
    const reason = new Error("request owner left after headers");
    let source!: Response;
    let actionSignal!: AbortSignal;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      actionSignal = init?.signal as AbortSignal;
      source = deferredResponseBoundTo(actionSignal);
      return source;
    });

    const response = await authedActionFetch(input, { method: "POST" });
    const body = response.text();
    owner.abort(reason);

    expect(response).toBe(source);
    expect(actionSignal.aborted).toBe(true);
    expect(actionSignal.reason).toBe(reason);
    await expect(body).rejects.toBe(reason);
  });

  it("keeps an init abort active after response headers arrive", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const owner = new AbortController();
    const reason = new Error("dialog closed after headers");
    let source!: Response;
    let actionSignal!: AbortSignal;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      actionSignal = init?.signal as AbortSignal;
      source = deferredResponseBoundTo(actionSignal);
      return source;
    });

    const response = await authedActionFetch("/api/social/posts", {
      method: "POST",
      signal: owner.signal,
    });
    const body = response.text();
    owner.abort(reason);
    setProviderIdentity("supabase", "account-b");

    expect(response).toBe(source);
    expect(actionSignal.aborted).toBe(true);
    expect(actionSignal.reason).toBe(reason);
    await expect(body).rejects.toBe(reason);
  });

  it("aborts a deferred native response body when the provider changes", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    let source!: Response;
    let actionSignal!: AbortSignal;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      actionSignal = init?.signal as AbortSignal;
      source = deferredResponseBoundTo(actionSignal);
      return source;
    });

    const response = await authedActionFetch("/api/social/posts");
    const body = response.text();
    setProviderIdentity("supabase", "account-b");

    expect(response).toBe(source);
    expect(actionSignal.aborted).toBe(true);
    await expect(body).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects parsed account A JSON after an identity switch without relying on source abort", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValueOnce("account-a-token");
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
        },
      }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const read = authedActionJson<{ owner: string }>("/api/social/posts");
    const rejection = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());

    setProviderIdentity("supabase", "account-b");
    bodyController.enqueue(new TextEncoder().encode('{"owner":"account-a"}'));
    bodyController.close();

    await rejection;
  });

  it("returns the native Response while its provider binding outlives headers", async () => {
    setProviderIdentity("supabase", "account-a");
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const source = new Response(new ReadableStream<Uint8Array>());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(source);

    const response = await authedActionFetch("/api/social/posts");
    const actionSignal = fetchSpy.mock.calls[0]?.[1]?.signal;

    expect(response).toBe(source);
    setProviderIdentity("supabase", "account-b");
    expect(actionSignal?.aborted).toBe(true);
  });

  it("waits for identity resolution before reading a signed-in action token", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: false });
    vi.mocked(getAccessToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("resolved-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    setTimeout(() => {
      publishAuthActionState({ status: "signed-in", identityResolved: true });
    }, 10);

    await authedActionFetch("/api/profiles/ken/avatar", { method: "POST" });

    expect(getAccessToken).toHaveBeenCalledTimes(2);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer resolved-jwt-token");
  });

  it("does not treat an auth-hydrating browser as signed out", async () => {
    publishAuthActionState({ status: "unknown", identityResolved: false });
    vi.mocked(getAccessToken).mockResolvedValue("hydrated-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    setTimeout(() => {
      setProviderIdentity("supabase", "hydrated-account");
      publishAuthActionState({ status: "signed-in", identityResolved: true });
    }, 10);

    await authedActionFetch("/api/messages", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer hydrated-jwt-token");
  });

  it("keeps signed-out action behaviour anonymous", async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await authedActionFetch("/api/referrals/invite-link", { method: "POST" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });

  it("does not send a signed-in-only action while signed out", async () => {
    vi.mocked(getAccessToken).mockResolvedValue("stale-jwt-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await expect(signedInActionFetch("/api/plans/example/session", {
      method: "PATCH",
    })).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("does not send a signed-in-only action after unresolved readiness times out", async () => {
    vi.useFakeTimers();
    publishAuthActionState({ status: "signed-in", identityResolved: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const request = signedInActionFetch("/api/plans/example/session", { method: "PATCH" });
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(request).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("sends a signed-in-only action when identity resolves before timeout", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: false });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    setTimeout(() => publishAuthActionState({ status: "signed-in", identityResolved: true }), 10);

    await signedInActionFetch("/api/plans/example/session", { method: "PATCH" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledOnce();
  });

  it("settles a signed-in-only action immediately while signed out", async () => {
    vi.mocked(getAccessToken).mockImplementation(() => new Promise(() => {}));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await expect(signedInActionFetch("/api/plans/example/session", {
      method: "PATCH",
    })).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("attaches the account bearer to a signed-in-only action", async () => {
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await signedInActionFetch("/api/plans/example/session", { method: "PATCH" });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-jwt-token");
  });

  it("does not send an anonymous request when a signed-in token never arrives", async () => {
    vi.useFakeTimers();
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const request = authedActionFetch("/api/referrals/invite-link", { method: "POST" });
    const rejection = expect(request).rejects.toBeInstanceOf(AuthActionSessionError);
    await vi.advanceTimersByTimeAsync(2_100);

    await rejection;
    await expect(request).rejects.toMatchObject({
      code: "AUTH_SESSION_WAKING",
      message: "Still waking your session - try again.",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bounds a session read that never resolves", async () => {
    vi.useFakeTimers();
    publishAuthActionState({ status: "signed-in", identityResolved: true });
    vi.mocked(getAccessToken).mockImplementation(() => new Promise(() => {}));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    const request = authedActionFetch("/api/profiles/ken/avatar", { method: "POST" });
    const rejection = expect(request).rejects.toBeInstanceOf(AuthActionSessionError);
    await vi.advanceTimersByTimeAsync(2_100);

    await rejection;
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
