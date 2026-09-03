export const AUTH_BROWSER_FETCH_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

function requestSignal(input: Parameters<FetchLike>[0]): AbortSignal | null {
  return typeof Request !== "undefined" && input instanceof Request ? input.signal : null;
}

/**
 * Bound Supabase browser requests by aborting the underlying fetch itself.
 * The returned promise settles only after that fetch observes the abort, so an
 * auth coordination lease can remain held until attempt cleanup is done.
 */
export function withAuthFetchTimeout(
  fetchImpl: FetchLike,
  timeoutMs = AUTH_BROWSER_FETCH_TIMEOUT_MS,
): FetchLike {
  return async (input, init) => {
    const controller = new AbortController();
    const signals = [...new Set(
      [requestSignal(input), init?.signal ?? null].filter(
        (signal): signal is AbortSignal => signal !== null,
      ),
    )];
    const abortFrom = (signal: AbortSignal) => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    const listeners = signals.map((signal) => {
      const listener = () => abortFrom(signal);
      if (signal.aborted) abortFrom(signal);
      else signal.addEventListener("abort", listener, { once: true });
      return { signal, listener };
    });
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException("Supabase browser request timed out.", "TimeoutError"));
      }
    }, timeoutMs);

    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  };
}
