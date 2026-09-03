/**
 * Return whether a request plainly came from another site.
 *
 * Sec-Fetch-Site is authoritative when present. Otherwise, a present Origin
 * must match the request origin. Requests carrying neither hint pass because
 * non-browser callers do not carry browser credentials by default.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "cross-site";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}
