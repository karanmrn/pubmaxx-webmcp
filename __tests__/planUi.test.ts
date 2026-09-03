import { describe, expect, it } from "vitest";

import { planViewModel, shareCopyForPlan, stopsFromAnswerCards, stopsFromConcierge } from "@/components/plan/planPresentation";
import {
  parsePendingRoute,
  canBeginPlanRouteEdit,
  planSummaryGenerationBody,
  planSummaryRouteUpdateBody,
  refreshedRouteRejection,
  routeHasChanged,
} from "@/components/plan/PlanSummary";
import type { PlanState } from "@/lib/plan";

const state: PlanState = {
  plan: {
    id: "6ab5ca40-836b-4970-9477-d1779fdd31ab",
    title: "Thursday, sorted",
    startTime: "2026-07-16T17:30:00.000Z",
    createdAt: "2026-07-11T12:00:00.000Z",
    routeRevision: 1,
  },
  stops: [
    { venueId: "v-second", venueName: "The Swan", position: 2 },
    { venueId: "v-first", venueName: "The George", position: 1 },
  ],
  crew: [],
};

describe("planViewModel", () => {
  it("renders crawl stops in their explicit order", () => {
    expect(planViewModel(state).stops.map((stop) => stop.venueName)).toEqual([
      "The George",
      "The Swan",
    ]);
  });

  it("keeps the invite copy useful before anyone joins", () => {
    expect(shareCopyForPlan(state)).toBe(
      "Thursday, sorted · 2 stops · starts 18:30. Open the link and tap I'm in.",
    );
  });

  it("adds a spend band only when every listed stop price is known", () => {
    expect(shareCopyForPlan(state, { listedStopPricesGbp: [4.5, 5.2] })).toBe(
      "Thursday, sorted · 2 stops · starts 18:30 · £4.50–£5.20 per person. Open the link and tap I'm in.",
    );
    expect(shareCopyForPlan(state, { listedStopPricesGbp: [4.5, null] })).toBe(
      "Thursday, sorted · 2 stops · starts 18:30. Open the link and tap I'm in.",
    );
  });
});

describe("routeHasChanged", () => {
  it("requires an actual ordered stop change", () => {
    expect(routeHasChanged([{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }], [{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }])).toBe(false);
    expect(routeHasChanged([{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }], [{ venueId: "a" }, { venueId: "x" }, { venueId: "c" }])).toBe(true);
  });
});

describe("pending route continuity", () => {
  it("accepts the v1 envelope and rejects unknown storage versions", () => {
    const stops = [{ venueId: "a", venueName: "A", position: 0, alternatives: [] }];
    expect(parsePendingRoute(JSON.stringify({ version: 1, savedAt: "2026-07-16T20:00:00Z", expectedRouteRevision: 2, stops }))).toMatchObject({
      expectedRouteRevision: 2,
      stops,
      groundingProof: null,
      operationKey: null,
    });
    expect(parsePendingRoute(JSON.stringify({ version: 2, expectedRouteRevision: 2, stops }))).toBeNull();
  });
});

