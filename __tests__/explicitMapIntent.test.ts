import { describe, it, expect } from "vitest";

import { seedCrawlState } from "@/lib/crawlUrl";
import {
  explicitMapIntent,
  restoredSessionHasExplicitIntent,
  searchHasExplicitMapIntent,
} from "@/lib/explicitMapIntent";
import type { MobileMapSessionV1 } from "@/lib/mobileShell";
import type { PlanningIntentV1 } from "@/lib/planningIntent";

const FILTERS = seedCrawlState("").filters;

function session(overrides: Partial<MobileMapSessionV1> = {}): MobileMapSessionV1 {
  return {
    version: 1,
    savedAt: "2026-07-24T18:00:00.000Z",
    viewport: { center: [-0.12, 51.51], zoom: 13, pitch: 28, bearing: -8 },
    filters: FILTERS,
    cityId: "london",
    nightArea: null,
    selectedVenueId: null,
    poiHidden: null,
    openSheet: null,
    ...overrides,
  };
}

const INTENT: PlanningIntentV1 = {
  version: 1,
  source: "near",
  cityId: "london",
  acceptedVenueId: "venue-abc",
  acceptedArea: null,
  startsAt: null,
  displayEvidence: { kind: "price", observedAt: null },
  acceptedAt: "2026-07-24T18:00:00.000Z",
  expiresAt: "2026-07-24T20:00:00.000Z",
};

describe("searchHasExplicitMapIntent", () => {
  it("is false for a clean /map arrival", () => {
    expect(searchHasExplicitMapIntent("")).toBe(false);
    expect(searchHasExplicitMapIntent("?")).toBe(false);
  });

  it.each([
    ["?sel=venue-abc", "sel"],
    ["?q=Arnos+Arms", "q"],
    ["?pubs=a,b,c", "pubs"],
    ["?mode=build", "mode=build"],
    ["?log=1", "log=1"],
    ["?food=1", "existing filter deep link"],
    ["?band=river-history", "band deep link"],
    ["?place=Sheffield&lat=53.38&lng=-1.47", "UK place deep link"],
  ])("recognises the existing explicit arrival param %s (%s)", (search) => {
    expect(searchHasExplicitMapIntent(search)).toBe(true);
  });

  it.each([
    ["?plan=1", "plan=1"],
    ["?accept=1", "accept=1 handoff sentinel"],
    ["?src=near", "src acceptance source"],
    ["?sel=venue-abc&accept=1&src=near", "full accepted-handoff URL"],
  ])("recognises the trusted-handoff arrival param %s (%s)", (search) => {
    expect(searchHasExplicitMapIntent(search)).toBe(true);
  });

  it("does not match a param whose NAME merely contains a token", () => {
    // `replant`/`accepted`/`source` must not be read as plan/accept/src.
    expect(searchHasExplicitMapIntent("?replant=1")).toBe(false);
    expect(searchHasExplicitMapIntent("?accepted=yes")).toBe(false);
    expect(searchHasExplicitMapIntent("?source=news")).toBe(false);
  });

  it("does not treat an incomplete place query as map intent", () => {
    expect(searchHasExplicitMapIntent("?place=Sheffield")).toBe(false);
    expect(
      searchHasExplicitMapIntent("?place=Paris&lat=48.8566&lng=2.3522"),
    ).toBe(false);
  });
});

describe("restoredSessionHasExplicitIntent", () => {
  it("is false for null or a bare viewport/filter restore", () => {
    expect(restoredSessionHasExplicitIntent(null)).toBe(false);
    expect(restoredSessionHasExplicitIntent(session())).toBe(false);
  });

  it("is true for a restored open Venue", () => {
    expect(restoredSessionHasExplicitIntent(session({ selectedVenueId: "pub-1" }))).toBe(true);
    expect(restoredSessionHasExplicitIntent(session({ openSheet: "venue" }))).toBe(true);
  });

  it("is true for restored planner / Route state", () => {
    expect(restoredSessionHasExplicitIntent(session({ openSheet: "planner" }))).toBe(true);
    expect(restoredSessionHasExplicitIntent(session({ nightArea: "shoreditch" }))).toBe(true);
  });

  it("is false for an unrelated restored sheet with no venue/route", () => {
    expect(restoredSessionHasExplicitIntent(session({ openSheet: "layers" }))).toBe(false);
  });
});

describe("explicitMapIntent", () => {
  const clean = { search: "", planningIntent: null, restoredMobileSession: null };

  it("is false for a clean arrival with no restore and no intent", () => {
    expect(explicitMapIntent(clean)).toBe(false);
  });

  it("is true from the search string alone", () => {
    expect(explicitMapIntent({ ...clean, search: "?accept=1&src=near" })).toBe(true);
  });

  it("is true from a valid restored PlanningIntent (caller opted in)", () => {
    expect(explicitMapIntent({ ...clean, planningIntent: INTENT })).toBe(true);
  });

  it("ignores PlanningIntent the caller withheld (intent read off => null)", () => {
    // Off-behaviour: stored intent is preserved but not consulted, so a clean
    // URL with a withheld intent stays onboarding-eligible.
    expect(explicitMapIntent(clean)).toBe(false);
  });

  it("is true from a restored open Venue", () => {
    expect(
      explicitMapIntent({ ...clean, restoredMobileSession: session({ selectedVenueId: "pub-1" }) }),
    ).toBe(true);
  });
});
