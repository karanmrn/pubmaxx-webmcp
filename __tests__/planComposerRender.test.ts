import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AcceptedContextPanel,
  PLAN_INTAKE_CONFLICT_NO_ROUTE,
  PLAN_INTAKE_CONFLICT_READER,
  PLAN_INTAKE_CONFLICT_SERVER,
  PlanComposerErrorNotice,
  acceptedPlanAreaLabel,
  errorMessageFromBody,
  planGenerationFailureStatus,
  acceptedStop1RemoveLabel,
  acceptedStop1SwapLabel,
  planComposerShowsDescribeFirst,
  planComposerShowsIntake,
  releasedAcceptanceStatus,
} from "@/components/plan/PlanComposer";
import {
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
} from "@/lib/planDraft";
import {
  composerLockErrorFromResponse,
  resolveComposerHydration,
} from "@/lib/planComposerHandoff";
import { createPlanningIntent } from "@/lib/planningIntent";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function intent() {
  return createPlanningIntent({
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-intent",
    acceptedArea: { kind: "night-patch", id: "soho" },
    startsAt: "2026-07-24T20:00:00.000Z",
    displayEvidence: { kind: "directory", observedAt: null },
  }, NOW);
}

function v2Plan(savedAt: number): ParsedPlanDraft {
  const storage = memoryStorage();
  writePlanDraftEnvelope({
    title: "Friday Plan",
    creatorName: "K",
    startTime: "2026-07-24T18:00:00.000Z",
    conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
  }, "manual", storage, savedAt);
  return readPlanDraftEnvelope(storage, savedAt) as ParsedPlanDraft;
}

