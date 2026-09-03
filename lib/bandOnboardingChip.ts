// G3 — Place story deep-link onboarding chip.
// Pure helpers for when `?band={id}` should surface a dismissible corridor
// explainer, and for suppressing the curated "Start with a story" overlay so
// the two never fight. Session dismiss key is distinct from curated onboarding.

/** sessionStorage key prefix; append `:${bandId}` for per-band dismiss. */
export const BAND_CHIP_DISMISSED_KEY_PREFIX = "pubmax_band_chip_dismissed";

export function bandChipDismissedKey(bandId: string): string {
  return `${BAND_CHIP_DISMISSED_KEY_PREFIX}:${bandId}`;
}

export function bandChipHasResolvedBand(
  activeBandId: string,
  activeBand: { id: string } | null | undefined,
): boolean {
  return Boolean(activeBandId && activeBand?.id === activeBandId);
}

export function shouldShowBandOnboardingChip(input: {
  loaded: boolean;
  activeBandId: string;
  bandResolved: boolean;
  chipDismissed: boolean;
}): boolean {
  return (
    input.loaded &&
    Boolean(input.activeBandId) &&
    input.bandResolved &&
    !input.chipDismissed
  );
}

/**
 * Curated crawl onboarding. When the band deep-link chip is showing, curated
 * onboarding is suppressed so the deep link feels intentional (G3 priority).
 * Cities with zero curated crawls never show the overlay.
 *
 * GateZ regression fix: the flagship Tonight lane (W1's primary "what's on"
 * surface) must win first paint over the "Start with a story" card — a
 * first-run visitor with live tonight rows should see them immediately, not
 * have them occluded by the onboarding overlay. So when the lane has loaded
 * rows to show (or while its first fetch is pending), onboarding stays
 * suppressed until the visitor dismisses or interacts with the lane (tracked by
 * the caller via `tonightLaneHasRows`, which should go false again once the
 * lane is dismissed/interacted with).
 *
 * Landing acquisition W3: defer until the first-map orientation beat
 * (FirstRunTour band colours) is done, so cold visitors never get three
 * competing overlays after consent.
 */
export function shouldShowCuratedOnboarding(input: {
  loaded: boolean;
  onboardingDismissed: boolean;
  arrivedWithCrawlParams: boolean;
  mode: string;
  builtIdsCount: number;
  hasActiveCrawl: boolean;
  selectedVenueId: string;
  showBandChip: boolean;
  /** When 0 / omitted-as-empty, skip onboarding (no crawls to offer). */
  curatedCrawlCount?: number;
  /** Tonight lane has rows ready to show and hasn't been dismissed/interacted
   * with yet — the lane wins first paint, so onboarding waits. */
  tonightLaneHasRows?: boolean;
  /** Tonight lane is still resolving; it also wins first paint while pending. */
  tonightLanePending?: boolean;
  /**
   * First-map orientation (band-colour tour) still pending. When true, curated
   * crawl waits so at most one orientation surface shows after consent.
   */
  mapOrientationPending?: boolean;
}): boolean {
  if (input.showBandChip) return false;
  if (input.mapOrientationPending) return false;
  if ((input.curatedCrawlCount ?? 0) <= 0) return false;
  if (input.tonightLaneHasRows || input.tonightLanePending) return false;
  return (
    input.loaded &&
    !input.onboardingDismissed &&
    !input.arrivedWithCrawlParams &&
    input.mode === "suggest" &&
    input.builtIdsCount === 0 &&
    !input.hasActiveCrawl &&
    !input.selectedVenueId
  );
}
