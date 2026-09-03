import { describe, expect, it } from "vitest";

import { isEventRelevantToPlanStart, planStartsThisTonight, stopEventChips } from "@/lib/planWhatsOn";
import type { WhatsOnRow } from "@/lib/whatsOn";

// A fixed "now" inside the 12 Jul tonight window (16:00 London → 04:00 the
// next morning) so every test is deterministic regardless of when it runs.
const NOW = Date.parse("2026-07-12T19:00:00+01:00");

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "row-1",
    venueId: "venue-1",
    placeName: "The Test Tavern",
    kind: "quiz",
    startsAt: "2026-07-12T20:00:00+01:00",
    title: "Pub quiz",
    source: { label: "Question One", url: "https://questionone.com/x" },
    observedAt: "2026-07-12T12:00:00+01:00",
    confidence: "listed",
    ...overrides,
  };
}

describe("planStartsThisTonight", () => {
  it("is true for a plan starting later this same tonight window", () => {
    expect(planStartsThisTonight("2026-07-12T21:00:00+01:00", NOW)).toBe(true);
  });

  it("is false for a plan scheduled for a different night", () => {
    expect(planStartsThisTonight("2026-07-19T21:00:00+01:00", NOW)).toBe(false);
  });

  it("is false for an unparseable start time", () => {
    expect(planStartsThisTonight("not-a-date", NOW)).toBe(false);
  });
});

describe("isEventRelevantToPlanStart", () => {
  const planStartMs = Date.parse("2026-07-12T20:30:00+01:00");

  it("is always relevant for the untimed sport attribute", () => {
    expect(isEventRelevantToPlanStart(row({ kind: "sport", startsAt: "2026-07-12T12:00:00+01:00" }), planStartMs)).toBe(true);
  });

  it("drops a timed quiz that finished before the plan's start time", () => {
    expect(isEventRelevantToPlanStart(row({ startsAt: "2026-07-12T18:00:00+01:00" }), planStartMs)).toBe(false);
  });

  it("keeps a timed quiz that starts after the plan's start time", () => {
    expect(isEventRelevantToPlanStart(row({ startsAt: "2026-07-12T21:00:00+01:00" }), planStartMs)).toBe(true);
  });

  it("keeps a deal still running (endsAt) when the crew arrives", () => {
    expect(
      isEventRelevantToPlanStart(
        row({ kind: "deal", startsAt: "2026-07-12T17:00:00+01:00", endsAt: "2026-07-12T21:00:00+01:00" }),
        planStartMs,
      ),
    ).toBe(true);
  });
});

describe("stopEventChips", () => {
  const planStart = "2026-07-12T19:30:00+01:00";

  it("produces no chips for a plan not scheduled for tonight (honest empty)", () => {
    const chips = stopEventChips([row()], ["venue-1"], "2026-07-19T19:30:00+01:00", NOW);
    expect(chips.size).toBe(0);
  });

  it("matches a row to its stop by exact venueId, never haversine", () => {
    const chips = stopEventChips([row({ venueId: "venue-1" })], ["venue-1", "venue-2"], planStart, NOW);
    expect(chips.has("venue-1")).toBe(true);
    expect(chips.has("venue-2")).toBe(false);
  });

  it("renders an honest label with kind and time", () => {
    const chips = stopEventChips(
      [row({ venueId: "venue-1", kind: "quiz", startsAt: "2026-07-12T20:00:00+01:00", priceGbp: 2 })],
      ["venue-1"],
      planStart,
      NOW,
    );
    const chip = chips.get("venue-1");
    expect(chip?.label).toBe("Quiz night · 8:00 pm · £2.00");
    expect(chip?.timeLabel).toBe("8:00 pm");
    expect(chip?.sourceLabel).toBe("Question One");
    expect(chip?.confidence).toBe("listed");
  });

  it("renders sport as an untimed attribute chip", () => {
    const chips = stopEventChips(
      [row({ venueId: "venue-1", kind: "sport", startsAt: "2026-07-12T17:00:00+01:00" })],
      ["venue-1"],
      planStart,
      NOW,
    );
    expect(chips.get("venue-1")?.label).toBe("Screens live sport");
    expect(chips.get("venue-1")?.timeLabel).toBeNull();
  });

  it("picks the hero kind (quiz over sport) when a venue has several rows", () => {
    const chips = stopEventChips(
      [
        row({ id: "sport-row", venueId: "venue-1", kind: "sport", startsAt: "2026-07-12T17:00:00+01:00" }),
        row({ id: "quiz-row", venueId: "venue-1", kind: "quiz", startsAt: "2026-07-12T20:00:00+01:00" }),
      ],
      ["venue-1"],
      planStart,
      NOW,
    );
    expect(chips.get("venue-1")?.kind).toBe("quiz");
  });

  it("never invents a chip for a stop with no matching row", () => {
    const chips = stopEventChips([row({ venueId: "venue-9" })], ["venue-1"], planStart, NOW);
    expect(chips.has("venue-1")).toBe(false);
  });

  it("drops a timed row that already finished before the plan starts", () => {
    const chips = stopEventChips(
      [row({ venueId: "venue-1", startsAt: "2026-07-12T16:30:00+01:00" })],
      ["venue-1"],
      planStart,
      NOW,
    );
    expect(chips.has("venue-1")).toBe(false);
  });
});
