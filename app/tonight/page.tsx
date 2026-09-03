import type { Metadata } from "next";

import { loadHistoricPubs } from "@/lib/historic";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import { buildQuietPint, isQuietPintWindow } from "@/lib/quietPint";
import { readTrustedHandoffFlags } from "@/lib/trustedHandoffFlags.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import TonightClient from "./TonightClient";

// First-class "Tonight" screen. The client owns the PRIMARY What's-On spine
// (/api/whats-on — same as the map Tonight lane) and all interactivity. This
// server shell carries route metadata plus the quiet-pint module when the
// typical-pattern hour allows it (same buildQuietPint seam as /today).
export const metadata: Metadata = {
  title: "Tonight in London · PUBMAXXING",
  description:
    "Check sourced London pub listings for tonight, with map links when available.",
  alternates: { canonical: "/tonight" },
};

export const runtime = "nodejs";

export default async function TonightPage() {
  // Server reads the trusted-handoff flags once; the client receives an immutable
  // DTO and never interprets env itself (contract 4.1). All-off keeps today's
  // Tonight behaviour byte-for-byte.
  const flags = readTrustedHandoffFlags();
  const now = new Date();
  const softPlansWindow = isQuietPintWindow(now);

  // Same fail-soft compose as /today: heritage-cited candidates joined to
  // verified pint prices. buildQuietPint returns null outside a quiet window
  // or when cited candidates are too few; the card then renders nothing.
  const [pricedVenues, historicPubs, mapSelectableVenueIds] = await Promise.all([
    getPricedVenues(),
    loadHistoricPubs(),
    loadMapSelectableVenueIds(),
  ]);
  const priceById = new Map<string, number>();
  for (const venue of pricedVenues) {
    if (typeof venue.cheapestPrice === "number") priceById.set(venue.id, venue.cheapestPrice);
  }
  const quietPint = buildQuietPint({
    candidates: historicPubs.flatMap((pub) =>
      pub.venueId
        ? [
            {
              venueId: pub.venueId,
              name: pub.name,
              slug: pub.slug,
              hook: pub.hook,
              facts: pub.facts,
              era: pub.era,
              listed: pub.listed,
            },
          ]
        : [],
    ),
    priceById,
    now,
  });

  return (
    <TonightClient
      flags={flags}
      quietPint={quietPint}
      softPlansWindow={softPlansWindow}
      mapSelectableVenueIds={
        mapSelectableVenueIds ? [...mapSelectableVenueIds] : null
      }
    />
  );
}
