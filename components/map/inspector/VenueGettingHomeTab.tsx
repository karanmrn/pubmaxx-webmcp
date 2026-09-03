"use client";

import { useState } from "react";

import LastTrainCard from "../LastTrainCard";
import NearbyBusDepartures from "../NearbyBusDepartures";
import { GetHomeHandoffRow } from "@/components/night/RouteEndingCard";
import { SafeNightStrip } from "@/components/night/SafeNightStrip";
import { venueToGetHomeHandoff } from "@/lib/getHomeHandoff";
import type { Venue } from "@/lib/venues";
import type { LastPintDecision } from "@/lib/tfl";
import type { CityId } from "@/lib/cities";
import type { TabKey } from "@/lib/venueInspectorTabs";

export default function VenueGettingHomeTab({
  venue,
  tab,
  cityId,
  onSelectVenue,
  onDecision,
}: {
  venue: Venue;
  tab: TabKey;
  cityId: CityId;
  onSelectVenue?: (id: string) => void;
  onDecision: (decision: LastPintDecision | null) => void;
}) {
  const [lastPintDecision, setLastPintDecision] = useState<LastPintDecision | null>(
    null,
  );

  return (
    <div
      role="tabpanel"
      id="venuePanel-getting-home"
      aria-labelledby="venueTab-getting-home"
      className="venueTabPanel"
      hidden={tab !== "getting-home"}
    >
      {tab === "getting-home" ? (
        <>
          <LastTrainCard
            key={`${cityId}:${venue.id}:${venue.latitude}:${venue.longitude}:${venue.name}`}
            lat={venue.latitude}
            lng={venue.longitude}
            venueName={venue.name}
            cityId={cityId}
            venueKind={venue.kind}
            onSelectVenue={onSelectVenue}
            onDecision={(decision) => {
              setLastPintDecision(decision);
              onDecision(decision);
            }}
          />
          {cityId === "london" ? (
            <NearbyBusDepartures
              key={venue.id}
              lat={venue.latitude}
              lng={venue.longitude}
            />
          ) : null}
          <GetHomeHandoffRow
            venue={venueToGetHomeHandoff(venue)}
            decision={lastPintDecision?.decision ?? null}
          />
          <SafeNightStrip
            venue={{
              id: venue.id,
              name: venue.name,
              latitude: venue.latitude,
              longitude: venue.longitude,
            }}
            cityId={cityId}
          />
        </>
      ) : null}
    </div>
  );
}
