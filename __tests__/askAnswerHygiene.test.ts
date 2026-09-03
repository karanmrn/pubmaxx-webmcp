// Pub Pal answer hygiene (review report D5). The reader of a Pal answer never
// sees plumbing: no internal service names, no "rows", no ask-classifier
// wording. Every sentence a tool hands back is one a person would say at the
// bar, and the cards an answer counts are the cards it prints.

import { describe, expect, it } from "vitest";

import { composeAnswer, mergeToolResults } from "@/lib/ask/runAsk";
import { runAskTool } from "@/lib/ask/tools";
import type { AskToolContext, AskToolResult } from "@/lib/ask/toolContract";
import type { AskCard } from "@/lib/ask/types";

const PLUMBING_TOKENS = [
  "CityMCP",
  "rows",
  "What's On ask",
  "ask-classifier",
  "classifier",
  "grounded",
] as const;

function readerText(result: AskToolResult): string {
  return [
    result.answerHint ?? "",
    ...result.cards.flatMap((card) => [card.title, card.place, card.note]),
  ].join(" ");
}

function ctx(overrides: Partial<AskToolContext> = {}): AskToolContext {
  return {
    cityId: "london",
    query: "",
    skipModel: true,
    ...overrides,
  };
}

const failingFetch: typeof fetch = async () => {
  throw new Error("upstream down");
};

describe("Pal answer hygiene", () => {
  it("keeps plumbing out of a degraded area buzz answer", async () => {
    const result = await runAskTool(
      "area_buzz",
      { area: "Shoreditch" },
      ctx({ query: "what's it like in Shoreditch", fetchImpl: failingFetch }),
    );
    const text = readerText(result);
    for (const token of PLUMBING_TOKENS) {
      expect(text).not.toContain(token);
    }
    expect(text).toContain("Couldn't check the average pint for Shoreditch");
  });

  it("answers a non-listings ask with what to ask for, not a classifier verdict", async () => {
    const result = await runAskTool(
      "whats_on",
      { query: "how do magnets work" },
      ctx({ query: "how do magnets work" }),
    );
    expect(result.answerHint).toBe(
      "Ask about quiz nights, live music, sport or deals and I'll check the listings.",
    );
    expect(result.answerHint).not.toContain("What's On ask");
  });

  it("counts one card for one pub, whichever tools answered it", () => {
    const card = (key: string, venueId: string): AskCard => ({
      key,
      venueId,
      title: "The Lamb",
      place: "Bloomsbury",
      note: "",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    });
    const result = (cards: AskCard[], tool: AskToolResult["tool"] = "search_venues"): AskToolResult => ({
      ok: true,
      tool,
      data: null,
      provenance: [],
      cards,
      proposals: [],
      answerHint: "",
    });
    const merged = mergeToolResults([
      result([
        card("venue-1:drink-1", "venue-1"),
        card("venue-1:drink-2", "venue-1"),
        card("venue-1:drink-3", "venue-1"),
      ]),
      result([card("venue-1", "venue-1"), card("venue-2", "venue-2")]),
    ]);
    expect(merged.cards).toHaveLength(4);
    expect(merged.cards.map((c) => c.key)).toEqual([
      "venue-1:drink-1",
      "venue-1:drink-2",
      "venue-1:drink-3",
      "venue-2",
    ]);
  });

  it("drops empty success hints when retained cards answer the ask", () => {
    const card: AskCard = {
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    };
    const result = (overrides: Partial<AskToolResult>): AskToolResult => ({
      ok: true,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards: [],
      proposals: [],
      answerHint: "",
      ...overrides,
    });
    const merged = mergeToolResults([
      result({ cards: [card], answerHint: "The Lamb is listed." }),
      result({ answerHint: "Nothing listed matches that." }),
    ]);

    expect(composeAnswer(merged.hints, merged.cards, merged.toolsUsed)).toBe(
      "1 pick from the listed pubs, each with its source. The Lamb is listed.",
    );
  });

  it("keeps degraded hints beside retained cards", () => {
    const card: AskCard = {
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    };
    const merged = mergeToolResults([
      {
        ok: true,
        tool: "search_venues",
        data: null,
        provenance: [],
        cards: [card],
        proposals: [],
        answerHint: "The Lamb is listed.",
      },
      {
        ok: false,
        tool: "tonight_now",
        data: null,
        provenance: [],
        cards: [],
        proposals: [],
        answerHint: "Couldn't read tonight's listings.",
        degraded: true,
      },
    ]);

    expect(composeAnswer(merged.hints, merged.cards, merged.toolsUsed)).toContain(
      "Couldn't read tonight's listings.",
    );
  });

  it("composes pub counts from retained cards", () => {
    const card: AskCard = {
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "Quiet",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    };
    const answer = composeAnswer(["The Lamb is listed."], [card], ["search_venues"]);
    expect(answer).toBe("1 pick from the listed pubs, each with its source. The Lamb is listed.");

    const statusAnswer = composeAnswer(
      ["London right now: no tube or weather notes."],
      [{ ...card, venueId: "", title: "London right now", place: "" }],
      ["city_status"],
    );
    expect(statusAnswer).toBe("London right now: no tube or weather notes.");
    expect(statusAnswer).not.toContain("listed pubs");
  });

  it("uses pub-pick counts only for pub-pick tools", () => {
    const card: AskCard = {
      key: "desk-1",
      venueId: "venue-1",
      title: "Work cafe",
      place: "Camden",
      note: "Seats listed",
      price: null,
      provenance: { label: "On record", kind: "directory" },
    };
    const deskAnswer = composeAnswer(["1 place to sit and work."], [card], ["find_desk"]);
    expect(deskAnswer).toBe("1 place to sit and work.");

    const pubAnswer = composeAnswer([], [card], ["search_venues"]);
    expect(pubAnswer).toBe("1 pick from the listed pubs, each with its source.");
  });

  it("counts cards retained after the shared cap", () => {
    const card = (index: number): AskCard => ({
      key: `venue-${index}`,
      venueId: `venue-${index}`,
      title: `The Lamb ${index}`,
      place: "Bloomsbury",
      note: "",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    });
    const result = (cards: AskCard[]): AskToolResult => ({
      ok: true,
      tool: "search_venues",
      data: null,
      provenance: [],
      cards,
      proposals: [],
      answerHint: "",
    });
    const merged = mergeToolResults([
      result([0, 1, 2, 3, 4].map(card)),
      result([5, 6, 7, 8, 9].map(card)),
    ]);
    const answer = composeAnswer(merged.hints, merged.cards, merged.toolsUsed);

    expect(merged.cards).toHaveLength(8);
    expect(answer).toMatch(/Showing the first 8\.$/u);
  });
});
