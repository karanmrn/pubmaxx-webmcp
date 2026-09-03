import { afterEach, describe, expect, it, vi } from "vitest";

import { withAuthFetchTimeout } from "@/lib/authFetch";

function rejectsWhenAborted(onAbort?: (signal: AbortSignal) => void): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing abort signal");
    return await new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () => {
        onAbort?.(signal);
        reject(signal.reason);
      };
      if (signal.aborted) rejectAbort();
      else signal.addEventListener("abort", rejectAbort, { once: true });
    });
  }) as typeof fetch;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Supabase browser fetch timeout", () => {
  it("aborts and settles the underlying fetch at the timeout", async () => {
    vi.useFakeTimers();
    const observed: { signal?: AbortSignal } = {};
    const timedFetch = withAuthFetchTimeout(
      rejectsWhenAborted((signal) => {
        observed.signal = signal;
      }),
      1_000,
    );

    const result = timedFetch("https://auth.example/token");
    const rejected = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1_000);

    await rejected;
    expect(observed.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates an init signal and cleans its listener and timeout", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const timedFetch = withAuthFetchTimeout(rejectsWhenAborted(), 1_000);
    const reason = new DOMException("caller stopped", "AbortError");

    const result = timedFetch("https://auth.example/token", { signal: caller.signal });
    caller.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a Request signal even when init has no signal", async () => {
    const caller = new AbortController();
    const timedFetch = withAuthFetchTimeout(rejectsWhenAborted(), 1_000);
    const request = new Request("https://auth.example/token", { signal: caller.signal });
    const reason = new DOMException("request stopped", "AbortError");

    const result = timedFetch(request);
    caller.abort(reason);

    await expect(result).rejects.toBe(reason);
  });
});
