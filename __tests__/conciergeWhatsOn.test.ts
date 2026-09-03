import { describe, expect, it } from "vitest";

import {
  buildWhatsOnAnswer,
  detectWhatsOnIntent,
  filterRowsByArea,
  filterRowsByWeekday,
  londonWeekday,
} from "@/lib/concierge/whatsOn";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(over: Partial<WhatsOnRow>): WhatsOnRow {
  return {
    id: "r1",
    placeName: "The Test Tavern, Soho",
    kind: "quiz",
    startsAt: "2026-07-14T19:30:00+01:00", // Tuesday, London
    title: "Pub quiz — Tuesdays",
    source: { label: "Question One", url: "https://questionone.com/x" },
    observedAt: "2026-07-11T20:00:00.000Z",
    confidence: "listed",
    ...over,
  };
}

describe("detectWhatsOnIntent", () => {
  it("matches by kind and recognises tonight", () => {
    expect(detectWhatsOnIntent("quiz tonight near me")).toMatchObject({
      kind: "quiz",
      window: "tonight",
    });
    expect(detectWhatsOnIntent("where's showing the football")).toMatchObject({ kind: "sport" });
    expect(detectWhatsOnIntent("any curry club deals?")).toMatchObject({ kind: "deal" });
    expect(detectWhatsOnIntent("live music this weekend")).toMatchObject({ kind: "music" });
  });

  it("matches a generic what's-on phrase with no kind, and extracts area", () => {
    const intent = detectWhatsOnIntent("what's on in Soho");
    expect(intent).not.toBeNull();
    expect(intent?.kind).toBeUndefined();
    expect(intent?.area).toBe("Soho");
  });

  it("extracts a named weekday as a time window", () => {
    expect(detectWhatsOnIntent("quiz on Thursday in Camden")).toMatchObject({
      kind: "quiz",
      window: "weekday",
      weekday: 4,
      area: "Camden",
    });
  });

  it("does not treat 'me'/'here' as an area", () => {
    expect(detectWhatsOnIntent("quiz near me")?.area).toBeUndefined();
    expect(detectWhatsOnIntent("what's on near here")?.area).toBeUndefined();
  });

  it("does not treat a generic noun phrase as an area", () => {
    expect(detectWhatsOnIntent("what's on in the pub tonight")?.area).toBeUndefined();
    expect(detectWhatsOnIntent("quiz in the area")?.area).toBeUndefined();
    expect(detectWhatsOnIntent("live music in a bar")?.area).toBeUndefined();
  });

  it("returns null for a plain venue-mood query", () => {
    expect(detectWhatsOnIntent("Garden near Soho for 4, not pricey")).toBeNull();
    expect(detectWhatsOnIntent("somewhere quiet in Bank")).toBeNull();
  });
});

describe("filterRowsByArea", () => {
  it("keeps only rows whose place text mentions the area", () => {
    const rows = [
      row({ id: "a", placeName: "The Test Tavern, Soho" }),
      row({ id: "b", placeName: "Riverside Arms, Chelsea" }),
      row({ id: "c", placeName: "Corner House", detail: "Quiz night · SW3 Chelsea" }),
    ];
    const chelsea = filterRowsByArea(rows, "Chelsea").map((r) => r.id);
    expect(chelsea).toEqual(["b", "c"]);
    expect(filterRowsByArea(rows, "Shoreditch")).toEqual([]);
  });
});

describe("londonWeekday / filterRowsByWeekday", () => {
  it("reads the London weekday of startsAt and filters by it", () => {
    expect(londonWeekday("2026-07-14T19:30:00+01:00")).toBe(2); // Tuesday
    const rows = [
      row({ id: "tue", startsAt: "2026-07-14T19:30:00+01:00" }),
      row({ id: "thu", startsAt: "2026-07-16T19:30:00+01:00" }),
    ];
    expect(filterRowsByWeekday(rows, 2).map((r) => r.id)).toEqual(["tue"]);
    expect(filterRowsByWeekday(rows, 4).map((r) => r.id)).toEqual(["thu"]);
  });
});

describe("buildWhatsOnAnswer", () => {
  it("grounds matched rows into provenance-carrying DTOs", () => {
    const answer = buildWhatsOnAnswer({ kind: "quiz", area: "Soho" }, [
      row({ id: "q1", priceGbp: 2, detail: "Every Tuesday" }),
    ]);
    expect(answer.mode).toBe("whats-on");
    expect(answer.count).toBe(1);
    expect(answer.listings[0]).toMatchObject({
      kind: "quiz",
      venue: "The Test Tavern, Soho",
      priceGbp: 2,
      source: { label: "Question One", url: "https://questionone.com/x" },
    });
    expect(answer.message).toContain("sourced");
    expect(answer.message).toContain("Soho");
  });

  it("refuses honestly when no rows match — never invents", () => {
    const answer = buildWhatsOnAnswer({ kind: "quiz", area: "Shoreditch", window: "tonight" }, []);
    expect(answer.count).toBe(0);
    expect(answer.listings).toEqual([]);
    expect(answer.message).toMatch(/no sourced/i);
    expect(answer.message).toContain("Shoreditch");
    expect(answer.message).toContain("listings I can check");
  });
});
