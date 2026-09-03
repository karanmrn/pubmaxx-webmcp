import { describe, expect, it } from "vitest";

import {
  GUEST_LIST_DISPLAY_CAP,
  isPlanInviteRsvpSummary,
  RSVP_PLAN_CEILING,
} from "@/lib/planInvite";

describe("isPlanInviteRsvpSummary", () => {
  it("accepts a complete public RSVP summary", () => {
    expect(
      isPlanInviteRsvpSummary({
        counts: { going: 1, maybe: 0 },
        guests: [{ id: "guest-1", displayName: "Priya", status: "going" }],
      }),
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { counts: { going: -1, maybe: 0 }, guests: [] },
    { counts: { going: 1.5, maybe: 0 }, guests: [] },
    { counts: { going: 1, maybe: 0 }, guests: [{ id: "", displayName: "Priya", status: "going" }] },
    { counts: { going: 1, maybe: 0 }, guests: [{ id: "guest-1", displayName: "", status: "going" }] },
    { counts: { going: 1, maybe: 0 }, guests: [{ id: "guest-1", displayName: "Priya", status: "yes" }] },
  ])("rejects malformed summary %#", (value) => {
    expect(isPlanInviteRsvpSummary(value)).toBe(false);
  });

  it("rejects more visible guests than the public display cap", () => {
    expect(
      isPlanInviteRsvpSummary({
        counts: { going: GUEST_LIST_DISPLAY_CAP + 1, maybe: 0 },
        guests: Array.from({ length: GUEST_LIST_DISPLAY_CAP + 1 }, (_, index) => ({
          id: `guest-${index}`,
          displayName: `Guest ${index}`,
          status: "going",
        })),
      }),
    ).toBe(false);
  });

  it("rejects duplicate public guest IDs", () => {
    expect(
      isPlanInviteRsvpSummary({
        counts: { going: 1, maybe: 1 },
        guests: [
          { id: "guest-1", displayName: "Priya", status: "going" },
          { id: " guest-1 ", displayName: "Sam", status: "maybe" },
        ],
      }),
    ).toBe(false);
  });

  it("rejects counts below the visible status rows", () => {
    expect(
      isPlanInviteRsvpSummary({
        counts: { going: 0, maybe: 1 },
        guests: [
          { id: "guest-1", displayName: "Priya", status: "going" },
          { id: "guest-2", displayName: "Sam", status: "maybe" },
        ],
      }),
    ).toBe(false);
  });

  it("rejects a total count above the Plan RSVP ceiling", () => {
    expect(
      isPlanInviteRsvpSummary({
        counts: { going: RSVP_PLAN_CEILING, maybe: 1 },
        guests: [],
      }),
    ).toBe(false);
  });
});
