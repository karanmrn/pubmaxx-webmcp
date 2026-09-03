import LandlordPanel from "@/components/LandlordPanel";
import type { Venue } from "@/lib/venues";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenueAskTab({ venue, tab }: { venue: Venue; tab: TabKey }) {
  return (
    <div
      role="tabpanel"
      id="venuePanel-ask"
      aria-labelledby="venueTab-ask"
      className="venueTabPanel"
      hidden={tab !== "ask"}
    >
      <LandlordPanel
        venueId={venue.id}
        venueName={venue.name}
        venueKind={venue.kind}
        context={{
          era: venue.curation.heritageEra,
          heritageNote: venue.curation.heritageNote,
          address: venue.address,
          borough: venue.primaryBorough,
        }}
      />
    </div>
  );
}
