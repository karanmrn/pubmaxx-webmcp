import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { getVenueIndex } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { isLimited } from "@/lib/pintDrops";
import { hashActor } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers });
  const limitKey = `social-venue-search:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, 60, 60_000)) return publicApiError("Venue search is busy. Try again shortly.", "RATE_LIMITED", 429, { retryable: true, headers });
  const query = new URL(request.url).searchParams.get("q")?.trim().toLocaleLowerCase("en-GB") ?? "";
  if (query.length < 2 || query.length > 80) return Response.json({ venues: [] }, { headers });
  try {
    const venues = [...(await getVenueIndex()).values()]
      .filter((venue) => isPubVenueKind(venue.kind) && `${venue.name} ${venue.borough}`.toLocaleLowerCase("en-GB").includes(query))
      .slice(0, 8).map(({ id, name, borough }) => ({ id, name, borough }));
    return Response.json({ venues }, { headers });
  } catch { return publicApiError("Venue search is unavailable right now.", "VENUE_LOOKUP_UNAVAILABLE", 503, { retryable: true, headers }); }
}