describe("PlanComposer rendered UI", () => {
  it("renders accepted context before intake completion", () => {
    const handoff = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));

    expect(handoff.showAcceptedSummary).toBe(true);
    expect(html).toContain("Carried over from what you accepted");
    // The id is what we call a row, never what a person calls a pub, and a pin
    // promoted out of the UK base layer never reaches the slim index at all.
    expect(html).not.toContain("venue-intent");
    expect(html).toContain("The pub you kept");
  });

  it("renders the accepted Venue/area/date summary and marks area+date answered so intake never re-asks", () => {
    const handoff = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));

    expect(html).toContain("Carried over from what you accepted");
    expect(html).not.toContain("venue-intent");
    expect(html).toContain("The pub you kept");
    expect(html).toContain("Piccadilly &amp; Soho");
    expect(html).not.toContain(">soho<");
    expect(html).toContain("Jul"); // London service-date label for the accepted start
    expect(html).toContain("You can change the area and the date below.");
    expect(html).toContain("Stop 1 stays this pub until you release it.");
    expect(html).toContain("Releasing keeps every stop.");
    // The same hydration marks area + date answered, which is what suppresses the
    // area/date intake steps (PlanIntake is seeded settled; untouched here per the hold).
    expect(handoff.answeredArea).toBe(true);
    expect(handoff.answeredDate).toBe(true);

    // A resolved name always wins over the neutral label.
    const named = renderToStaticMarkup(createElement(AcceptedContextPanel, {
      handoff,
      acceptedVenueName: "The Accepted Arms",
    }));
    expect(named).toContain("The Accepted Arms");
    expect(named).not.toContain("The pub you kept");
  });

  it("renders the way out of a held acceptance beside the summary", () => {
    // The regression this pins: Stop 1 could not be released at all, so the
    // accepted pub was held for the whole PlanningIntent TTL.
    const handoff = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, {
      handoff,
      onRelease: () => undefined,
    }));

    expect(html).toContain("Release this pub");
    expect(html).toContain("planComposer__acceptedRelease");

    // A panel with no release offered says nothing about releasing.
    const withoutRelease = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));
    expect(withoutRelease).not.toContain("planComposer__acceptedRelease");
  });

  it("renders the 'kept existing Plan work' conflict note when a newer Plan draft beats a newer intent", () => {
    const handoff = resolveComposerHydration({
      planDraft: v2Plan(NOW + 2_000), routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    expect(handoff.conflicts.map((conflict) => conflict.code)).toContain("intent-preserved-existing");

    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));
    expect(html).toContain("Plan changes we kept safe");
    expect(html).toContain("Kept existing Plan work");
  });

  it("renders the anchored 422 and 409 lock-failure recovery copy in the alert banner", () => {
    const copy422 = composerLockErrorFromResponse(422);
    const copy409 = composerLockErrorFromResponse(409);
    expect(copy422).not.toBeNull();
    expect(copy409).not.toBeNull();

    const html422 = renderToStaticMarkup(createElement(PlanComposerErrorNotice, { message: copy422 as string }));
    expect(html422).toContain('role="alert"');
    expect(html422).toContain("planComposer__error");
    expect(html422).toMatch(/refresh|regenerate/i);

    const html409 = renderToStaticMarkup(createElement(PlanComposerErrorNotice, { message: copy409 as string }));
    expect(html409).toContain('role="alert"');
    expect(html409).toMatch(/already locked/i);
  });

  it("never claims an earlier route in the error notice when no route is on screen", () => {
    // Repro: a fresh /plan, POST /api/plans/generate answers 422
    // PLAN_INTAKE_MALFORMED and no stop rows are rendered. The notice used to
    // take errorMessageFromBody straight, so it told the reader the earlier
    // route was still here when there was none.
    const body = {
      error: {
        code: "PLAN_INTAKE_MALFORMED",
        message: PLAN_INTAKE_CONFLICT_SERVER,
      },
    };
    const thrown = errorMessageFromBody(body, "PUBMAXX could not sort this one.");

    const noRoute = planGenerationFailureStatus(thrown, false);
    const noRouteHtml = renderToStaticMarkup(
      createElement(PlanComposerErrorNotice, { message: noRoute }),
    );
    expect(noRouteHtml).toContain('role="alert"');
    expect(noRouteHtml).toContain(PLAN_INTAKE_CONFLICT_NO_ROUTE);
    expect(noRouteHtml).not.toMatch(/earlier route|previous route/i);
    // The server plumbing string never reaches a reader either.
    expect(noRouteHtml).not.toContain("intake");

    const withRoute = planGenerationFailureStatus(thrown, true);
    const withRouteHtml = renderToStaticMarkup(
      createElement(PlanComposerErrorNotice, { message: withRoute }),
    );
    expect(withRouteHtml).toContain(PLAN_INTAKE_CONFLICT_READER);

    // One sentence, both surfaces: the notice prints exactly what
    // #plan-route-status prints, so the two can never contradict each other.
    expect(noRoute).not.toBe(withRoute);
  });

  it("prints the night area name, never the slug", () => {
    expect(acceptedPlanAreaLabel({ kind: "night-patch", id: "clapham" })).toBe("Clapham");
    expect(acceptedPlanAreaLabel({ kind: "night-patch", id: "soho" })).toBe("Piccadilly & Soho");
    expect(acceptedPlanAreaLabel({ kind: "borough", name: "Camden" })).toBe("Camden");
    // Hackney has no generator area on purpose, so its own patch label answers
    // rather than the raw slug.
    expect(acceptedPlanAreaLabel({ kind: "night-patch", id: "hackney" })).toBe("Hackney");

    const clapham = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: createPlanningIntent({
        source: "near",
        cityId: "london",
        acceptedVenueId: "venue-intent",
        acceptedArea: { kind: "night-patch", id: "clapham" },
        startsAt: "2026-07-24T20:00:00.000Z",
        displayEvidence: { kind: "directory", observedAt: null },
      }, NOW),
      rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff: clapham }));
    expect(html).toContain("Clapham");
    expect(html).not.toContain(">clapham<");
  });

  it("names the two disabled Stop 1 actions apart", () => {
    expect(acceptedStop1SwapLabel("The Coach & Horses")).toBe(
      "The Coach & Horses is the accepted Stop 1. Swap is not available.",
    );
    expect(acceptedStop1RemoveLabel("The Coach & Horses")).toBe(
      "The Coach & Horses is the accepted Stop 1. Remove is not available.",
    );
    expect(acceptedStop1SwapLabel("The Coach & Horses"))
      .not.toBe(acceptedStop1RemoveLabel("The Coach & Horses"));
  });

  it("hides describe-first only while a pub is held", () => {
    expect(planComposerShowsDescribeFirst({
      heldVenueId: "venue-kept",
      completed: false,
      entryMode: "describe",
    })).toBe(false);
    expect(planComposerShowsIntake({
      heldVenueId: "venue-kept",
      completed: false,
      entryMode: "describe",
    })).toBe(false);
    expect(planComposerShowsDescribeFirst({
      heldVenueId: null,
      completed: false,
      entryMode: "describe",
    })).toBe(true);
  });

  it("restores describe-first after the held pub is released, even if a route draft is still on the page", () => {
    expect(planComposerShowsDescribeFirst({
      heldVenueId: null,
      completed: false,
      entryMode: "describe",
    })).toBe(true);
    expect(planComposerShowsIntake({
      heldVenueId: null,
      completed: false,
      entryMode: "describe",
    })).toBe(false);
  });

  it("keeps the unfinished wizard for a returning visitor", () => {
    expect(planComposerShowsIntake({
      heldVenueId: null,
      completed: false,
      entryMode: "wizard",
    })).toBe(true);
    expect(planComposerShowsIntake({
      heldVenueId: null,
      completed: true,
      entryMode: "describe",
    })).toBe(true);
  });

  it("states the release without claiming the route is gone", () => {
    expect(releasedAcceptanceStatus({
      venueName: "The Coach & Horses",
      routeStale: false,
    })).toBe("Released The Coach & Horses. Stop 1 is yours to change.");
    expect(releasedAcceptanceStatus({
      venueName: null,
      routeStale: false,
    })).toBe("Released this pub. Stop 1 is yours to change.");
  });

  it("keeps a stale-route reason instead of overwriting it on release", () => {
    expect(releasedAcceptanceStatus({
      venueName: "The Coach & Horses",
      routeStale: true,
      staleStatus: "Route needs refreshing after that context change.",
    })).toBe("Route needs refreshing after that context change.");
  });
});
