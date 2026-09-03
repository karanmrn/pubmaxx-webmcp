// Per-route latency / error-budget instrumentation (P2, resilience audit §4).
//
// A lightweight higher-order wrapper around an API route handler that emits ONE
// structured line per request via the shared logger (`lib/log.ts`) — the same
// grep-able JSON envelope Vercel captures as runtime-log evidence. Per ADR 0007,
// Vercel is the runtime-log / latency authority; this adds NO new vendor and NO
// new dependency — it just makes the existing stdout drain queryable per route
// (route, method, status, durationMs) and flags the error budget (level warn on
// 4xx/429, error on 5xx or a thrown handler).
//
// Privacy (ADR 0007 + consent posture unchanged): the `route` field is a STATIC
// tag chosen by the caller — never the request URL — so query strings, ids, and
// coordinates never reach the log. No IP, handle, body, or header is read.

import { log } from "@/lib/log";

/** A Next.js App-Router route handler: (request, ctx?) => Promise<Response>. */
// Generic over the handler's trailing parameters so Next's generated
// route-type validation still sees the exact original signature (the App
// Router passes a `{ params: Promise<...> }` context object as the second
// argument — erasing it to `never[]` fails the RouteHandlerConfig check).
type RouteHandler<Rest extends unknown[]> = (
  request: Request,
  ...rest: Rest
) => Promise<Response>;

/** Pick the log level from an HTTP status: 5xx → error, 4xx → warn, else info. */
function levelForStatus(status: number): "info" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

/**
 * Wrap a route handler so every invocation emits `http.request` with timing and
 * outcome. The returned function has the SAME signature and returns the handler's
 * Response untouched (headers, status, body all preserved) — it is a pure
 * observation seam, never a behaviour change. A handler that throws is logged as
 * an error and the error is re-raised so the framework's own error path is
 * unaffected.
 *
 * @param route   stable static tag, e.g. "citymcp/status" (NEVER the URL).
 * @param handler the underlying `(request) => Promise<Response>` handler.
 */
export function withRouteTiming<Rest extends unknown[]>(
  route: string,
  handler: RouteHandler<Rest>,
): RouteHandler<Rest> {
  return async (request: Request, ...rest: Rest): Promise<Response> => {
    const start = Date.now();
    const method = request.method ?? "GET";
    try {
      const response = await handler(request, ...rest);
      const durationMs = Date.now() - start;
      log(levelForStatus(response.status), "http.request", {
        route,
        method,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (err) {
      const durationMs = Date.now() - start;
      log("error", "http.request", {
        route,
        method,
        status: 500,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
