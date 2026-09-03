import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const REQUEST_NOW = Date.parse("2026-07-20T12:00:00.000Z");

const { currentEvent, routeWideEvent, loadConciergeVenuesMock } = vi.hoisted(() => ({
  currentEvent: {
    id: "music:venue-3:20260720",
    venueId: "venue-3",
    placeName: "Venue venue-3",
    kind: "music" as const,
    startsAt: "2026-07-20T17:00:00.000Z",
    endsAt: "2026-07-20T18:30:00.000Z",
    title: "Current Monday music",
    source: { label: "Venue programme", url: "https://venue.example/music" },
    observedAt: "2026-07-20T10:00:00.000Z",
    confidence: "confirmed" as const,
  },
  routeWideEvent: {
    id: "music:venue-3:20260720-route-wide",
    venueId: "venue-3",
    placeName: "Venue venue-3",
    kind: "music" as const,
    startsAt: "2026-07-20T16:00:00.000Z",
    endsAt: "2026-07-20T21:00:00.000Z",
    title: "Route-wide Monday music",
    source: { label: "Venue programme", url: "https://venue.example/route-wide-music" },
    observedAt: "2026-07-20T10:00:00.000Z",
    confidence: "confirmed" as const,
  },
  loadConciergeVenuesMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: vi.fn(async () => false) };
});
vi.mock("@/lib/concierge/venues.server", () => ({
  loadConciergeVenues: loadConciergeVenuesMock,
}));
vi.mock("@/lib/whatsOnStore", () => ({
  loadBaselineWhatsOn: () => [currentEvent, routeWideEvent],
}));
vi.mock("@/lib/planGenerationSelection.server", () => ({
  selectPlanGenerationCandidates: vi.fn(async (candidates: unknown[]) => ({
    ok: true,
    legacy: true,
    chosen: candidates.slice(0, 3),
  })),
}));
vi.mock("@/public/data/weather/latest.json", () => ({
  default: {
    version: 1,
    generatedAt: "2026-07-20T11:55:00.000Z",
    observations: [{
      nightArea: "clapham",
      observedAt: "2026-07-20T11:55:00.000Z",
      expiresAt: "2026-07-20T23:00:00.000Z",
      condition: "Clear",
      feelsLikeC: 20,
      precipitationProbabilityPct: 5,
      windKph: 6,
      source: {
        sourceUrl: "https://weather.example/current",
        publisher: "Current Weather",
        publishedAt: "2026-07-20T11:55:00.000Z",
      },
    }],
  },
}));
vi.mock("@/public/data/night_signals/latest.json", () => ({
  default: {
    version: 1,
    generatedAt: "2026-07-20T11:30:00.000Z",
    claims: [
      {
        id: "signal:venue-4:current",
        kind: "event",
        entity: { type: "venue", id: "venue-4" },
        claim: "A reviewed current signal favours venue 4.",
        sourceUrl: "https://venue.example/current-signal",
        publisher: "Venue Example",
        publishedAt: "2026-07-20T10:00:00.000Z",
        observedAt: "2026-07-20T10:30:00.000Z",
        expiresAt: "2026-07-20T22:00:00.000Z",
        confidence: 0.9,
        reviewState: "approved",
        verification: "manual_review",
        routeEffect: "boost",
        corroboratingSources: [],
        reviewedAt: "2026-07-20T11:00:00.000Z",
        reviewAuthority: "operations",
      },
      {
        id: "safety:venue-1:current",
        kind: "transport",
        entity: { type: "venue", id: "venue-1" },
        claim: "A reviewed current safety issue excludes venue 1.",
        sourceUrl: "https://venue.example/current-safety",
        publisher: "Venue Example",
        publishedAt: "2026-07-20T10:00:00.000Z",
        observedAt: "2026-07-20T10:30:00.000Z",
        expiresAt: "2026-07-20T22:00:00.000Z",
        confidence: 0.9,
        reviewState: "approved",
        verification: "manual_review",
        routeEffect: "avoid",
        corroboratingSources: [],
        reviewedAt: "2026-07-20T11:00:00.000Z",
        reviewAuthority: "operations",
      },
    ],
  },
}));

import { POST } from "@/app/api/plans/generate/route";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { planTemporalEvidence } from "@/lib/planGenerationTemporalEvidence";
import type { PlanIntakeHandoff } from "@/lib/planIntake";

type GeneratedBody = {
  weatherEvidence: null | { kind: string; source: { publisher: string } };
  contextEffects: string[];
  nightSignalClaims: Array<{ id: string }>;
  stops: Array<{
    venueId: string;
    evidence: string[];
    provenance: Array<{ label: string }>;
  }>;
};

