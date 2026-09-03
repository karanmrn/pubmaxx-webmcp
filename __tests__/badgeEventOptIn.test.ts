import { describe, expect, it } from "vitest";

import {
  addBadgeEventOptIn,
  parseBadgeEventOptIns,
  type BadgeEventOptInState,
} from "@/lib/badgeEventOptIn";

const eventIds = ["borough-stamp-card-2026-07", "thames-side-thursday-2026"];

describe("badge event opt-in storage", () => {
  it("treats missing or malformed storage as no opt-ins", () => {
    expect(parseBadgeEventOptIns(null, eventIds)).toEqual<BadgeEventOptInState>({
      optedInEventIds: [],
      optedInAtByEventId: {},
    });
    expect(parseBadgeEventOptIns("{not-json", eventIds)).toEqual<BadgeEventOptInState>({
      optedInEventIds: [],
      optedInAtByEventId: {},
    });
    expect(parseBadgeEventOptIns("[]", eventIds)).toEqual<BadgeEventOptInState>({
      optedInEventIds: [],
      optedInAtByEventId: {},
    });
  });

  it("keeps only known events with valid opt-in timestamps", () => {
    const parsed = parseBadgeEventOptIns(
      JSON.stringify({
        " borough-stamp-card-2026-07 ": "2026-07-07T12:00:00.000Z",
        "thames-side-thursday-2026": "not-a-date",
        "made-up-event": "2026-07-07T12:00:00.000Z",
      }),
      eventIds,
    );

    expect(parsed).toEqual<BadgeEventOptInState>({
      optedInEventIds: ["borough-stamp-card-2026-07"],
      optedInAtByEventId: {
        "borough-stamp-card-2026-07": "2026-07-07T12:00:00.000Z",
      },
    });
  });

  it("adds a new opt-in without overwriting an existing opt-in timestamp", () => {
    const first = addBadgeEventOptIn(
      null,
      "borough-stamp-card-2026-07",
      "2026-07-07T12:00:00.000Z",
      eventIds,
    );
    const again = addBadgeEventOptIn(
      first.serialized,
      "borough-stamp-card-2026-07",
      "2026-07-20T12:00:00.000Z",
      eventIds,
    );

    expect(again.state.optedInAtByEventId["borough-stamp-card-2026-07"]).toBe(
      "2026-07-07T12:00:00.000Z",
    );
    expect(JSON.parse(again.serialized)).toEqual({
      "borough-stamp-card-2026-07": "2026-07-07T12:00:00.000Z",
    });
  });
});
