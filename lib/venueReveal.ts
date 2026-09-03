import {
  drivesMap,
  isCorroborated,
  isWithinMaxAge,
  type CommunityPrice,
} from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";
import type { VenueRevealForm } from "@/lib/sheetSnap";

export {
  revealForm,
  venueRevealPrefersReducedMotion,
  VENUE_REVEAL_CINEMA_MS,
  VENUE_REVEAL_REDUCED_MOTION_QUERY,
  VENUE_REVEAL_SHORT_MS,
  VENUE_REVEAL_STALE_MS,
  type VenueRevealForm,
} from "@/lib/sheetSnap";
export {
  venueDrinkPriceView,
  type VenueDrinkPriceView,
} from "@/lib/drinkLanes";

export type VenueRevealRequest = {
  sequence: number;
  venueId: string;
  startedAt: number;
  form: VenueRevealForm;
  rows: readonly CommunityPrice[] | undefined;
  lane: DrinkCategory;
  interrupted: boolean;
};

/**
 * Beat 3 motion grammar: the Beermat Drop is earned only by a corroborated,
 * in-window community figure. Provisional rows slide flat; unknown stays still.
 */
export type VenuePriceRevealMotion = "drop" | "slide" | "static";

export type VenuePriceRevealInput = {
  /** Freshest community row for the lead drink lane, if any. */
  communityLead:
    | (Pick<CommunityPrice, "corroborations" | "submittedAt"> & {
        mapCandidate?: CommunityPrice["mapCandidate"] | null;
      })
    | null
    | undefined;
};

export function venuePriceRevealMotion(
  input: VenuePriceRevealInput,
  now: number = Date.now(),
): VenuePriceRevealMotion {
  const lead = input.communityLead;
  if (!lead) return "static";
  if (drivesMap(lead, now)) return "drop";
  if (isWithinMaxAge(lead, now) && !isCorroborated(lead)) return "slide";
  return "static";
}

/** CSS class suffix for beat 3 chrome animation. */
export function venuePriceRevealMotionClass(
  motion: VenuePriceRevealMotion,
): string {
  if (motion === "drop") return "venueRevealPriceChrome--drop";
  if (motion === "slide") return "venueRevealPriceChrome--slide";
  return "venueRevealPriceChrome--static";
}

/** Root reveal classes for the inspector shell. */
export function venueRevealRootClasses(input: {
  active: boolean;
  form: VenueRevealForm;
  interrupted: boolean;
}): string {
  if (!input.active || input.interrupted) return "";
  return `venueReveal venueReveal--${input.form}`;
}
