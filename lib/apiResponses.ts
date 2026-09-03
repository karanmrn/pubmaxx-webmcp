const NO_STORE = "no-store";

export function jsonNoStore(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", NO_STORE);
  }
  return Response.json(body, { ...init, headers });
}

/**
 * JSON response for reads that are derived from SHIPPED / STATIC bundled data
 * (not per-user, not live) and are therefore safe to hold at the CDN edge for a
 * short window. Use ONLY when the body is a pure function of the request URL and
 * the deployment — never for anything that reads mutable per-request state.
 *
 * Vercel purges the edge on every deploy, so `s-maxage` can be generous without
 * risking a stale response surviving a data change; a redeploy busts it. The
 * browser `max-age` stays 0 so returning clients revalidate while the edge still
 * answers instantly, and `stale-while-revalidate` widens the instant-serve
 * window. Defaults match the codebase convention (pint-index CSV, last-train
 * timetable answer): 1h edge, 1d SWR. Query-string variants cache independently
 * because the CDN keys on the full URL.
 */
export function jsonCached(
  body: unknown,
  init: ResponseInit & { sMaxAge?: number; staleWhileRevalidate?: number } = {},
): Response {
  const { sMaxAge = 3600, staleWhileRevalidate = 86400, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    );
  }
  return Response.json(body, { ...rest, headers });
}
