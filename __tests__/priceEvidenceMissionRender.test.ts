import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import VenuePriceEntryPanel from "@/components/map/inspector/VenuePriceEntryPanel";
import PriceEvidenceMissionSlot from "@/components/nearme/PriceEvidenceMissionSlot";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { SUBMITTABLE_DRINK_CATEGORIES, submitCategoryLabel } from "@/lib/communityPrice";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "signed-in" },
    handle: "night_owl",
    identityResolved: true,
    loading: false,
    configured: true,
  }),
}));

vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (run: (auth: { accessToken: string }) => Promise<void>) => {
      await run({ accessToken: "token" });
    },
    contributionGateDialog: null,
  }),
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map([["venue-live", "ready"]]),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
} as unknown as CommunityPricesState;

const provisional: PriceEvidenceMission = {
  venueId: "venue-live",
  reason: "provisional",
  drinkCategory: "wine",
  observedAt: Date.parse("2026-08-16T18:00:00.000Z"),
};

describe("price evidence mission render", () => {
  it("shows one ranked mission above the near form and names the category", () => {
    const html = renderToStaticMarkup(
      createElement(PriceEvidenceMissionSlot, {
        mission: provisional,
        venueName: "The Crown",
        surface: "near",
        communityPrices,
        onDismiss: () => undefined,
      }),
    );
    expect(html).toContain("Check the wine price at The Crown");
    expect(html).toContain("Log it");
    expect(html).toContain("Not now");
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).not.toContain("4.20");
  });

  it("lets a missing mission keep the lane chips and one-tap prices", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "venue-empty",
        venueName: "The Crown",
        communityPrices,
        laneCategory: "gin",
        mission: { reason: "missing", surface: "near" },
      }),
    );
    expect(html).toContain('value=""');
    expect(html).toContain("Common prices");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(`>${submitCategoryLabel("gin")}<`);
    expect(html).toMatch(
      new RegExp(`aria-checked="true"[^>]*>${submitCategoryLabel("gin")}<`),
    );
    for (const category of SUBMITTABLE_DRINK_CATEGORIES) {
      expect(html).toContain(`>${submitCategoryLabel(category)}<`);
    }
  });

  it("holds Log it until the mission read answers", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "venue-live",
        venueName: "The Crown",
        communityPrices,
        missionPending: true,
      }),
    );
    expect(html).toContain("Checking...");
    expect(html).toMatch(/disabled(?:=|"")/);
    expect(html).not.toContain(">Log it<");
  });

  it("locks a known category and offers no one-tap agreement", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceSubmit, {
        venueId: "venue-live",
        venueName: "The Crown",
        communityPrices,
        baselinePriceGbp: 4.2,
        mission: { reason: "stale", drinkCategory: "beer", surface: "map" },
      }),
    );
    expect(html).toContain("vpsubLockedDrink");
    expect(html).toContain(">Beer<");
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain("Common prices");
    expect(html).toContain('value=""');
  });

  it("holds the sheet Log it while the mission read is still in flight", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceEntryPanel, {
        venueId: "venue-live",
        venueName: "The Crown",
        communityPrices,
        canSubmitPrice: true,
        showSignInGate: false,
        authLoading: false,
        mission: null,
        missionPending: true,
      }),
    );
    expect(html).toContain("Checking...");
    expect(html).not.toContain(">Log it<");
    expect(html).not.toContain("pemHeading");
  });

  it("keeps the sheet form after a failed write by leaving the composer mounted", () => {
    const html = renderToStaticMarkup(
      createElement(VenuePriceEntryPanel, {
        venueId: "venue-live",
        venueName: "The Crown",
        communityPrices: {
          ...communityPrices,
          submitting: false,
        } as CommunityPricesState,
        canSubmitPrice: true,
        showSignInGate: false,
        authLoading: false,
        mission: provisional,
        onDismissMission: () => undefined,
      }),
    );
    expect(html).toContain("Check the wine price at The Crown");
    expect(html).toContain("venuePriceSubmit");
    expect(html).toContain("Log it");
    expect(html).toContain("Not now");
  });
});
