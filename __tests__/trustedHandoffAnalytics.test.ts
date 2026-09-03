import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "@/lib/analyticsEvents";
import {
  crewCommittedEventToken,
  planAcceptedEventTokens,
  planDraftSavedEventToken,
  verifyAnalyticsDeliveryToken,
} from "@/lib/verifiedAnalytics.server";

const occurredAt = "2026-07-24T12:00:00.000Z";
const now = Date.parse(occurredAt) + 1_000;

const validEvents = {
  near_answer_ready: { source: "location", resultBand: "1-3" },
  venue_accepted: {
    source: "near",
    hasArea: true,
    hasDate: false,
    hasProvenance: true,
  },
  planning_handoff_opened: { from: "near", to: "map" },
  planning_handoff_preserved: {
    from: "mobile-route-preview",
    to: "plan",
    venuePreserved: true,
    areaPreserved: true,
    datePreserved: false,
    provenancePreserved: true,
  },
  tonight_result_opened: { kind: "quiz", localityBasis: "remembered-patch" },
  plan_draft_saved: {
    stops: 1,
    grounded: true,
    anchored: true,
    routeReady: false,
    source: "tonight",
  },
  plan_accepted: {
    stops: 3,
    grounded: true,
    anchored: true,
    routeReady: true,
    source: "near",
  },
  crew_committed: {
    source: "shared-plan",
    participants: 3,
    routeReady: true,
  },
} as const;

describe("trusted handoff analytics schemas", () => {
  it.each(Object.entries(validEvents))("accepts exact required props for %s", (name, props) => {
    expect(sanitizeEvent(name, props)).toEqual({ name, props });
  });

  it.each(Object.entries(validEvents).flatMap(([name, props]) => (
    Object.keys(props).map((missing) => [name, props, missing] as const)
  )))("rejects %s when required prop %s is missing", (name, props, missing) => {
    const partial = { ...props } as Record<string, unknown>;
    delete partial[missing];
    expect(sanitizeEvent(name, partial)).toBeNull();
  });

  it("rejects altered outcome discriminators instead of emitting partial events", () => {
    expect(sanitizeEvent("plan_draft_saved", { ...validEvents.plan_draft_saved, stops: 3 })).toBeNull();
    expect(sanitizeEvent("plan_draft_saved", { ...validEvents.plan_draft_saved, routeReady: true })).toBeNull();
    expect(sanitizeEvent("plan_accepted", { ...validEvents.plan_accepted, grounded: false })).toBeNull();
    expect(sanitizeEvent("plan_accepted", { ...validEvents.plan_accepted, routeReady: false })).toBeNull();
    expect(sanitizeEvent("plan_accepted", { ...validEvents.plan_accepted, source: "plan-link" })).toBeNull();
    expect(sanitizeEvent("crew_committed", { ...validEvents.crew_committed, participants: 0 })).toBeNull();
    expect(sanitizeEvent("crew_committed", { ...validEvents.crew_committed, source: "plan-link" })).toBeNull();
  });

  it("drops identifiers, queries, URLs, coordinates, Friend data, capabilities, and free text", () => {
    const unsafe = {
      ...validEvents.venue_accepted,
      venueId: "venue-private",
      planId: "plan-private",
      query: "quiet pint near home",
      url: "https://example.test/?token=secret",
      sourceUrl: "https://example.test/source",
      latitude: 51.5,
      longitude: -0.1,
      friendName: "Private Friend",
      memberCapability: "secret-capability",
      note: "free text",
    };

    expect(sanitizeEvent("venue_accepted", unsafe)).toEqual({
      name: "venue_accepted",
      props: validEvents.venue_accepted,
    });
    expect(JSON.stringify(sanitizeEvent("venue_accepted", unsafe))).not.toMatch(
      /venue-private|plan-private|quiet pint|example\.test|Private Friend|secret-capability|free text|latitude|longitude/,
    );
  });

  it("keeps the no-results event payload empty", () => {
    expect(sanitizeEvent("map_search_no_results", {
      query: "private search",
      coordinates: "51.5,-0.1",
    })).toEqual({ name: "map_search_no_results", props: {} });
  });
});

describe("trusted handoff verified outcome tokens", () => {
  it("binds a draft token to exact one-Stop grounded state and source", () => {
    const token = planDraftSavedEventToken({ planId: "plan-one", savedAt: occurredAt, source: "tonight" });
    const event = { name: "plan_draft_saved" as const, props: validEvents.plan_draft_saved };

    expect(verifyAnalyticsDeliveryToken(token, event, now)).toMatchObject(event);
    expect(verifyAnalyticsDeliveryToken(token, {
      ...event,
      props: { ...event.props, source: "near" },
    }, now)).toBeNull();
    expect(verifyAnalyticsDeliveryToken(token, {
      ...event,
      props: { ...event.props, routeReady: true },
    }, now)).toBeNull();
  });

  it("binds accepted and meaningful tokens to one exact Route-ready transition", () => {
    const first = planAcceptedEventTokens({
      planId: "plan-two",
      acceptedAt: occurredAt,
      anchored: true,
      source: "near",
    });
    const replay = planAcceptedEventTokens({
      planId: "plan-two",
      acceptedAt: occurredAt,
      anchored: true,
      source: "near",
    });
    const event = { name: "plan_accepted" as const, props: validEvents.plan_accepted };

    expect(replay).toEqual(first);
    expect(verifyAnalyticsDeliveryToken(first.planAccepted, event, now)).toMatchObject(event);
    expect(verifyAnalyticsDeliveryToken(first.planAccepted, {
      ...event,
      props: { ...event.props, anchored: false },
    }, now)).toBeNull();
    expect(verifyAnalyticsDeliveryToken(first.planAccepted, {
      ...event,
      props: { ...event.props, stops: 2 },
    }, now)).toBeNull();
    expect(verifyAnalyticsDeliveryToken(first.meaningfulCoreAction, {
      name: "meaningful_core_action",
      props: { action: "plan_accepted" },
    }, now)).toMatchObject({ name: "meaningful_core_action" });
  });

  it("binds crew commitment to server-derived count and Route readiness", () => {
    const token = crewCommittedEventToken({
      joinId: "join-one",
      joinedAt: occurredAt,
      participants: 3,
      routeReady: true,
    });
    const event = { name: "crew_committed" as const, props: validEvents.crew_committed };

    expect(verifyAnalyticsDeliveryToken(token, event, now)).toMatchObject(event);
    expect(verifyAnalyticsDeliveryToken(token, {
      ...event,
      props: { ...event.props, participants: 4 },
    }, now)).toBeNull();
    expect(verifyAnalyticsDeliveryToken(token, {
      ...event,
      props: { ...event.props, routeReady: false },
    }, now)).toBeNull();
  });

  it("expires at the exact signed boundary", () => {
    const token = planDraftSavedEventToken({ planId: "plan-expiry", savedAt: occurredAt, source: "tonight" });
    const event = { name: "plan_draft_saved" as const, props: validEvents.plan_draft_saved };
    const expiresAt = Date.parse(occurredAt) + 30 * 24 * 60 * 60 * 1_000;

    expect(verifyAnalyticsDeliveryToken(token, event, expiresAt - 1)).not.toBeNull();
    expect(verifyAnalyticsDeliveryToken(token, event, expiresAt)).toBeNull();
  });
});
