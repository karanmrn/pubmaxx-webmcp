import { haversineKm } from "@/lib/haversine";
import { isPubVenue } from "@/lib/venueKindFilters";
import type { Landmark } from "@/lib/landmarks";
import type { Venue } from "@/lib/venues";

export type NearbyStoryPub = { venue: Venue; km: number };

export function nearestStoryPubs(
  landmark: Landmark,
  venues: Venue[],
  limit = 3,
): NearbyStoryPub[] {
  return venues
    .filter((venue) => venue.hasStory && isPubVenue(venue))
    .map((venue) => ({
      venue,
      km: haversineKm(landmark.coordinates, [venue.longitude, venue.latitude]),
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
