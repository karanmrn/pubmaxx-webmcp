import { describe, expect, it } from "vitest";

import { buildPassport, buildBoroughPassport, filterDropsInBorough } from "@/lib/passport";
import type { BadgeEventDefinition } from "@/lib/badgeEvents";
import type { ProfileDrop } from "@/lib/profiles";

// Pure aggregation for the Pint Passport render (user story 29). No DOM/network:
// buildPassport composes profileStats + computeBadges and adds the passport-only
// signals (distinct pubs, distinct beers, story posts). We assert the render
// DATA the card shows, plus the first-run (isEmpty) contract (story 30).

function drop(overrides: Partial<ProfileDrop> = {}): ProfileDrop {
  return { handle: "ken", venueId: "v1", priceGbp: 5, ...overrides };
}

const boroughStampCard: BadgeEventDefinition = {
  id: "borough-stamp-card-test",
  label: "Borough Stamp Card",
  description: "Visit three boroughs during the event window.",
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

describe("buildPassport — first-run / empty", () => {
  it("is fully zeroed and isEmpty for no drops and no counts", () => {
    const p = buildPassport([]);
    expect(p.pubs).toBe(0);
    expect(p.boroughs).toEqual([]);
    expect(p.beers).toBe(0);
    expect(p.crawls).toBe(0);
    expect(p.pints).toBe(0);
    expect(p.cheapestPintGbp).toBeNull();
    expect(p.storyPosts).toBe(0);
    expect(p.badges).toEqual([]);
    expect(p.isEmpty).toBe(true);
  });

  it("treats null / undefined drops as empty, never throws", () => {
    expect(buildPassport(null).isEmpty).toBe(true);
    expect(buildPassport(undefined).isEmpty).toBe(true);
  });

  it("is NOT empty when the handle has crawls or story posts but no drops", () => {
    expect(buildPassport([], { crawls: 2 }).isEmpty).toBe(false);
    expect(buildPassport([], { storyPosts: 1 }).isEmpty).toBe(false);
  });
});

describe("buildPassport — aggregation", () => {
  it("counts DISTINCT pubs by venueId, not raw drop count", () => {
    const p = buildPassport([
      drop({ venueId: "v1" }),
      drop({ venueId: "v1" }),
      drop({ venueId: "v2" }),
    ]);
    expect(p.pubs).toBe(2);
    expect(p.pints).toBe(3); // pints is total drops
  });

  it("counts DISTINCT beers case- and whitespace-insensitively", () => {
    const p = buildPassport([
      drop({ drink: "Guinness" } as Partial<ProfileDrop>),
      drop({ drink: " guinness " } as Partial<ProfileDrop>),
      drop({ drink: "Neck Oil" } as Partial<ProfileDrop>),
      drop({ drink: "" } as Partial<ProfileDrop>),
      drop({}), // no drink named → contributes nothing
    ]);
    expect(p.beers).toBe(2);
  });

  it("surfaces the cheapest priced pint and ignores null/zero prices", () => {
    const p = buildPassport([
      drop({ priceGbp: 6.2 }),
      drop({ priceGbp: 3.8 }),
      drop({ priceGbp: null }),
    ]);
    expect(p.cheapestPintGbp).toBe(3.8);
  });

  it("lists sorted unique boroughs when drops name them", () => {
    const p = buildPassport([
      drop({ borough: "Hackney" }),
      drop({ borough: "Camden" }),
      drop({ borough: "Hackney" }),
    ]);
    expect(p.boroughs).toEqual(["Camden", "Hackney"]);
  });

  it("carries crawls + story posts through, coercing junk to 0", () => {
    const p = buildPassport([drop()], { crawls: 3, storyPosts: 2 });
    expect(p.crawls).toBe(3);
    expect(p.storyPosts).toBe(2);
    const junk = buildPassport([drop()], { crawls: -5, storyPosts: Number.NaN });
    expect(junk.crawls).toBe(0);
    expect(junk.storyPosts).toBe(0);
  });

  // An OMITTED count claimed nothing and reads as a clean zero. An EXPLICIT
  // null is a read that could not run, and flattening it to zero would state a
  // figure about somebody's own record that nobody measured.
  it("keeps an unmeasured count apart from a zero", () => {
    const unknown = buildPassport([drop()], { crawls: null, storyPosts: null });
    expect(unknown.crawls).toBeNull();
    expect(unknown.storyPosts).toBeNull();

    const omitted = buildPassport([drop()]);
    expect(omitted.crawls).toBe(0);
    expect(omitted.storyPosts).toBe(0);
  });

  // Badges are EARNED. An unmeasured count contributes nothing towards one,
  // rather than a guess that hands out a crawl badge because a read failed.
  it("awards no badge on the strength of an unmeasured count", () => {
    const unknown = buildPassport([drop()], { crawls: null });
    const zeroed = buildPassport([drop()], { crawls: 0 });
    expect(unknown.badges.map((badge) => badge.id)).toEqual(
      zeroed.badges.map((badge) => badge.id),
    );
  });

  it("returns only EARNED badges, and awards First Pint + Cheap Legend appropriately", () => {
    const p = buildPassport([drop({ priceGbp: 3.5 })]);
    const ids = p.badges.map((b) => b.id);
    expect(ids).toContain("first-pint");
    expect(ids).toContain("cheap-legend");
    // Every returned badge is earned (the card shows accomplishments, not a ladder).
    expect(p.badges.every((b) => b.earned)).toBe(true);
  });

  it("adds opted-in active seasonal progress and earned event badges from the same drops", () => {
    const p = buildPassport(
      [
        drop({ borough: "Camden", createdAt: "2026-07-03T18:00:00.000Z" }),
        drop({ borough: "Hackney", createdAt: "2026-07-04T18:00:00.000Z" }),
        drop({ borough: "Southwark", createdAt: "2026-07-05T18:00:00.000Z" }),
      ],
      {
        badgeEvents: {
          events: [boroughStampCard],
          now: "2026-07-10T12:00:00.000Z",
          optedInEventIds: [boroughStampCard.id],
        },
      },
    );

    expect(p.badgeEvents).toHaveLength(1);
    expect(p.badgeEvents[0]).toMatchObject({
      current: 3,
      target: 3,
      earned: true,
      label: "3 of 3 boroughs",
    });
    expect(p.badges.map((badge) => badge.id)).toContain("event-borough-stamp-card-test");
  });

  it("suppresses seasonal progress and event badges in legacy mode", () => {
    const p = buildPassport(
      [
        drop({ borough: "Camden", createdAt: "2026-07-03T18:00:00.000Z" }),
        drop({ borough: "Hackney", createdAt: "2026-07-04T18:00:00.000Z" }),
        drop({ borough: "Southwark", createdAt: "2026-07-05T18:00:00.000Z" }),
      ],
      {
        badgeEvents: {
          events: [boroughStampCard],
          now: "2026-07-10T12:00:00.000Z",
          optedInEventIds: [boroughStampCard.id],
          legacyMode: true,
        },
      },
    );

    expect(p.badgeEvents).toEqual([]);
    expect(p.badges.map((badge) => badge.id)).not.toContain("event-borough-stamp-card-test");
  });
});

describe("buildBoroughPassport — borough chapter slice", () => {
  it("filters drops by venueId in the borough", () => {
    const drops = [
      drop({ venueId: "v-west", borough: "Westminster" }),
      drop({ venueId: "v-cam", borough: "Camden" }),
      drop({ venueId: "v-west-2", borough: "Westminster" }),
    ];
    const filtered = filterDropsInBorough(drops, "Westminster", ["v-west", "v-west-2", "v-other"]);
    expect(filtered).toHaveLength(2);
    const passport = buildBoroughPassport(drops, "Westminster", ["v-west", "v-west-2"]);
    expect(passport.pubs).toBe(2);
    expect(passport.pints).toBe(2);
  });

  it("is empty when no drops match the borough", () => {
    const passport = buildBoroughPassport(
      [drop({ venueId: "v-cam", borough: "Camden" })],
      "Westminster",
      ["v-west"],
    );
    expect(passport.isEmpty).toBe(true);
    expect(passport.pubs).toBe(0);
  });
});
