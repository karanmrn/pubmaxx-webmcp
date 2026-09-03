import { describe, expect, it } from "vitest";

import {
  canGroupGetIn,
  estimateBusyness,
  evaluateOpenState,
  resolveBookingOption,
  type BusynessReport,
} from "@/lib/busyness";

describe("estimateBusyness", () => {
  it("marks a Friday evening as typically busy and stays honest about provenance", () => {
    const result = estimateBusyness({
      now: new Date("2026-07-10T19:30:00.000Z"),
      timeZone: "Europe/London",
    });

    expect(result).toMatchObject({
      level: "busy",
      source: "typical-pattern",
      isOpen: "unknown",
      label: "Usually busy",
    });
  });

  it("uses a fresh community report without presenting it as measured footfall", () => {
    const reports: BusynessReport[] = [
      {
        level: "rammed",
        reportedAt: "2026-07-10T19:24:00.000Z",
        reporterName: "Priya",
      },
    ];

    const result = estimateBusyness({
      now: new Date("2026-07-10T19:30:00.000Z"),
      timeZone: "Europe/London",
      reports,
    });

    expect(result).toMatchObject({
      level: "rammed",
      source: "community-report",
      label: "Reported rammed",
      reportCount: 1,
    });
  });

  it("ignores stale community reports", () => {
    const result = estimateBusyness({
      now: new Date("2026-07-10T19:30:00.000Z"),
      timeZone: "Europe/London",
      reports: [
        {
          level: "quiet",
          reportedAt: "2026-07-10T16:00:00.000Z",
          reporterName: "Sam",
        },
      ],
    });

    expect(result.source).toBe("typical-pattern");
    expect(result.level).toBe("busy");
  });
});

describe("evaluateOpenState", () => {
  it("exports the shared open/closed/unknown evaluator used by the map filter", () => {
    const fridayNoon = new Date("2026-08-07T11:00:00.000Z");
    expect(evaluateOpenState({ now: fridayNoon })).toBe("unknown");
    expect(
      evaluateOpenState({
        now: fridayNoon,
        openingHours: { 5: [{ opens: "08:00", closes: "23:00" }] },
      }),
    ).toBe(true);
  });

  it("stays open just after midnight on an overnight window carried over from the PREVIOUS day's own hours", () => {
    // Saturday (6) closes at 01:00 Sunday; Sunday's (0) own hours are a plain
    // same-day window that starts later that morning. A minute-past-midnight
    // check must still find the Saturday-night window rather than only
    // consulting Sunday's own (not-yet-open) row.
    const openingHours = {
      6: [{ opens: "22:00", closes: "01:00" }],
      0: [{ opens: "10:00", closes: "23:00" }],
    };
    const sundayJustAfterMidnight = new Date("2026-01-11T00:30:00.000Z"); // Sunday 00:30 Europe/London
    expect(evaluateOpenState({ now: sundayJustAfterMidnight, openingHours })).toBe(true);

    const sundayOvernightWindowClosed = new Date("2026-01-11T01:30:00.000Z"); // Sunday 01:30, past 01:00 close
    expect(evaluateOpenState({ now: sundayOvernightWindowClosed, openingHours })).toBe(false);

    const sundayBeforeItsOwnOpening = new Date("2026-01-11T08:30:00.000Z"); // Sunday 08:30, before 10:00 open
    expect(evaluateOpenState({ now: sundayBeforeItsOwnOpening, openingHours })).toBe(false);
  });
});

describe("canGroupGetIn", () => {
  it("does not promise entry when a large group meets a busy estimate", () => {
    expect(canGroupGetIn({ groupSize: 8, level: "busy", hasBookingLink: false })).toEqual({
      fit: "unlikely",
      label: "Call ahead",
      reason: "A group of 8 may struggle at a usually busy time.",
    });
  });

  it("offers booking as the honest next step when a link exists", () => {
    expect(canGroupGetIn({ groupSize: 6, level: "rammed", hasBookingLink: true })).toMatchObject({
      fit: "book-ahead",
      label: "Book ahead",
    });
  });
});

describe("resolveBookingOption", () => {
  it("only returns a scaffold for a real http(s) booking URL", () => {
    expect(resolveBookingOption("https://example.com/book")).toEqual({
      available: true,
      label: "Book a table",
      href: "https://example.com/book",
      partner: null,
    });
    expect(resolveBookingOption("javascript:alert(1)")).toEqual({
      available: false,
      label: "Booking link unavailable",
      href: null,
      partner: null,
    });
  });
});
