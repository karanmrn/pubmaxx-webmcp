import type { Venue } from "@/lib/venues";

export type VenueSignal = {
  hasPintDrops: boolean;
  latestContributorPrice: number | null;
  /** Epoch ms of the observation supplying latestContributorPrice. */
  latestContributorAt?: number | null;
  /** Display-only demo price for pin colour when cheapestPrice is null. */
  latestDemoPrice?: number | null;
};
export type HoveredVenue = { id: string; name: string; x: number; y: number };
export type VenueDetailResponse = { venue?: Venue | null };
export type FailedHoverImage = { venueId: string; url: string };
