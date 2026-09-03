import { describe, expect, it } from "vitest";

import { buildInvitePrivacyPreview, type InvitePrivacyPreviewDTO } from "@/lib/invitePrivacyPreview";
import type { PlanState } from "@/lib/plan";
import type { VibeTally } from "@/lib/vibeTally";

function makePlanState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    plan: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Friday Night Out",
      startTime: "2026-07-18T19:00:00.000Z",
      createdAt: "2026-07-15T12:00:00.000Z",
      routeRevision: 1,
      status: "ready",
    },
    stops: [
      { venueId: "venue-secret-1", venueName: "The Hidden Arms", position: 0 },
      { venueId: "venue-secret-2", venueName: "The Undisclosed Tap", position: 1 },
      { venueId: "venue-secret-3", venueName: "Mystery Cellar Bar", position: 2 },
    ],
    crew: [
      { id: "member-1", name: "Alice", status: "in", joinedAt: "2026-07-15T12:00:00.000Z", updatedAt: "2026-07-15T12:00:00.000Z" },
      { id: "member-2", name: "Bob", status: "in", joinedAt: "2026-07-15T12:01:00.000Z", updatedAt: "2026-07-15T12:01:00.000Z" },
    ],
    context: {
      nightArea: "shoreditch",
      daypart: "evening",
      partyType: "friends",
      groupSize: 4,
      budget: "standard",
      budgetLimitPence: null,
      zeroProof: false,
      wetherspoonsPreferred: false,
      atmosphere: ["lively"],
      foodNeeds: [],
      accessibility: ["step-free"],
      transportConstraints: [],
    },
    actions: [],
    ending: null,
    ...overrides,
  };
}

function makeTally(top: string | null): VibeTally {
  return {
    total: top ? 2 : 0,
    counts: top ? [{ vibe: top as VibeTally["top"] & string, count: 2 }] : [],
    top: top as VibeTally["top"],
  };
}

describe("buildInvitePrivacyPreview", () => {
  it("returns the host name from the first crew member", () => {
    const result = buildInvitePrivacyPreview(makePlanState());
    expect(result.hostName).toBe("Alice");
  });

  it("falls back to 'Your host' when the crew is empty", () => {
    const result = buildInvitePrivacyPreview(makePlanState({ crew: [] }));
    expect(result.hostName).toBe("Your host");
  });

  it("resolves a night area slug to a human-readable area name", () => {
    const result = buildInvitePrivacyPreview(makePlanState());
    expect(result.areaName).toBe("Shoreditch");
  });

  it("returns null areaName when there is no night context", () => {
    const result = buildInvitePrivacyPreview(makePlanState({ context: null }));
    expect(result.areaName).toBeNull();
  });

  it("returns null areaName when nightArea is null on the context", () => {
    const state = makePlanState();
    const result = buildInvitePrivacyPreview({
      ...state,
      context: { ...state.context!, nightArea: null },
    });
    expect(result.areaName).toBeNull();
  });

  it("returns an unknown area slug as null rather than inventing a label", () => {
    const state = makePlanState();
    const result = buildInvitePrivacyPreview({
      ...state,
      context: { ...state.context!, nightArea: "unknown-slug" as never },
    });
    expect(result.areaName).toBeNull();
  });

  it("formats the start time in hh:mm (London time)", () => {
    const result = buildInvitePrivacyPreview(makePlanState());
    // 2026-07-18T19:00:00.000Z is 20:00 London BST
    expect(result.startLabel).toBe("20:00");
  });

  it("returns a fallback label for an unparseable start time", () => {
    const state = makePlanState();
    const result = buildInvitePrivacyPreview({
      ...state,
      plan: { ...state.plan, startTime: "not-a-date" },
    });
    expect(result.startLabel).toBe("Time to be confirmed");
  });

  it("reports the stop count without exposing any venue names", () => {
    const result = buildInvitePrivacyPreview(makePlanState());
    expect(result.stopCount).toBe(3);
    // The DTO must not carry any venueId or venueName fields
    const keys = Object.keys(result);
    expect(keys).not.toContain("venueId");
    expect(keys).not.toContain("venueName");
    expect(keys).not.toContain("stops");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("venue-secret");
    expect(serialised).not.toContain("Hidden Arms");
    expect(serialised).not.toContain("Undisclosed");
    expect(serialised).not.toContain("Mystery Cellar");
  });

  it("returns the top vibe chip label when a tally is supplied", () => {
    const result = buildInvitePrivacyPreview(makePlanState(), makeTally("bender"));
    expect(result.vibeLabel).toBe("Big one tonight");
  });

  it("returns null vibeLabel when the tally has no top vibe", () => {
    const result = buildInvitePrivacyPreview(makePlanState(), makeTally(null));
    expect(result.vibeLabel).toBeNull();
  });

  it("returns null vibeLabel when no tally is provided", () => {
    const result = buildInvitePrivacyPreview(makePlanState());
    expect(result.vibeLabel).toBeNull();
  });

  it("summarises accessibility requirements as a comma-separated string", () => {
    const state = makePlanState();
    const result = buildInvitePrivacyPreview({
      ...state,
      context: { ...state.context!, accessibility: ["step-free", "hearing loop"] },
    });
    expect(result.accessibilitySummary).toBe("step-free, hearing loop");
  });

  it("returns null accessibilitySummary when the context has no accessibility requirements", () => {
    const state = makePlanState();
    const result = buildInvitePrivacyPreview({
      ...state,
      context: { ...state.context!, accessibility: [] },
    });
    expect(result.accessibilitySummary).toBeNull();
  });

  it("returns null accessibilitySummary when there is no night context", () => {
    const result = buildInvitePrivacyPreview(makePlanState({ context: null }));
    expect(result.accessibilitySummary).toBeNull();
  });

  it("returns a complete DTO with all expected fields and no extra secrets", () => {
    const tally = makeTally("lit");
    const result = buildInvitePrivacyPreview(makePlanState(), tally);
    const expected: InvitePrivacyPreviewDTO = {
      hostName: "Alice",
      areaName: "Shoreditch",
      startLabel: "20:00",
      stopCount: 3,
      vibeLabel: "Live and loud",
      accessibilitySummary: "step-free",
    };
    expect(result).toEqual(expected);
  });
});