function venue(id: string, options: Partial<ConciergeVenue> = {}): ConciergeVenue {
  const index = Number(id.replace(/\D/g, ""));
  return {
    id,
    name: `Venue ${id}`,
    area: "Lambeth",
    lat: 51.462 + index * 0.001,
    lng: -0.138 + index * 0.001,
    cheapestPrice: 5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...options,
  };
}

function intake(exactStartIso: string): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: {
      id: "after-work",
      start: "17:30",
      end: "20:30",
      exactStartIso,
    },
    groupSize: 1,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: [],
  };
}

async function generate(body: object): Promise<{ response: Response; body: GeneratedBody }> {
  const response = await POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() as GeneratedBody };
}

describe("Plan generation temporal evidence", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(REQUEST_NOW);
    loadConciergeVenuesMock.mockReset();
    loadConciergeVenuesMock.mockResolvedValue([
      venue("venue-1"),
      venue("venue-2", { amenities: { beerGarden: true, cocktails: false, food: false, liveSports: false, liveMusic: false } }),
      venue("venue-3"),
      venue("venue-4"),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("omits request-time-only evidence from a future dated route", async () => {
    const { response, body } = await generate({
      query: "A beer garden with live music in Clapham",
      intake: intake("2026-07-27T16:30:00.000Z"),
    });

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.weatherEvidence).toBeNull();
    expect(body.contextEffects).not.toContain("weather");
    expect(body.nightSignalClaims).toEqual([]);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toContain("venue-1");
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).not.toContain("venue-4");
    expect(body.stops.flatMap((stop: { evidence: string[] }) => stop.evidence).join(" ")).not.toContain("Tonight:");
    expect(body.stops.flatMap((stop: { provenance: Array<{ label: string }> }) => stop.provenance)
      .map((source: { label: string }) => source.label)).not.toContain("Venue programme: Current Monday music");
  });

  it("uses scheduled evidence that overlaps a dated route but omits current-only weather", async () => {
    const { response, body } = await generate({
      query: "A beer garden with live music in Clapham",
      intake: intake("2026-07-20T16:30:00.000Z"),
    });

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.weatherEvidence).toBeNull();
    expect(body.nightSignalClaims).toEqual([
      expect.objectContaining({ id: "signal:venue-4:current" }),
    ]);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).not.toContain("venue-1");
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toContain("venue-4");
    const venueThreeEvidence = body.stops.find((stop: { venueId: string }) => stop.venueId === "venue-3")?.evidence ?? [];
    expect(venueThreeEvidence).toContain("Tonight: Route-wide Monday music (confirmed)");
    expect(venueThreeEvidence).not.toContain("Tonight: Current Monday music (confirmed)");
  });

  it("preserves request-time evidence for legacy requests without an intake", async () => {
    const { response, body } = await generate({
      query: "A beer garden with live music in Clapham",
    });

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.weatherEvidence).toMatchObject({
      kind: "warm-dry",
      source: { publisher: "Current Weather" },
    });
    expect(body.contextEffects).toContain("weather");
    expect(body.nightSignalClaims).toEqual([
      expect.objectContaining({ id: "signal:venue-4:current" }),
    ]);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(
      expect.arrayContaining(["venue-2", "venue-3", "venue-4"]),
    );
  });

  it("keeps partial avoid claims as a conservative fence but rejects partial boosts", () => {
    const claim = (id: string, routeEffect: "avoid" | "boost") => ({
      id,
      kind: "transport",
      entity: { type: "venue", id: `venue-${id}` },
      claim: `${routeEffect} claim`,
      sourceUrl: "https://venue.example/signal",
      publisher: "Venue Example",
      publishedAt: "2026-07-20T10:00:00.000Z",
      observedAt: "2026-07-20T10:30:00.000Z",
      expiresAt: "2026-07-20T18:00:00.000Z",
      confidence: 0.9,
      reviewState: "approved",
      verification: "manual_review",
      routeEffect,
      corroboratingSources: [],
      reviewedAt: "2026-07-20T11:00:00.000Z",
      reviewAuthority: "operations",
    });
    const result = planTemporalEvidence({
      weatherSnapshot: { version: 1, generatedAt: "2026-07-20T11:00:00.000Z", observations: [] },
      nightSignalSnapshot: {
        version: 1,
        generatedAt: "2026-07-20T11:30:00.000Z",
        claims: [claim("avoid", "avoid"), claim("boost", "boost")],
      },
      whatsOnRows: [],
      nightArea: "clapham",
      requestNow: REQUEST_NOW,
      routeWindow: {
        startsAt: "2026-07-20T16:30:00.000Z",
        endsAt: "2026-07-20T20:30:00.000Z",
      },
    });

    expect(result.signalClaims.map((item) => item.id)).toEqual(["avoid"]);
  });
});
