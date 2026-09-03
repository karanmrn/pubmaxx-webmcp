import { haversineKm } from "@/lib/haversine";
import { bandAnchors } from "@/lib/storyBandGeometry";
import type { Landmark } from "@/lib/landmarks";
import type { StoryBand } from "@/lib/storyBands";
import type { Venue } from "@/lib/venues";

export type BandMember = { venue: Venue; km: number };

export function bandMemberPubs(
  band: StoryBand,
  venues: Venue[],
  catalog: readonly Landmark[],
): BandMember[] {
  const anchors = bandAnchors(band, catalog);
  if (anchors.length === 0) return [];
  const members: BandMember[] = [];
  for (const venue of venues) {
    if (!venue.hasStory) continue;
    const point: [number, number] = [venue.longitude, venue.latitude];
    let nearest = Infinity;
    for (const anchor of anchors) {
      const km = haversineKm(anchor.coordinates, point);
      if (km < nearest) nearest = km;
    }
    if (nearest <= band.radiusKm) members.push({ venue, km: nearest });
  }
  return members.sort((a, b) => a.km - b.km);
}
