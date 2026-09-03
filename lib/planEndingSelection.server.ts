import "server-only";

import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { haversineKm } from "@/lib/haversine";
import { getLateFoodForArea, normalizeLateFoodArea } from "@/lib/lateFood";
import type { EndingSelection, PlanState } from "@/lib/plan";

function transportOptionId(label: string): string {
  const slug = label.toLocaleLowerCase("en-GB").replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `transport:${slug || "nearest"}`;
}

/**
 * Rebuilds a host-selected ending from server-owned evidence. Client snapshots
 * are never persisted as facts merely because they satisfy the wire shape.
 */
export async function canonicalEndingSelection(
  plan: PlanState,
  selection: EndingSelection,
  terminalVenueId: string | null,
  now = Date.now(),
): Promise<EndingSelection | null> {
  if (selection.kind === "get_home") {
    const label = selection.evidenceSnapshot.label;
    if (selection.optionId !== transportOptionId(label)) return null;
    return {
      kind: "get_home",
      optionId: selection.optionId,
      evidenceSnapshot: {
        label,
        confidence: "unknown",
        source: "PUBMAXX transport choice",
        warnings: ["Live transport details were not checked or saved when the host confirmed this ending."],
      },
    };
  }

  const venues = await loadConciergeVenues("london");
  const finalStop = terminalVenueId ? venues.find((venue) => venue.id === terminalVenueId) : null;

  if (selection.kind === "food") {
    const area = normalizeLateFoodArea(plan.context?.nightArea);
    if (!area || !finalStop || selection.optionId !== selection.externalPlaceId) return null;
    const terminal = getLateFoodForArea(area, [], { from: finalStop, now })
      .find((candidate) => candidate.id === selection.optionId);
    if (!terminal) return null;
    return {
      kind: "food",
      optionId: terminal.id,
      externalPlaceId: terminal.id,
      evidenceSnapshot: {
        label: terminal.name,
        confidence: terminal.confidence,
        source: `${terminal.provenance.source} · ${terminal.provenance.sourceUrl}`,
        observedAt: terminal.provenance.observedAt,
        warnings: [terminal.hours.service, terminal.walkingDetour.note],
      },
    };
  }

  const extension = venues.find((venue) => venue.id === selection.venueId);
  if (!finalStop || !extension || selection.optionId !== selection.venueId) return null;
  if (plan.stops.some((stop) => stop.venueId === extension.id) ||
      haversineKm([finalStop.lng, finalStop.lat], [extension.lng, extension.lat]) > 2.5) return null;
  return {
    kind: "keep_going",
    optionId: extension.id,
    venueId: extension.id,
    evidenceSnapshot: {
      label: extension.name,
      confidence: "low",
      source: "PUBMAXX venue index",
      warnings: ["Closing time was not checked when the host confirmed this extra stop."],
    },
  };
}
