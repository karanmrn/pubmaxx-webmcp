import { describe, expect, it, vi } from "vitest";

const whatsOn = vi.hoisted(() => ({
  readStatus: "ready" as "ready" | "degraded",
  rows: [] as unknown[],
}));

vi.mock("@/lib/whatsOnStore", () => ({
  loadWhatsOn: vi.fn(async () => ({
    rows: whatsOn.rows,
    readStatus: whatsOn.readStatus,
    asOf: null,
    kindObservedAt: {},
    localityBasis: "london-default",
    revalidation: { status: "measured" },
  })),
}));

import {
  defaultStepOutNudgeSelectDeps,
  selectOwedStepOutNudge,
  type StepOutNudgeSelectDeps,
} from "@/lib/stepOutNudgeSelect.server";
import type { WantedDTO } from "@/lib/wanted";

const ACTOR = "profile:22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-08T18:00:00.000Z");

function wanted(partial: Partial<WantedDTO> & Pick<WantedDTO, "venueId" | "venueName">): WantedDTO {
  return {
    id: "wanted-1",
    ownerActor: ACTOR,
    venueKind: "curated",
    sourceUrl: "",
    sourcePlatform: "none",
    note: "",
    rawPaste: "",
    status: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    fulfilledAt: null,
    promotedListType: null,
    promotedAt: null,
    ...partial,
  };
}

describe("selectOwedStepOutNudge", () => {
  it("returns null when nothing is owed", async () => {
    const deps: StepOutNudgeSelectDeps = {
      listOpenWanteds: async () => [],
      nightAreaForAccount: async () => "clapham",
      venueCoords: async () => null,
      listOpenSoftPlans: async () => [],
      listTonightDeals: async () => [],
    };
    expect(await selectOwedStepOutNudge(ACTOR, ACCOUNT, NOW, deps)).toBeNull();
  });

  it("prefers a nearby Wanted over Soft Plan and deal", async () => {
    const deps: StepOutNudgeSelectDeps = {
      listOpenWanteds: async () => [
        wanted({ venueId: "venue-near", venueName: "The Near" }),
      ],
      nightAreaForAccount: async () => "clapham",
      venueCoords: async () => ({
        name: "The Near",
        // Clapham centre is roughly 51.46, -0.14 — a few hundred metres away.
        lat: 51.462,
        lng: -0.138,
      }),
      listOpenSoftPlans: async () => [{ id: "plan-1", title: "Quiet night" }],
      listTonightDeals: async () => [
        {
          dealTitle: "Half price",
          placeName: "The Deal Pub",
          endsAt: "2026-08-08T20:00:00.000Z",
          sourceLabel: "Pub site",
        },
      ],
    };
    const payload = await selectOwedStepOutNudge(ACTOR, ACCOUNT, NOW, deps);
    expect(payload?.kind).toBe("wanted_nearby");
    expect(payload?.body).toMatch(/The Near/);
    expect(payload?.body).toMatch(/you-ish/);
  });

  it("falls through to Soft Plan when Wanted is not nearby", async () => {
    const deps: StepOutNudgeSelectDeps = {
      listOpenWanteds: async () => [
        wanted({ venueId: "venue-far", venueName: "The Far" }),
      ],
      nightAreaForAccount: async () => "clapham",
      venueCoords: async () => ({
        name: "The Far",
        lat: 51.6,
        lng: 0.2,
      }),
      listOpenSoftPlans: async () => [{ id: "plan-soft", title: "Soft" }],
      listTonightDeals: async () => [],
    };
    const payload = await selectOwedStepOutNudge(ACTOR, ACCOUNT, NOW, deps);
    expect(payload?.kind).toBe("soft_plan_open");
    expect(payload?.url).toBe("/plan/plan-soft");
  });
});

describe("the deals candidate read", () => {
  const dealRow = {
    id: "deal-1",
    kind: "deal",
    title: "Two for one",
    placeName: "The Dove",
    endsAt: "2026-08-08T22:00:00.000Z",
    source: { label: "Pub listing", url: "https://example.com/deal" },
    observedAt: "2026-08-08T09:00:00.000Z",
    confidence: "listed",
    venueId: "venue-dove",
  };

  it("carries tonight's deals when the bundled read answered", async () => {
    whatsOn.readStatus = "ready";
    whatsOn.rows = [dealRow];
    const deals = await defaultStepOutNudgeSelectDeps().listTonightDeals(NOW);
    expect(deals.map((deal) => deal.dealTitle)).toEqual(["Two for one"]);
  });

  it("offers nothing from a read that could not run", async () => {
    // The rows are the artifact's last known set, not tonight's answer: a
    // nudge built off them would name a deal nobody checked was still on.
    whatsOn.readStatus = "degraded";
    whatsOn.rows = [dealRow];
    expect(await defaultStepOutNudgeSelectDeps().listTonightDeals(NOW)).toEqual([]);
  });
});
