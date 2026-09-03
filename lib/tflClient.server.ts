import "server-only";

// Shared server-side client for TfL Unified API reads.
//
// Both Last Pint and nearby buses use this one guarded path so host validation,
// optional key handling, timeouts, retries, and fair-use identification cannot
// drift between transport surfaces.

const TFL_HOST = "api.tfl.gov.uk";
const TFL_BASE = `https://${TFL_HOST}`;
const DEFAULT_TIMEOUT_MS = 9000;

type TflGetOptions = {
  retries?: number;
  timeoutMs?: number;
  /** Abort when the owning route's latency budget is spent. */
  signal?: AbortSignal;
};

/**
 * Why a read failed, to the only resolution a caller can act on: whether asking
 * again could ever answer differently. A 4xx is the same answer every time, so
 * a caller budgeting its own attempts must not spend one on it.
 */
export type TflOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; retryable: boolean };

function withKey(url: URL): string {
  const key = process.env.TFL_APP_KEY;
  if (!key) return url.href;
  const keyed = new URL(url.href);
  keyed.searchParams.set("app_key", key);
  return keyed.href;
}

function resolveTflUrl(path: string): URL | null {
  try {
    const url = new URL(path, TFL_BASE);
    if (url.protocol !== "https:" || url.hostname !== TFL_HOST) return null;
    if (url.port && url.port !== "443") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse one TfL JSON response, reporting why a failure failed.
 *
 * Invalid hosts and non-429 4xx answers are settled: asking again gets the same
 * answer. Timeouts, network failures, 429s and 5xx are not. Callers keep
 * ownership of what unavailable means for their product surface.
 */
export async function tflFetch<T>(
  path: string,
  options: TflGetOptions = {},
): Promise<TflOutcome<T>> {
  const { retries = 0, timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal } = options;
  const url = resolveTflUrl(path);
  if (!url) return { ok: false, retryable: false };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) return { ok: false, retryable: true };
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(withKey(url), {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": "PubMaxxing/1.0 (+https://pubmaxxing.com)",
        },
      });
      if (response.ok) return { ok: true, data: (await response.json()) as T };
      if (response.status !== 429 && response.status < 500) {
        return { ok: false, retryable: false };
      }
    } catch {
      // Network and timeout failures retry only when the caller asked for it.
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    }
    if (callerSignal?.aborted) return { ok: false, retryable: true };
  }

  return { ok: false, retryable: true };
}

/**
 * The same read for callers that only need the answer. A failure of any kind
 * reads as null, exactly as it always has.
 */
export async function tflGet<T>(
  path: string,
  options: TflGetOptions = {},
): Promise<T | null> {
  const outcome = await tflFetch<T>(path, options);
  return outcome.ok ? outcome.data : null;
}
