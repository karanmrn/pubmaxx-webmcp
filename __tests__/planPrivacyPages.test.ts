import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import PlanSummary from "@/components/plan/PlanSummary";
import PlanCrew from "@/components/plan/PlanCrew";
import { buildPlanPrivacyPreview } from "@/lib/planPrivacy";
import type { PlanState } from "@/lib/plan";

// DAG L10 part 2 — the anonymous server render of the plan-page client
// components must carry the privacy preview only: never a venue id/name, the
// stop order, the user title, or any crew member beyond the host. The full route
// arrives client-side (useEffect, not run here) from the capability-gated API.

const SECRET_TITLE = "Dave's stag do blowout";
const VENUE_A = "The Secret Cellar";
const VENUE_B = "Hidden Tavern";
const GUEST = "Priya";

const state: PlanState = {
  plan: { id: "11111111-1111-4111-8111-111111111111", title: SECRET_TITLE, startTime: "2026-07-24T19:00:00.000Z", createdAt: "2026-07-24T12:00:00.000Z", status: "ready" },
  stops: [
    { venueId: "venue-secret-cellar", venueName: VENUE_A, position: 0 },
    { venueId: "venue-hidden-tavern", venueName: VENUE_B, position: 1 },
  ],
  crew: [
    { id: "c1", name: "Dave", status: "in", joinedAt: "2026-07-24T12:00:00.000Z", updatedAt: "2026-07-24T12:00:00.000Z" },
    { id: "c2", name: GUEST, status: "here", joinedAt: "2026-07-24T12:30:00.000Z", updatedAt: "2026-07-24T12:30:00.000Z" },
  ],
  // Test only reads nightArea + accessibility via buildPlanPrivacyPreview; the
  // full NightContext shape is irrelevant here, so cast through unknown.
  context: { nightArea: "shoreditch", accessibility: [] } as unknown as PlanState["context"],
};

const preview = buildPlanPrivacyPreview(state);

function assertNoLeak(html: string) {
  expect(html).not.toContain(SECRET_TITLE);
  expect(html).not.toContain(VENUE_A);
  expect(html).not.toContain(VENUE_B);
  expect(html).not.toContain("venue-secret-cellar");
  expect(html).not.toContain("venue-hidden-tavern");
}

describe("plan page client components — anonymous render is preview-only", () => {
  it("PlanSummary renders the preview, never the route", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanSummary, { planId: state.plan.id, initialPreview: preview }),
    );
    assertNoLeak(html);
    // The safe host + area signals ARE present.
    expect(html).toContain("Dave");
    expect(html).toContain("Shoreditch");
  });

  it("PlanCrew names only the host, never the guest list", () => {
    const html = renderToStaticMarkup(
      React.createElement(PlanCrew, { planId: state.plan.id, hostName: preview.hostDisplayName }),
    );
    expect(html).toContain("Dave");
    expect(html).not.toContain(GUEST);
    assertNoLeak(html);
  });
});
