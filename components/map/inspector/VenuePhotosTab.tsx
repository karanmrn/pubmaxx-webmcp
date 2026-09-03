import VenuePhotoWall from "@/components/venue/VenuePhotoWall";
import type { Venue } from "@/lib/venues";
import type { TabKey } from "@/lib/venueInspectorTabs";

// The wall's mount inside the venue sheet. Every panel here renders and the
// inactive ones are hidden, so `active` is what stops a wall fetching a page of
// photos for a reader who opened the pub to check the last train.
export default function VenuePhotosTab({ venue, tab }: { venue: Venue; tab: TabKey }) {
  return (
    <div
      role="tabpanel"
      id="venuePanel-photos"
      aria-labelledby="venueTab-photos"
      className="venueTabPanel"
      hidden={tab !== "photos"}
    >
      <VenuePhotoWall venueId={venue.id} venueName={venue.name} active={tab === "photos"} />
    </div>
  );
}
