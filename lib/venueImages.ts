const VENUE_IMAGE_BLOCKLIST = new Set(["images.app.goo.gl", "search.app.goo.gl"]);

export function directVenueImageUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (VENUE_IMAGE_BLOCKLIST.has(parsed.hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * URL the CLIENT should render for a scraped/enrichment photo. Scraped photos
 * live on ~150 open-ended pub-website hosts the CSP img-src allowlist can't
 * cover, so they load through the same-origin /api/image-proxy (U4). Empty or
 * blocked inputs return "" exactly like directVenueImageUrl.
 */
export function proxiedVenueImageUrl(url: string): string {
  const direct = directVenueImageUrl(url);
  if (!direct) return "";
  return `/api/image-proxy?src=${encodeURIComponent(direct)}`;
}

// E3′ — one shared source-pick + provenance vocabulary for every place a
// venue photo renders (venue sheet header, feed cards, gallery thumbnails,
// hover cards). "chain" = a scraped/enrichment photo pulled from the pub's
// own website (routed through /api/image-proxy, above). "community" = a
// Pint Drop photo a real visitor uploaded (already a same-origin signed
// Supabase Storage URL — never proxied, never re-hosted through a third
// party). Honesty invariant: a photo with unknown provenance is never shown,
// so this module is the ONLY place a raw URL is allowed to become a render
// URL — every call site goes through here rather than inventing its own
// resolution order.
export type VenueImageProvenance = "chain" | "community";

export type VenueImageSource = {
  url?: string | null;
  provenance: VenueImageProvenance;
};

export type ResolvedVenueImage = {
  url: string;
  provenance: VenueImageProvenance;
};

// A pre-proxied chain URL (see lib/scrapedPubs.server.ts) is only accepted
// when it really is /api/image-proxy with a valid, unblocked ?src — a
// malformed one must fall through to the next candidate, not become a
// guaranteed-broken <img> that suppresses the community fallback.
function validatedProxiedVenueImageUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://venue-image.invalid");
    const src = parsed.searchParams.get("src");
    return parsed.pathname === "/api/image-proxy" && src && directVenueImageUrl(src)
      ? url
      : "";
  } catch {
    return "";
  }
}

/**
 * Picks the first source (in priority order) with a usable URL and resolves
 * it to a render-ready URL for that provenance. Returns null when nothing in
 * `sources` resolves — callers must show the honest gradient/empty fallback,
 * never a photo of unknown origin.
 *
 * `excludeUrls` lets a renderer skip candidates whose resolved URL already
 * failed to load, so a dead chain proxy advances to the next known source
 * (e.g. the community fallback) instead of ending at "No photo yet". See
 * VenueImage's onError path.
 */
export function resolveVenueImage(
  sources: VenueImageSource[],
  excludeUrls?: ReadonlySet<string>,
): ResolvedVenueImage | null {
  for (const source of sources) {
    if (!source.url) continue;
    // Some server-side loaders (e.g. lib/scrapedPubs.server.ts) already ran
    // the chain photo through proxiedVenueImageUrl before handing it to a
    // client component — recognise that pre-resolved shape, validate it, and
    // pass it through rather than trying (and failing) to re-proxy it.
    const resolved =
      source.provenance === "chain"
        ? source.url.startsWith("/api/image-proxy?")
          ? validatedProxiedVenueImageUrl(source.url)
          : proxiedVenueImageUrl(source.url)
        : directVenueImageUrl(source.url);
    if (!resolved || excludeUrls?.has(resolved)) continue;
    return { url: resolved, provenance: source.provenance };
  }
  return null;
}

export const VENUE_IMAGE_PROVENANCE_LABEL: Record<VenueImageProvenance, string> = {
  chain: "Photo: pub website",
  community: "Photo: community",
};
