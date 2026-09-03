// Pub Pal chat pure answer shaping (lib/palChat): both concierge response shapes
// normalised into provenance-carrying cards, honest empty-state copy, and the
// non-negotiable provenance rule (a listing with no source label is dropped, not
// shown bare). Hermetic: fixed ISO instants, no real clock, house copy asserted
// to carry no em dash.
import { describe, expect, it } from "vitest";

import {
  DIRECTORY_PROVENANCE_LABEL,
  PAL_EMPTY_MESSAGE,
  PAL_ERROR_FALLBACK,
  PAL_WEB_GROUNDING,
  formatPalWhen,
  palAnswerFromBody,
} from "@/lib/palChat";

const VENUE_BODY = {
  intent: { mood: ["cosy"], groupSize: 4 },
  intentSource: "deterministic",
  venues: [
    {
      id: "venue-1",
      name: "The Lamb",
      area: "Bloomsbury",
      lat: 51.5,
      lng: -0.12,
      cheapestPrice: 5.4,
      score: 0.9,
      reasons: ["In Bloomsbury", "A calmer fit"],
    },
  ],
};

const WHATS_ON_BODY = {
  mode: "whats-on",
  kind: "quiz",
  window: "tonight",
  area: "Chelsea",
  count: 1,
  message: "Found 1 verified quiz night in Chelsea tonight, each with its source.",
  listings: [
    {
      id: "wo-1",
      kind: "quiz",
      title: "Pub quiz",
      venue: "Sporting Page, Chelsea",
      venueId: "venue-9",
      startsAt: "2026-07-18T18:30:00Z",
      detail: "Starts 7pm, teams of up to 6",
      priceGbp: 2,
      confidence: "confirmed",
      source: { label: "Question One", url: "https://example.com/quiz" },
    },
  ],
};

// No user-facing string may carry an em dash (anti-AI-tell house rule).
function assertNoEmDash(value: string): void {
  expect(value.includes("—")).toBe(false);
}

describe("palAnswerFromBody — venue ranking", () => {
  it("shapes first-party rows into On-record cards with the lead reason as note", () => {
    const answer = palAnswerFromBody(VENUE_BODY);
    expect(answer.status).toBe("answered");
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0]).toEqual({
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "In Bloomsbury",
      price: 5.4,
      provenance: { label: DIRECTORY_PROVENANCE_LABEL, kind: "directory" },
    });
  });

  it("synthesises house-voice connective copy when the route sends no message", () => {
    const answer = palAnswerFromBody(VENUE_BODY);
    expect(answer.message).toContain("1 pick");
    assertNoEmDash(answer.message);
  });

  it("pluralises the synthesised caption for multiple picks", () => {
    const answer = palAnswerFromBody({
      venues: [
        { id: "a", name: "A", area: "Soho", cheapestPrice: 4, reasons: [] },
        { id: "b", name: "B", area: "Soho", cheapestPrice: 5, reasons: [] },
      ],
    });
    expect(answer.message).toContain("2 picks");
  });

  it("refuses honestly on zero venue rows with the house empty-state line", () => {
    const answer = palAnswerFromBody({ venues: [] });
    expect(answer.status).toBe("empty");
    expect(answer.message).toBe(PAL_EMPTY_MESSAGE);
    expect(answer.message.toLowerCase()).toContain("nothing sourced");
    assertNoEmDash(answer.message);
  });

  it("defers to the route's own degraded-path refusal message", () => {
    const answer = palAnswerFromBody({
      venues: [],
      message: "I couldn't load listed venue options.",
    });
    expect(answer.status).toBe("empty");
    expect(answer.message).toContain("listed venue options");
  });

  it("drops a venue row that has no name rather than inventing a title", () => {
    const answer = palAnswerFromBody({
      venues: [{ id: "x", area: "Soho", reasons: [] }, ...VENUE_BODY.venues],
    });
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0].title).toBe("The Lamb");
  });
});

