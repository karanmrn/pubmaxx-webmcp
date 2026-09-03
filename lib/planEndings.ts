import type { Daypart } from "@/lib/nightPlanning";
import {
  shortlistFoodHandoffs,
  type LateFoodTerminal,
} from "@/lib/lateFood";
import type { PlanEndingRecommendation, PlanEndingOption } from "@/lib/planIntelligence";

export type GroundedPlanExtension = {
  venueId: string;
  venueName: string;
  distanceKm: number;
  estimatedPintPricePence: number | null;
};

function foodOption(terminal: LateFoodTerminal): PlanEndingOption {
  const distance = terminal.walkingDetour.minutes === null
    ? "distance from final stop unavailable"
    : `${terminal.walkingDetour.minutes} min direct-distance estimate`;
  return {
    id: terminal.id,
    label: terminal.name,
    detail: `${terminal.category} · ${distance} · check tonight's hours`,
    ...(terminal.walkingDetour.minutes === null ? {} : { walkingMinutes: terminal.walkingDetour.minutes }),
    closingConfidence: terminal.openAtRequestedTime === true ? "listed" : "unknown",
    provenance: [{
      kind: "night_signal",
      label: `${terminal.provenance.source}: published service hours`,
      asOf: terminal.provenance.observedAt,
    }],
  };
}

function extensionOption(extension: GroundedPlanExtension): PlanEndingOption {
  const price = extension.estimatedPintPricePence === null
    ? "price not recorded"
    : `about £${(extension.estimatedPintPricePence / 100).toFixed(2)} for one recorded pint`;
  return {
    id: extension.venueId,
    label: extension.venueName,
    detail: `${extension.distanceKm.toFixed(1)} km straight-line · ${price} · closing time not checked`,
    priceImpactPence: extension.estimatedPintPricePence,
    closingConfidence: "unknown",
    provenance: [{ kind: "venue_dataset", label: `PUBMAXX venue record for ${extension.venueName}` }],
  };
}

/** Builds review-only ending choices. It never navigates, completes, or mutates a Plan. */
export function buildPlanEndingRecommendations({
  daypart,
  foodRequested,
  transportAnchor,
  lateFood,
  extensions,
}: {
  daypart: Daypart;
  foodRequested: boolean;
  transportAnchor: string;
  lateFood: readonly LateFoodTerminal[];
  extensions: readonly GroundedPlanExtension[];
}): PlanEndingRecommendation[] {
  const foodOptions = shortlistFoodHandoffs(lateFood).map(foodOption);
  const extensionOptions = extensions.slice(0, 2).map(extensionOption);
  const preferred = foodRequested && foodOptions.length > 0 ? "food" : "get_home";
  const urgentHome = daypart === "get_home" || daypart === "late_night";

  return [
    {
      kind: "food",
      label: "Find food",
      reason: foodOptions.length > 0
        ? `${foodOptions.length} checked option${foodOptions.length === 1 ? "" : "s"} near this patch.`
        : "No late food worth pointing you to round here yet.",
      preselected: preferred === "food",
      requiresConfirmation: true,
      confidence: foodOptions.some((option) => option.closingConfidence !== "unknown") ? "medium" : "low",
      warnings: foodOptions.length > 0
        ? ["Kitchens can shut early. Check tonight's hours before you leave the last pub."]
        : ["No late food worth pointing you to round here yet."],
      options: foodOptions,
    },
    {
      kind: "get_home",
      label: "Get home",
      reason: urgentHome
        ? `Use ${transportAnchor} as the first transport anchor and check the live last-service signal.`
        : `Keep ${transportAnchor} visible as the route's transport anchor.`,
      preselected: preferred === "get_home",
      requiresConfirmation: true,
      confidence: "medium",
      warnings: ["Live status, destination routing, and last-service times load during the night."],
      options: [{
        id: `transport:${transportAnchor.toLocaleLowerCase().replaceAll(" ", "-")}`,
        label: transportAnchor,
        detail: "Open TfL only after you confirm.",
        href: "https://tfl.gov.uk/plan-a-journey/",
        provenance: [{ kind: "night_area_review", label: `${transportAnchor} transport anchor` }],
      }],
    },
    {
      kind: "keep_going",
      label: "Keep going",
      reason: extensionOptions.length > 0
        ? `${extensionOptions.length} grounded nearby extension${extensionOptions.length === 1 ? "" : "s"}; prices and hours remain review points.`
        : "This route has no extra pub to suggest.",
      preselected: false,
      requiresConfirmation: true,
      confidence: "low",
      warnings: extensionOptions.length > 0
        ? ["Closing times are not checked. We show extra spend only when a price is recorded."]
        : ["No extra pub was returned with this route."],
      options: extensionOptions,
    },
  ];
}
