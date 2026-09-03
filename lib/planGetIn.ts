// Turns a Plan's stops into a per-stop "can the crew get in?" signal.
//
// Pure mapping layer over lib/busyness.ts — no I/O of its own. The route
// handler (app/api/plans/[id]/getin/route.ts) supplies the Plan state and a
// venue lookup; this module just wires estimateBusyness / canGroupGetIn /
// resolveBookingOption together into the response contract another worker's
// UI codes against. Never fabricates data: a venue with no known opening
// hours or booking link degrades to "unknown" / unavailable, it is never
// guessed.

import {
  canGroupGetIn,
  estimateBusyness,
  resolveBookingOption,
  type BusynessLevel,
  type BusynessSource,
  type GroupFit,
} from "@/lib/busyness";
import type { PlanState } from "@/lib/plan";

// Minimal shape this module needs from a venue record — deliberately narrower
// than lib/venues.ts's full Venue type so callers (and tests) don't have to
// construct an entire venue just to exercise the mapping.
export type PlanGetInVenue = {
  bookingLink?: string | null;
};

export type VenueLookup = (
  venueId: string,
) => Promise<PlanGetInVenue | null> | PlanGetInVenue | null;

export type PlanGetInStopDTO = {
  position: number;
  venueId: string;
  venueName: string;
  busyness: {
    level: BusynessLevel;
    label: string;
    source: BusynessSource;
    /* Provenance flag from lib/busyness — always true today; carried on the
       wire so API consumers can tell an estimate from future live data. */
    isEstimate: boolean;
    isOpen: boolean | "unknown";
    explanation: string;
  };
  getIn: {
    fit: GroupFit;
    label: string;
    reason: string;
  };
  booking: {
    available: boolean;
    label: string;
    href: string | null;
  };
};

export type PlanGetInReportDTO = {
  groupSize: number;
  generatedAt: string;
  stops: PlanGetInStopDTO[];
};

/**
 * Pure(-ish) builder for the /api/plans/[id]/getin contract. `venueLookup`
 * may be sync or async so the route can pass lib/venueDetailIndex's
 * getVenueDetail directly while tests pass a plain in-memory map lookup.
 */
export async function planGetInReport(
  state: PlanState,
  venueLookup: VenueLookup,
  now: Date = new Date(),
): Promise<PlanGetInReportDTO> {
  const groupSize = Math.max(1, state.crew.length);
  const sortedStops = [...state.stops].sort((a, b) => a.position - b.position);

  const stops = await Promise.all(
    sortedStops.map(async (stop) => {
      const venue = await venueLookup(stop.venueId);
      const busyness = estimateBusyness({ now, timeZone: "Europe/London" });
      const booking = resolveBookingOption(venue?.bookingLink ?? null);
      const getIn = canGroupGetIn({
        groupSize,
        level: busyness.level,
        hasBookingLink: booking.available,
        now,
        timeZone: "Europe/London",
      });

      return {
        position: stop.position,
        venueId: stop.venueId,
        venueName: stop.venueName,
        busyness: {
          level: busyness.level,
          label: busyness.label,
          source: busyness.source,
          isEstimate: busyness.isEstimate,
          isOpen: busyness.isOpen,
          explanation: busyness.explanation,
        },
        getIn: {
          fit: getIn.fit,
          label: getIn.label,
          reason: getIn.reason,
        },
        booking: {
          available: booking.available,
          label: booking.label,
          href: booking.href,
        },
      } satisfies PlanGetInStopDTO;
    }),
  );

  return { groupSize, generatedAt: now.toISOString(), stops };
}