describe("anchored Plan route editing", () => {
  const anchoredState: PlanState = {
    plan: {
      ...state.plan,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "anchor-only",
    },
    stops: [{ venueId: "venue-a", venueName: "Anchor", position: 0 }],
    crew: [],
    context: {
      nightArea: "piccadilly-soho",
      daypart: "evening",
      partyType: "friends",
      groupSize: null,
      stopCount: 3,
      budget: "value",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    },
  };

  it("regenerates from the saved anchor and its city", () => {
    expect(planSummaryGenerationBody(anchoredState)).toMatchObject({
      cityId: "london",
      anchor: {
        venueId: "venue-a",
        source: "near",
        acceptedArea: null,
        startsAt: state.plan.startTime,
      },
    });
  });

  it("submits returned V2 authority with anchored Stop 1", () => {
    expect(planSummaryRouteUpdateBody({
      stops: [
        { venueId: "venue-a", venueName: "Anchor", position: 0 },
        { venueId: "venue-b", venueName: "Second", position: 1 },
        { venueId: "venue-c", venueName: "Third", position: 2 },
      ],
      expectedRouteRevision: 1,
      authority: { groundingProof: "signed-v2", operationKey: "upgrade-op-01" },
    })).toEqual({
      stops: [
        { venueId: "venue-a", venueName: "Anchor" },
        { venueId: "venue-b", venueName: "Second" },
        { venueId: "venue-c", venueName: "Third" },
      ],
      expectedRouteRevision: 1,
      groundingProof: "signed-v2",
      operationKey: "upgrade-op-01",
    });
  });

  it("hides anchored route editing from guests but keeps it for the host", () => {
    expect(canBeginPlanRouteEdit({
      hasMemberToken: true,
      collaborationAuthorized: true,
      isHost: false,
      anchoredPlan: true,
    })).toBe(false);
    expect(canBeginPlanRouteEdit({
      hasMemberToken: true,
      collaborationAuthorized: true,
      isHost: true,
      anchoredPlan: true,
    })).toBe(true);
    expect(canBeginPlanRouteEdit({
      hasMemberToken: true,
      collaborationAuthorized: true,
      isHost: false,
      anchoredPlan: false,
    })).toBe(true);
  });
});

describe("refreshedRouteRejection", () => {
  const route = [
    { venueId: "venue-a", venueName: "Anchor", position: 0 },
    { venueId: "venue-b", venueName: "Second", position: 1 },
    { venueId: "venue-c", venueName: "Third", position: 2 },
  ];

  it("prints the server's own sentence for an anchor conflict answered with no Stops", () => {
    expect(refreshedRouteRejection(
      { outcome: "anchor-conflict", stops: [], message: "That pub is closed tonight." },
      [],
      3,
    )).toBe("That pub is closed tonight.");
  });

  it("names the anchor conflict even when the server sent no sentence", () => {
    expect(refreshedRouteRejection({ outcome: "anchor-conflict", stops: [] }, [], 3))
      .toBe("We could not build a route from that pub right now. Try a different pub.");
  });

  it("falls back to the empty-route sentence for an ordinary short answer", () => {
    expect(refreshedRouteRejection({ stops: [] }, [], 3))
      .toBe("Couldn't get 3 good stops that time. Give it another go.");
  });

  it("rejects nothing when the refreshed route is usable", () => {
    expect(refreshedRouteRejection({ stops: route }, route, 3)).toBeNull();
  });
});

describe("stopsFromConcierge", () => {
  it("threads grounded concierge ids and names into the Plan composer", () => {
    expect(stopsFromConcierge([
      { id: " venue-1 ", name: " The George " },
      { id: "", name: "Invented Arms" },
    ])).toEqual([{ venueId: "venue-1", venueName: "The George" }]);
  });
});

describe("stopsFromAnswerCards", () => {
  it("threads answerFromBody cards (venue-ranking shape) into plan stops", () => {
    expect(stopsFromAnswerCards([
      { venueId: "venue-1", title: "The George" },
      { venueId: "venue-2", title: "The Swan" },
    ])).toEqual([
      { venueId: "venue-1", venueName: "The George" },
      { venueId: "venue-2", venueName: "The Swan" },
    ]);
  });

  it("threads answerFromBody cards (What's-On listings shape) into plan stops", () => {
    // An occasion template whose text names a kind ("pub quiz tonight near
    // me") answers from grounded What's-On listings, not ranked venues —
    // answerFromBody normalises both into the same {venueId, title} card
    // shape, so the same stop-mapping applies here honestly.
    expect(stopsFromAnswerCards([
      { venueId: "venue-quiz", title: "Pub quiz — Sundays" },
    ])).toEqual([{ venueId: "venue-quiz", venueName: "Pub quiz — Sundays" }]);
  });

  it("drops a card whose venueId never resolved rather than inventing a stop", () => {
    expect(stopsFromAnswerCards([
      { venueId: "", title: "Some listing with no resolved venue" },
    ])).toEqual([]);
  });
});
