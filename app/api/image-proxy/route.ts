// Same-origin image proxy for scraped-pub photos (U4).
//
// The venue enrichment data carries photo URLs on ~150 distinct pub-website
// hosts — an open-ended set, so a CSP img-src allowlist can't cover it and
// the browser was blocking the images (silent gradient fallbacks on /pubs and
// the venue sheet). Instead the client loads /api/image-proxy?src=<https url>
// (same-origin, already allowed by img-src 'self') and THIS route fetches the
// remote image server-side under tight rules:
//   - https only; hostname must not be an IP literal / localhost (SSRF guard)
//   - the existing venue-image blocklist applies
//   - redirects followed manually, at most 1 hop, re-validated
//   - response must be an image/* content type, capped at 8 MB
//   - no cookies or credentials are forwarded either way
// Responses are long-cached: scraped photos change on scrape cadence, and the
// URL is the cache key.

import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { allowedVenueImageHosts } from "@/lib/venueImageHosts.server";
import { directVenueImageUrl } from "@/lib/venueImages";

const MAX_BYTES = 8 * 1024 * 1024;
// Per-IP rate limit (cursor bot, round 3): each request costs us an outbound
// fetch + up to 8 MB of buffering, so an unauthenticated hot loop is a cheap
// amplification vector. A page renders at most a couple dozen proxied images,
// so 120/min per IP is generous for humans and a wall for loops. Not paid
// spend → the limiter's default fail-open degradation is fine here.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 1;
const CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

function cacheableImageMiss(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

async function cancelUpstreamBody(response: Response | null): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // The body can already be closed or aborted. Either state releases it.
  }
}

function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  // IPv4 literal (covers 127.x, 10.x, 169.254.x, everything — a public site
  // serving images bare-IP is not a case we need).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 literal.
  if (h.startsWith("[") || h.includes(":")) return true;
  return false;
}

function validate(raw: string): URL | null {
  // Reuse the app's venue-image normaliser + blocklist.
  const cleaned = directVenueImageUrl(raw);
  if (!cleaned) return null;
  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isForbiddenHost(url.hostname)) return null;
  // SSRF hard gate (cursor bot, PR #171): only hosts present in the app's own
  // committed datasets may be fetched — an attacker-supplied hostname (even a
  // public one rebinding to an internal address) is simply not in the set.
  if (!allowedVenueImageHosts().has(url.hostname.toLowerCase())) return null;
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const limiterKey = `image-proxy:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS)) {
    return new Response("Too many image requests, slow down.", { status: 429 });
  }

  const src = new URL(request.url).searchParams.get("src") ?? "";
  const initial = validate(src);
  if (!initial) return new Response("Bad image source.", { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let target: URL = initial;
    let upstream: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      upstream = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*", "user-agent": "pubmaxxing-image-proxy" },
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("location");
        await cancelUpstreamBody(upstream);
        let followed: URL | null = null;
        if (location) {
          try {
            followed = validate(new URL(location, target).toString());
          } catch {
            followed = null;
          }
        }
        if (!followed || hop === MAX_REDIRECTS) {
          return new Response("Image source redirected out of policy.", { status: 502 });
        }
        target = followed;
        continue;
      }
      break;
    }
    if (!upstream) return new Response("Image source unavailable.", { status: 502 });
    if (!upstream.ok) {
      await cancelUpstreamBody(upstream);
      return upstream.status === 404 || upstream.status === 410
        ? cacheableImageMiss()
        : new Response("Image source unavailable.", { status: 502 });
    }
    const type = (upstream.headers.get("content-type") ?? "").toLowerCase();
    // Raster images only. SVG is executable content — served same-origin it
    // would be a stored-XSS vector (cursor bot, PR #171) — so it is refused
    // outright rather than sandboxed.
    if (type.includes("svg")) {
      await cancelUpstreamBody(upstream);
      return new Response("Not an image.", { status: 502 });
    }
    if (!type.startsWith("image/")) {
      await cancelUpstreamBody(upstream);
      return cacheableImageMiss();
    }
    const declared = Number(upstream.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      controller.abort();
      await cancelUpstreamBody(upstream);
      return new Response("Image too large.", { status: 502 });
    }
    // Stream with a hard byte cap (cursor bot, PR #171): a chunked/mislabelled
    // response is aborted the moment it crosses the cap, never fully buffered.
    const reader = upstream.body?.getReader();
    if (!reader) return cacheableImageMiss();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        controller.abort();
        return new Response("Image too large.", { status: 502 });
      }
      chunks.push(value);
    }
    if (received === 0) return cacheableImageMiss();
    const body = new Blob(chunks as BlobPart[]);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": type,
        "cache-control": CACHE_CONTROL,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Image source unavailable.", { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
