import "server-only";

import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { SocialPostDTO } from "@/lib/socialPosts";

export type SocialVenueResolution =
  | { ok: true; venueId: string; venueName: string }
  | { ok: false; unavailable: boolean };

export async function resolveSocialVenueId(
  requestedVenueId: string,
): Promise<SocialVenueResolution> {
  const lookup = await lookupCanonicalVenue(requestedVenueId);
  if (lookup.status === "unavailable") return { ok: false, unavailable: true };
  if (lookup.status !== "found" || !isPubVenueKind(lookup.venue.kind)) {
    return { ok: false, unavailable: false };
  }
  return { ok: true, venueId: lookup.canonicalId, venueName: lookup.venue.name };
}

export async function projectSocialVenueName(
  post: SocialPostDTO,
  known?: { venueId: string; venueName: string } | null,
): Promise<SocialPostDTO> {
  if (!post.venueProjected || !post.venueId) return { ...post, venueName: null };
  if (known?.venueId === post.venueId) return { ...post, venueName: known.venueName };
  const resolved = await resolveSocialVenueId(post.venueId);
  return { ...post, venueName: resolved.ok ? resolved.venueName : null };
}

export async function projectSocialVenueNames(posts: SocialPostDTO[]): Promise<SocialPostDTO[]> {
  return Promise.all(posts.map((post) => projectSocialVenueName(post)));
}
