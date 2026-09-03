import { describe, expect, it } from "vitest";

import {
  BADGE_EVENTS,
  computeBadgeEventProgress,
  type BadgeEventDefinition,
} from "@/lib/badgeEvents";
import type { ProfileDrop } from "@/lib/profiles";

function drop(overrides: Partial<ProfileDrop> = {}): ProfileDrop {
  return {
    handle: "ken",
    venueId: "venue-1",
    priceGbp: 5,
    createdAt: "2026-07-10T19:00:00.000Z",
    ...overrides,
  };
}

const threeBoroughs: BadgeEventDefinition = {
  id: "three-boroughs-july-2026",
  label: "Three Boroughs July",
  description: "Visit three different boroughs during July.",
  badgeLabel: "Borough Explorer",
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: "2026-08-01T00:00:00.000Z",
  criteria: {
    kind: "distinct-drop-field",
    field: "borough",
    target: 3,
    progressLabel: "boroughs",
  },
};

const riversideThursday: BadgeEventDefinition = {
  id: "riverside-thursday-2026",
  label: "Thames-side Thursday",
  description: "Log one riverside pint on a Thursday during the event window.",
  badgeLabel: "Thames-side Thursday",
  startsAt: "2026-07-01T00:00:00.000Z",
  endsAt: "2026-08-01T00:00:00.000Z",
  criteria: {
    kind: "matching-drops",
    target: 1,
    progressLabel: "qualifying riverside Thursday drops",
    rules: [
      { field: "vibeTags", includes: "riverside" },
      { field: "createdAtWeekdayUtc", equals: 4 },
    ],
  },
};

describe("computeBadgeEventProgress", () => {
  it("returns no quest pressure in legacy mode, even for opted-in active events", () => {
    const progress = computeBadgeEventProgress([drop({ borough: "Camden" })], {
      events: [threeBoroughs],
      now: "2026-07-15T12:00:00.000Z",
      optedInEventIds: new Set([threeBoroughs.id]),
      legacyMode: true,
    });

    expect(progress).toEqual([]);
  });

  it("requires explicit opt-in and only surfaces active event windows", () => {
    const progress = computeBadgeEventProgress([drop({ borough: "Camden" })], {
      events: [
        threeBoroughs,
        {
          ...threeBoroughs,
          id: "past-event",
          startsAt: "2026-06-01T00:00:00.000Z",
          endsAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      now: "2026-07-15T12:00:00.000Z",
      optedInEventIds: new Set([threeBoroughs.id, "past-event"]),
    });

    expect(progress.map((p) => p.event.id)).toEqual([threeBoroughs.id]);
  });

  it("counts only drops inside the event window and after the opt-in time", () => {
    const progress = computeBadgeEventProgress(
      [
        drop({ borough: "Camden", createdAt: "2026-06-30T23:00:00.000Z" }),
        drop({ borough: "Hackney", createdAt: "2026-07-04T19:00:00.000Z" }),
        drop({ borough: "Southwark", createdAt: "2026-07-12T19:00:00.000Z" }),
        drop({ borough: "Lambeth", createdAt: "2026-07-13T19:00:00.000Z" }),
      ],
      {
        events: [threeBoroughs],
        now: "2026-07-15T12:00:00.000Z",
        optedInEventIds: new Set([threeBoroughs.id]),
        optedInAtByEventId: new Map([[threeBoroughs.id, "2026-07-10T00:00:00.000Z"]]),
      },
    );

    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      current: 2,
      target: 3,
      earned: false,
      label: "2 of 3 boroughs",
    });
  });

  it("awards an earned event badge only when the declarative criteria match real drop data", () => {
    const progress = computeBadgeEventProgress(
      [
        drop({
          vibeTags: ["riverside"],
          createdAt: "2026-07-09T19:00:00.000Z", // Thursday UTC
        }),
      ],
      {
        events: [riversideThursday],
        now: "2026-07-15T12:00:00.000Z",
        optedInEventIds: new Set([riversideThursday.id]),
      },
    );

    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      current: 1,
      target: 1,
      earned: true,
      label: "1 of 1 qualifying riverside Thursday drops",
      badge: {
        id: "event-riverside-thursday-2026",
        label: "Thames-side Thursday",
        earned: true,
      },
    });
  });

  it("ships a non-volume seasonal catalogue with finite windows", () => {
    expect(BADGE_EVENTS.length).toBeGreaterThan(0);
    expect(BADGE_EVENTS.every((event) => event.startsAt < event.endsAt)).toBe(true);
    expect(BADGE_EVENTS.map((event) => event.criteria.kind as string)).not.toContain("pint-count");
  });
});
