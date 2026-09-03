// Physical QR poster arrival (PLG Wave 2). Printed codes point at
// `/?src=poster` (optional utm_* tags). The home route sends that arrival to
// `/near` with the same campaign query kept, so a scan opens nearby prices
// rather than the marketing landing. See docs/growth/POSTER_SPEC.md.

export const POSTER_LANDING_SRC = "poster";

/** Session flag so /near still knows the arrival after a later URL rewrite. */
export const POSTER_LANDING_SESSION_KEY = "pubmax:poster-landing";

const KEPT_QUERY_KEYS = new Set(["src"]);

type SearchParamRecord = Record<string, string | string[] | undefined>;

function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

/** True when the campaign tag is exactly the closed poster source. */
export function isPosterLandingSrc(
  value: string | null | undefined,
): boolean {
  return value === POSTER_LANDING_SRC;
}

/** Keep src=poster and every utm_* tag; drop free-form junk. */
export function shouldKeepPosterLandingParam(key: string): boolean {
  return KEPT_QUERY_KEYS.has(key) || key.startsWith("utm_");
}

function appendKeptParams(
  out: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
): void {
  if (!shouldKeepPosterLandingParam(key)) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.length > 0) out.append(key, item);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0) out.set(key, value);
}

/**
 * Build the /near href for a poster arrival. Always pins src=poster so the
 * orientation line and analytics have a stable query flag even if the inbound
 * record was sparse.
 */
export function posterNearHref(from: SearchParamRecord | URLSearchParams): string {
  const out = new URLSearchParams();
  if (from instanceof URLSearchParams) {
    for (const [key, value] of from.entries()) {
      if (!shouldKeepPosterLandingParam(key)) continue;
      if (value.length > 0) out.append(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(from)) {
      appendKeptParams(out, key, value);
    }
  }
  out.set("src", POSTER_LANDING_SRC);
  const query = out.toString();
  return query ? `/near?${query}` : `/near?src=${POSTER_LANDING_SRC}`;
}

/** One honest orientation line for a poster scan that landed on /near. */
export function posterLandingOrientation(): string {
  return "You scanned a pub poster. Compare listed pint prices near you, cheapest first.";
}

export function readPosterLandingSrc(
  from: SearchParamRecord | URLSearchParams,
): string | null {
  if (from instanceof URLSearchParams) return from.get("src");
  return firstParam(from.src);
}

export function rememberPosterLandingSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(POSTER_LANDING_SESSION_KEY, "1");
  } catch {
    // Private mode / quota: orientation still works from the query flag.
  }
}

export function readPosterLandingSession(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    return sessionStorage.getItem(POSTER_LANDING_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearPosterLandingSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(POSTER_LANDING_SESSION_KEY);
  } catch {
    // Private mode / quota: nothing to clear.
  }
}

/**
 * Query or same-tab session bridge: the drinker arrived from a printed poster.
 * `src=poster` is authoritative; session only covers a same-arrival URL rewrite
 * that drops src before NearPageClient remounts. Organic /near visits clear the
 * session on mount so orientation does not stick for the whole tab.
 */
export function isPosterLandingArrival(
  src: string | null | undefined,
): boolean {
  return isPosterLandingSrc(src) || readPosterLandingSession();
}
