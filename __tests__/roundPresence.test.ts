import { describe, expect, it } from "vitest";

import { PRESENCE_TTL_MS, type PresenceDTO } from "@/lib/presenceStore";
import {
  crewHereSummary,
  currentStop,
  roundPresence,
} from "@/lib/roundPresence";
import type { RoundMemberDTO, RoundStopDTO } from "@/lib/rounds";

// The pure "your crew is here" lens (docs/IDEAS_2026-07-07.md B6): it overlaps
// the Round's members with venue presence at the CURRENT stop. All cases run on
// hand-built DTOs with an injected clock — no store, no env, no wall time. The
// store owns presence persistence + its own TTL; here we prove the intersection,
// the defensive TTL re-filter, the counts, and every empty case.

const NOW = Date.parse("2026-07-07T21:00:00.000Z");

function member(handle: string, joinedAt = "2026-07-07T20:00:00.000Z"): RoundMemberDTO {
  return { handle, joinedAt };
}

function stop(id: string, venueId: string, venueName: string): RoundStopDTO {
  return {
    id,
    venueId,
    venueName,
    addedByHandle: "host",
    createdAt: "2026-07-07T20:30:00.000Z",
  };
}

function presence(
  handle: string,
  venueId: string,
  atMsAgo = 0,
  venueName = "The Pub",
): PresenceDTO {
  return {
    handle,
    venueId,
    venueName,
    venueMapUrl: `/map?sel=${venueId}`,
    at: new Date(NOW - atMsAgo).toISOString(),
  };
}

describe("currentStop — the newest stop on the route", () => {
  it("returns the LAST stop (route is oldest-first, current is newest)", () => {
    const stops = [stop("s1", "v1", "First"), stop("s2", "v2", "Second")];
    expect(currentStop(stops)?.venueId).toBe("v2");
  });

  it("is null for a Round with no stops yet", () => {
    expect(currentStop([])).toBeNull();
  });
});

describe("roundPresence — intersection of members × presence at the current stop", () => {
  const members = [member("ken"), member("dana"), member("mo")];
  const stops = [stop("s1", "v1", "First Pub"), stop("s2", "v2", "The Crown")];

  it("counts only crew present at the CURRENT stop (v2), not earlier stops", () => {
    const rows = [
      presence("ken", "v2"), // crew, current stop → counts
      presence("dana", "v1"), // crew but at an EARLIER stop → ignored
      presence("stranger", "v2"), // current stop but NOT crew → ignored
    ];
    const result = roundPresence(members, stops, rows, NOW);
    expect(result.count).toBe(1);
    expect([...result.presentHandles]).toEqual(["ken"]);
    expect(result.stop?.venueId).toBe("v2");
    expect(result.crewSize).toBe(3);
  });

  it("intersects multiple present crew members and dedupes", () => {
    const rows = [presence("ken", "v2"), presence("mo", "v2"), presence("ken", "v2")];
    const result = roundPresence(members, stops, rows, NOW);
    expect(result.count).toBe(2);
    expect(result.presentHandles.has("ken")).toBe(true);
    expect(result.presentHandles.has("mo")).toBe(true);
  });

  it("matches handles case-insensitively (normalized both sides)", () => {
    const result = roundPresence([member("Ken")], stops, [presence("KEN", "v2")], NOW);
    expect(result.count).toBe(1);
    expect(result.presentHandles.has("ken")).toBe(true);
  });

  it("never counts a non-member even if they're present at the stop", () => {
    const result = roundPresence(members, stops, [presence("gatecrasher", "v2")], NOW);
    expect(result.count).toBe(0);
  });
});

describe("roundPresence — defensive TTL (honesty: never claim past the window)", () => {
  const members = [member("ken")];
  const stops = [stop("s1", "v2", "The Crown")];

  it("counts a fresh presence row (within TTL)", () => {
    const result = roundPresence(members, stops, [presence("ken", "v2", 60_000)], NOW);
    expect(result.count).toBe(1);
  });

  it("drops a presence row older than the TTL", () => {
    const stale = presence("ken", "v2", PRESENCE_TTL_MS + 1_000);
    expect(roundPresence(members, stops, [stale], NOW).count).toBe(0);
  });

  it("drops a future-dated presence row (clock skew / bad data)", () => {
    const future = presence("ken", "v2", -60_000); // 'at' is in the future
    expect(roundPresence(members, stops, [future], NOW).count).toBe(0);
  });

  it("drops a row with a missing/unparseable timestamp", () => {
    const bad = { ...presence("ken", "v2"), at: "not-a-date" };
    expect(roundPresence(members, stops, [bad], NOW).count).toBe(0);
    const missing = { ...presence("ken", "v2"), at: "" } as PresenceDTO;
    expect(roundPresence(members, stops, [missing], NOW).count).toBe(0);
  });

  it("honors a custom shorter TTL window", () => {
    const row = presence("ken", "v2", 5 * 60_000); // 5 minutes ago
    expect(roundPresence(members, stops, [row], NOW, 60_000).count).toBe(0); // 1-min window
    expect(roundPresence(members, stops, [row], NOW, 10 * 60_000).count).toBe(1); // 10-min window
  });
});

describe("roundPresence — empty / degraded cases collapse to zero", () => {
  it("no stops → zero, stop null", () => {
    const result = roundPresence([member("ken")], [], [presence("ken", "v2")], NOW);
    expect(result.count).toBe(0);
    expect(result.stop).toBeNull();
  });

  it("no members → zero, but stop is still surfaced", () => {
    const stops = [stop("s1", "v2", "The Crown")];
    const result = roundPresence([], stops, [presence("ken", "v2")], NOW);
    expect(result.count).toBe(0);
    expect(result.crewSize).toBe(0);
    expect(result.stop?.venueId).toBe("v2");
  });

  it("no presence rows → zero", () => {
    const stops = [stop("s1", "v2", "The Crown")];
    expect(roundPresence([member("ken")], stops, [], NOW).count).toBe(0);
  });

  it("tolerates a member with a blank handle without crashing", () => {
    const stops = [stop("s1", "v2", "The Crown")];
    const result = roundPresence([member(""), member("ken")], stops, [presence("ken", "v2")], NOW);
    expect(result.count).toBe(1);
  });
});

describe("crewHereSummary — honest one-liner", () => {
  const stops = [stop("s1", "v2", "The Crown")];

  it("is null when nobody's present (no positive claim to make)", () => {
    const result = roundPresence([member("ken")], stops, [], NOW);
    expect(crewHereSummary(result)).toBeNull();
  });

  it("uses the singular verb for one and names the pub", () => {
    const result = roundPresence([member("ken")], stops, [presence("ken", "v2")], NOW);
    expect(crewHereSummary(result)).toBe("1 of your crew is here: The Crown");
  });

  it("uses the plural verb for more than one", () => {
    const members = [member("ken"), member("mo")];
    const rows = [presence("ken", "v2"), presence("mo", "v2")];
    const result = roundPresence(members, stops, rows, NOW);
    expect(crewHereSummary(result)).toBe("2 of your crew are here: The Crown");
  });
});
