import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenuePriceEntryPanel from "@/components/map/inspector/VenuePriceEntryPanel";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";

const NOW = Date.now();

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map([
    [
      "venue-fixture",
      [
        {
          venueId: "venue-fixture",
          signalKey: "character",
          signalValue: "rough",
          submittedAt: NOW,
          source: "community",
          corroborations: 1,
        },
      ],
    ],
  ]),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map([["venue-fixture", "ready"]]),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
} as unknown as CommunityPricesState;

function renderEntry({
  canSubmitPrice,
  showSignInGate,
}: {
  canSubmitPrice: boolean;
  showSignInGate: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(VenuePriceEntryPanel, {
      venueId: "venue-fixture",
      venueName: "Fixture Arms",
      communityPrices,
      canSubmitPrice,
      showSignInGate,
      authLoading: false,
      focusRequest: 1,
    }),
  );
}

describe("price contribution auth destination", () => {
  it("takes a signed-out drinker to an account-first gate before the form", () => {
    authState.current = {
      user: null,
      loading: false,
      configured: true,
      // A SETTLED signed-out drinker. Without this the provider has not
      // answered, SignInButton withholds itself by design, and the gate would
      // render its heading over no way in - which is the opposite of what this
      // test is about.
      supabaseAuthState: "signed-out",
      socialProviders: { google: false, microsoft: false },
      signInWithGoogle: vi.fn(),
      signInWithMicrosoft: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };

    const html = renderEntry({
      canSubmitPrice: false,
      showSignInGate: true,
    });

    expect(html).toContain("Sign in to add a price");
    expect(html).toContain("You need an account to add a price.");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("One drinker called it rough.");
    expect(html).toContain("Sign in to add what you noticed.");
    expect(html).not.toContain("Add what you noticed");
  });

  it("takes an injected signed-in state to the existing price form", () => {
    authState.current = {
      user: { id: "signed-in-drinker" },
      loading: false,
      configured: true,
    };
    const html = renderEntry({
      canSubmitPrice: true,
      showSignInGate: true,
    });

    expect(html).toContain("venuePriceSubmit");
    expect(html).toContain("What’s it tonight?");
    expect(html).toContain(
      'aria-label="Price of a beer at Fixture Arms, in pounds"',
    );
    // Coffee is a first-class submit chip beside soft-drink / alcohol-free.
    expect(SUBMITTABLE_DRINK_CATEGORIES).toContain("coffee");
    expect(html).toContain(">Coffee<");
    expect(html).toContain(">Soft drinks<");
    expect(html).toContain(">Alcohol-free<");
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Add what you noticed");
    expect(html).not.toContain("Sign in to add a price");
    expect(html).not.toContain("Sign in to add what you noticed.");
  });

  it("keeps public signal reads but no composer before price contribution", () => {
    const html = renderEntry({
      canSubmitPrice: false,
      showSignInGate: false,
    });

    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("One drinker called it rough.");
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).not.toContain("Sign in to add a price");
    expect(html).not.toContain("Add what you noticed");
  });
});
