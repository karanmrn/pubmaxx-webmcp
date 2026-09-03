import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VenueOccupancyRow from "@/components/map/VenueOccupancyRow";
import type { OccupancyNowAnswer } from "@/lib/occupancy";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  session: null as { access_token: string; user: { id: string } } | null,
  identityResolved: true,
}));

const viewerState = vi.hoisted(() => ({
  current: {
    phase: "signed-out" as "unresolved" | "signed-in" | "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  },
}));

const occupancyState = vi.hoisted(() => ({
  reading: {
    now: null,
    ageMinutes: null,
    reportersLast90: 0,
    degraded: false,
    state: "none",
    id: null,
  } as OccupancyNowAnswer | null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    identityResolved: authState.identityResolved,
  }),
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => viewerState.current,
}));

vi.mock("@/components/map/useVenueOccupancy", () => ({
  trackOccupancyRead: () => undefined,
  useVenueOccupancy: () => ({
    reading: occupancyState.reading,
    report: async () => ({ ok: false, error: "unused" }),
    reporting: false,
    error: null,
    reload: async () => undefined,
  }),
  confirmOccupancyProposal: async () => ({ ok: false, error: "unused" }),
  flagVenueOccupancy: async () => ({ ok: false, error: "unused" }),
}));

function signedIn(): void {
  authState.user = { id: "user-a" };
  authState.session = { access_token: "token", user: { id: "user-a" } };
  viewerState.current = {
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  };
}

function render(props: { revealRecord?: boolean; revealRecordLate?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(VenueOccupancyRow, { venueId: "venue-1", ...props }),
  );
}

beforeEach(() => {
  authState.user = null;
  authState.session = null;
  authState.identityResolved = true;
  viewerState.current = {
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  };
  occupancyState.reading = {
    now: null,
    ageMinutes: null,
    reportersLast90: 0,
    degraded: false,
    state: "none",
    id: null,
  };
});

describe("occupancy venue surface", () => {
  it("asks one question and offers the three now buttons", () => {
    signedIn();

    const html = render();

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("Empty");
    expect(html).toContain("Some seats");
    expect(html).toContain("Full");
    expect(html).toContain("No fresh reading");
    expect(html).not.toContain("quiet");
    expect(html).not.toContain("rammed");
  });

  it("asks a signed-out visitor to sign in and still shows the reading", () => {
    const html = render();

    expect(html).toContain("How busy is it right now?");
    expect(html).toContain("No fresh reading");
    expect(html).toContain("Sign in to report");
    expect(html).toContain('href="/login?mode=signin&amp;from=%2Fmap%3Fsel%3Dvenue-1"');
    expect(html).not.toContain(">Empty<");
  });

  it("prints a fresh reading with its age, and greys an empty one", () => {
    signedIn();
    occupancyState.reading = {
      now: "some-seats",
      ageMinutes: 12,
      reportersLast90: 1,
      degraded: false,
      state: "fresh",
      id: "occ-1",
    };

    const dated = render();
    expect(dated).toContain("Some seats · 12 min ago · 1 person");
    expect(dated).not.toContain("venueOccupancyReading--empty");
    expect(dated).not.toContain("aria-pressed");
    expect(dated).toContain("Report this crowd reading");

    occupancyState.reading = {
      now: null,
      ageMinutes: null,
      reportersLast90: 0,
      degraded: false,
      state: "stale",
      id: null,
    };

    const aged = render();
    expect(aged).toContain("No fresh reading");
    expect(aged).toContain("venueOccupancyReading--empty");
  });

  it("reveals only a dated live reading", () => {
    signedIn();
    occupancyState.reading = {
      now: "some-seats",
      ageMinutes: 12,
      reportersLast90: 1,
      degraded: false,
      state: "fresh",
      id: "occ-1",
    };

    const html = render({ revealRecord: true });
    expect(html).toContain('class="venueOccupancyReading venueRevealRecord"');
    expect(html).toContain('data-reveal-delay="2"');
  });

  it("reveals a late dated reading without replaying the entrance delay", () => {
    signedIn();
    occupancyState.reading = {
      now: "some-seats",
      ageMinutes: 12,
      reportersLast90: 1,
      degraded: false,
      state: "fresh",
      id: "occ-1",
    };

    const html = render({ revealRecord: true, revealRecordLate: true });
    expect(html).toContain('class="venueOccupancyReading venueRevealRecord"');
    expect(html).not.toContain('data-reveal-delay="2"');
  });

  it("says a failed read could not be checked, never that nobody reported", () => {
    signedIn();
    occupancyState.reading = {
      now: null,
      ageMinutes: null,
      reportersLast90: 0,
      degraded: true,
      state: "degraded",
      id: null,
    };

    const html = render();
    expect(html).toContain("Could not check how busy it is.");
    expect(html).not.toContain("No fresh reading");
  });

  it("never announces the ticking age, and keeps one live region for the receipt", () => {
    signedIn();
    occupancyState.reading = {
      now: "some-seats",
      ageMinutes: 12,
      reportersLast90: 1,
      degraded: false,
      state: "fresh",
      id: "occ-1",
    };

    const html = render();
    const readingTag = html.match(/<p[^>]*venueOccupancyReading[^>]*>/)?.[0] ?? "";
    expect(readingTag).not.toContain("aria-live");
    expect(html).toContain('role="status"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it("names nobody and offers no door until identity resolves", () => {
    authState.identityResolved = false;
    viewerState.current = {
      phase: "unresolved",
      signedIn: false,
      signedOut: false,
      unresolved: true,
    };

    const html = render();
    expect(html).toContain("How busy is it right now?");
    expect(html).not.toContain("Sign in to report");
    expect(html).not.toContain(">Empty<");
  });
});
