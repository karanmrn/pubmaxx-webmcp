import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BandOnboardingChip } from "@/components/map/pubmap/BandOnboardingChip";
import {
  bandChipHasResolvedBand,
  bandChipDismissedKey,
  shouldShowBandOnboardingChip,
  shouldShowCuratedOnboarding,
} from "@/lib/bandOnboardingChip";

describe("bandChipDismissedKey", () => {
  it("is distinct from the curated onboarding key and scoped per band", () => {
    expect(bandChipDismissedKey("river-history")).toBe(
      "pubmax_band_chip_dismissed:river-history",
    );
    expect(bandChipDismissedKey("river-history")).not.toContain("onboarding_dismissed");
    expect(bandChipDismissedKey("royal-civic")).not.toBe(
      bandChipDismissedKey("river-history"),
    );
  });
});

describe("BandOnboardingChip copy", () => {
  it("renders a condition through its closing qualifier", () => {
    const copy =
      "The riverside route uses listed venues only. Opening hours still vary, so check each pub before setting off.";
    const html = renderToStaticMarkup(
      createElement(BandOnboardingChip, {
        title: "Riverside story",
        copy,
        onWalkStory: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain(copy);
  });
});

describe("shouldShowBandOnboardingChip", () => {
  const base = {
    loaded: true,
    activeBandId: "river-history",
    bandResolved: true,
    chipDismissed: false,
  };

  it("shows when loaded, band id set, band resolves, and not dismissed", () => {
    expect(shouldShowBandOnboardingChip(base)).toBe(true);
  });

  it("hides when dismissed, unresolved, empty id, or not loaded", () => {
    expect(shouldShowBandOnboardingChip({ ...base, chipDismissed: true })).toBe(false);
    expect(shouldShowBandOnboardingChip({ ...base, bandResolved: false })).toBe(false);
    expect(shouldShowBandOnboardingChip({ ...base, activeBandId: "" })).toBe(false);
    expect(shouldShowBandOnboardingChip({ ...base, loaded: false })).toBe(false);
  });
});

describe("bandChipHasResolvedBand", () => {
  it("does not resolve a band while its catalog is still loading", () => {
    expect(bandChipHasResolvedBand("river-history", null)).toBe(false);
  });

  it("resolves only the requested band", () => {
    expect(bandChipHasResolvedBand("river-history", { id: "other-band" })).toBe(false);
    expect(bandChipHasResolvedBand("river-history", { id: "river-history" })).toBe(true);
  });
});

describe("shouldShowCuratedOnboarding priority vs band chip", () => {
  const clean = {
    loaded: true,
    onboardingDismissed: false,
    arrivedWithCrawlParams: false,
    mode: "suggest",
    builtIdsCount: 0,
    hasActiveCrawl: false,
    selectedVenueId: "",
    showBandChip: false,
    curatedCrawlCount: 4,
  };

  it("shows curated onboarding on a clean first paint", () => {
    expect(shouldShowCuratedOnboarding(clean)).toBe(true);
  });

  it("suppresses curated onboarding when the band chip is showing", () => {
    expect(shouldShowCuratedOnboarding({ ...clean, showBandChip: true })).toBe(false);
  });

  it("suppresses curated onboarding while first-map orientation is pending", () => {
    expect(
      shouldShowCuratedOnboarding({ ...clean, mapOrientationPending: true }),
    ).toBe(false);
  });

  it("suppresses curated onboarding when the city has no crawls", () => {
    expect(shouldShowCuratedOnboarding({ ...clean, curatedCrawlCount: 0 })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, curatedCrawlCount: undefined })).toBe(false);
  });

  it("still respects the usual curated gates when band chip is off", () => {
    expect(shouldShowCuratedOnboarding({ ...clean, onboardingDismissed: true })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, arrivedWithCrawlParams: true })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, mode: "build" })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, builtIdsCount: 2 })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, hasActiveCrawl: true })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, selectedVenueId: "v1" })).toBe(false);
    expect(shouldShowCuratedOnboarding({ ...clean, loaded: false })).toBe(false);
  });

  it("suppresses curated onboarding while the Tonight lane has live rows (GateZ: flagship surface wins first paint)", () => {
    expect(
      shouldShowCuratedOnboarding({ ...clean, tonightLaneHasRows: true }),
    ).toBe(false);
  });

  it("suppresses curated onboarding while the Tonight lane first fetch is pending", () => {
    expect(
      shouldShowCuratedOnboarding({ ...clean, tonightLanePending: true }),
    ).toBe(false);
  });

  it("still shows curated onboarding when the Tonight lane is empty/absent", () => {
    expect(
      shouldShowCuratedOnboarding({ ...clean, tonightLaneHasRows: false }),
    ).toBe(true);
    expect(shouldShowCuratedOnboarding(clean)).toBe(true);
  });
});