describe("palAnswerFromBody — What's-On", () => {
  it("preserves the attributable source, confidence, and time on each card", () => {
    const answer = palAnswerFromBody(WHATS_ON_BODY);
    expect(answer.status).toBe("answered");
    expect(answer.cards[0]).toMatchObject({
      key: "wo-1",
      venueId: "venue-9",
      title: "Pub quiz",
      place: "Sporting Page, Chelsea",
      note: "Starts 7pm, teams of up to 6",
      price: 2,
      confidence: "confirmed",
      when: "2026-07-18T18:30:00Z",
      provenance: {
        label: "Question One",
        url: "https://example.com/quiz",
        kind: "whats-on",
      },
    });
  });

  it("keeps the route's honest What's-On message verbatim", () => {
    const answer = palAnswerFromBody(WHATS_ON_BODY);
    expect(answer.message).toBe(WHATS_ON_BODY.message);
    assertNoEmDash(answer.message);
  });

  it("uses named-source copy when the route omits a listing message", () => {
    const answer = palAnswerFromBody({
      ...WHATS_ON_BODY,
      message: undefined,
    });
    expect(answer.message).toBe("1 listing from a named source.");
  });

  it("uses a plain empty response when the route omits its message", () => {
    const answer = palAnswerFromBody({
      mode: "whats-on",
      listings: [],
    });
    expect(answer.message).toBe("No sourced listings for that yet.");
  });

  it("drops a listing with no source label — provenance is non-negotiable", () => {
    const answer = palAnswerFromBody({
      mode: "whats-on",
      message: "Found 1 verified listing.",
      listings: [
        { id: "bad", title: "Unsourced", venue: "Nowhere", source: {} },
        WHATS_ON_BODY.listings[0],
      ],
    });
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0].key).toBe("wo-1");
  });

  it("refuses honestly on a zero-row What's-On answer", () => {
    const answer = palAnswerFromBody({
      mode: "whats-on",
      count: 0,
      listings: [],
      message: "No sourced quiz nights in Soho tonight in the listings I can check.",
    });
    expect(answer.status).toBe("empty");
    expect(answer.cards).toHaveLength(0);
    expect(answer.message).toContain("in the listings I can check");
  });

  it("marks a listing without a venueId as non-tappable (empty venueId)", () => {
    const answer = palAnswerFromBody({
      mode: "whats-on",
      message: "Found 1 verified listing.",
      listings: [
        {
          id: "wo-2",
          title: "Open mic",
          venue: "The Social",
          startsAt: "2026-07-18T20:00:00Z",
          confidence: "reported",
          source: { label: "Venue site", url: "https://example.com" },
        },
      ],
    });
    expect(answer.cards[0].venueId).toBe("");
  });
});

describe("palAnswerFromBody — malformed input", () => {
  it("treats a non-object body as an empty venue refusal", () => {
    const answer = palAnswerFromBody(null);
    expect(answer.status).toBe("empty");
    expect(answer.cards).toHaveLength(0);
  });
});

describe("formatPalWhen", () => {
  it("formats a fixed ISO instant deterministically in Europe/London (BST)", () => {
    // 2026-07-18 is a Saturday; 18:30Z is 19:30 London during BST.
    const formatted = formatPalWhen("2026-07-18T18:30:00Z");
    expect(formatted).toContain("19:30");
    expect(formatted).toContain("Sat");
  });

  it("returns an empty string for an unparseable instant", () => {
    expect(formatPalWhen("not-a-date")).toBe("");
  });
});

describe("seams and copy", () => {
  it("keeps the web-search grounding seam OFF", () => {
    expect(PAL_WEB_GROUNDING).toBe(false);
  });

  it("keeps house copy free of em dashes", () => {
    assertNoEmDash(PAL_EMPTY_MESSAGE);
    assertNoEmDash(PAL_ERROR_FALLBACK);
  });
});
