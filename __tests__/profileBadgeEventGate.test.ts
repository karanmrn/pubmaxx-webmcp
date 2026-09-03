import { describe, expect, it } from "vitest";

import { buildProfileBadgeEventOptions } from "@/lib/profileBadgeEventGate";

const optIns = {
  optedInEventIds: ["borough-stamp-card-2026-07"],
  optedInAtByEventId: {
    "borough-stamp-card-2026-07": "2026-07-07T12:00:00.000Z",
  },
};

describe("buildProfileBadgeEventOptions", () => {
  it("passes badge event options only for the viewer's own non-legacy passport", () => {
    expect(
      buildProfileBadgeEventOptions({
        isOwnPassport: true,
        legacyMode: false,
        now: "2026-07-10T12:00:00.000Z",
        optIns,
      }),
    ).toMatchObject({
      now: "2026-07-10T12:00:00.000Z",
      optedInEventIds: ["borough-stamp-card-2026-07"],
      optedInAtByEventId: {
        "borough-stamp-card-2026-07": "2026-07-07T12:00:00.000Z",
      },
      legacyMode: false,
    });

    expect(
      buildProfileBadgeEventOptions({
        isOwnPassport: false,
        legacyMode: false,
        now: "2026-07-10T12:00:00.000Z",
        optIns,
      }),
    ).toBeUndefined();

    expect(
      buildProfileBadgeEventOptions({
        isOwnPassport: true,
        legacyMode: true,
        now: "2026-07-10T12:00:00.000Z",
        optIns,
      }),
    ).toBeUndefined();
  });

  it("does not start seasonal event computation until the user has opted in", () => {
    expect(
      buildProfileBadgeEventOptions({
        isOwnPassport: true,
        legacyMode: false,
        now: "2026-07-10T12:00:00.000Z",
        optIns: { optedInEventIds: [], optedInAtByEventId: {} },
      }),
    ).toBeUndefined();
  });
});
