import { describe, expect, it } from "vitest";

import {
  ROUND_CODE_ALPHABET,
  ROUND_CODE_LENGTH,
  cleanNewRoundSpend,
  cleanNewRound,
  cleanNewStop,
  firstPartyPriceItems,
  generateRoundCode,
  isValidRoundCode,
  normalizeRoundCode,
  roundTurn,
  type RoundMemberDTO,
  type RoundSpendDTO,
} from "@/lib/rounds";

describe("generateRoundCode — shape + alphabet", () => {
  const CHARSET = new Set(ROUND_CODE_ALPHABET.split(""));

  it("produces a code of the canonical length from the allowed alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoundCode();
      expect(code).toHaveLength(ROUND_CODE_LENGTH);
      for (const ch of code) expect(CHARSET.has(ch)).toBe(true);
    }
  });

  it("uses an unambiguous alphabet — no vowels, no O/0/I/1/L", () => {
    for (const banned of ["A", "E", "I", "O", "U", "0", "1", "L"]) {
      expect(ROUND_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it("does not always return the same code (is actually random)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(generateRoundCode());
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("normalizeRoundCode / isValidRoundCode — trust boundary", () => {
  it("uppercases + strips non-alphabet characters", () => {
    expect(normalizeRoundCode(" jxkq7m ")).toBe("JXKQ7M");
    expect(normalizeRoundCode("jxkq-7m")).toBe("JXKQ7M");
  });

  it("caps to the canonical length", () => {
    expect(normalizeRoundCode("JXKQ7MEXTRA")).toHaveLength(ROUND_CODE_LENGTH);
  });

  it("rejects non-strings and short codes", () => {
    expect(isValidRoundCode(null)).toBe(false);
    expect(isValidRoundCode(undefined)).toBe(false);
    expect(isValidRoundCode("")).toBe(false);
    expect(isValidRoundCode("ABC")).toBe(false);
  });

  it("a generated code is always valid", () => {
    for (let i = 0; i < 50; i += 1) expect(isValidRoundCode(generateRoundCode())).toBe(true);
  });
});

describe("cleanNewRound — validation", () => {
  it("requires a creator handle", () => {
    expect(cleanNewRound({ title: "Big night", createdByHandle: "" })).toBeNull();
    expect(cleanNewRound({ title: "Big night" })).toBeNull();
  });

  it("normalises the handle and defaults a blank title", () => {
    const round = cleanNewRound({ title: "   ", createdByHandle: " @Ken " });
    expect(round).not.toBeNull();
    expect(round!.createdByHandle).toBe("ken");
    expect(round!.title).toBe("Tonight's Round");
  });

  it("cleans a title (strips angle brackets)", () => {
    const round = cleanNewRound({ title: "Ken's <b>crawl</b>", createdByHandle: "ken" });
    expect(round!.title).toBe("Ken's bcrawl/b");
  });
});

describe("cleanNewStop — validation", () => {
  it("requires venue id, venue name, and adder handle", () => {
    expect(cleanNewStop({ venueName: "The Ship", addedByHandle: "ken" })).toBeNull();
    expect(cleanNewStop({ venueId: "venue-1", addedByHandle: "ken" })).toBeNull();
    expect(cleanNewStop({ venueId: "venue-1", venueName: "The Ship" })).toBeNull();
  });

  it("accepts a valid stop and normalises the handle", () => {
    const stop = cleanNewStop({ venueId: "venue-1", venueName: "The Ship", addedByHandle: "@Ken" });
    expect(stop).toEqual({ venueId: "venue-1", venueName: "The Ship", addedByHandle: "ken" });
  });

  it("carries an optional drop_ref (the builds-itself seam)", () => {
    const stop = cleanNewStop({
      venueId: "venue-1",
      venueName: "The Ship",
      addedByHandle: "ken",
      dropRef: "drop-42",
    });
    expect(stop!.dropRef).toBe("drop-42");
  });
});

describe("cleanNewRoundSpend - money trust boundary", () => {
  const base = {
    payerHandle: "@Ken",
    recordedByHandle: "ale",
    venueId: "venue-1",
    venueName: "The Ship",
    clientRef: "spend-1",
  };

  it("keeps a plain total as integer pence", () => {
    expect(cleanNewRoundSpend({ ...base, totalGbp: "£26.80" })).toEqual({
      payerHandle: "ken",
      recordedByHandle: "ale",
      venueId: "venue-1",
      venueName: "The Ship",
      clientRef: "spend-1",
      totalPence: 2680,
      items: [],
    });
  });

  it("derives an itemised total from drink lines validated by the shared price rules", () => {
    expect(
      cleanNewRoundSpend({
        ...base,
        clientRef: "spend-2",
        totalGbp: "99.99",
        items: [
          { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
          { drinkName: "Lime and soda", drinkCategory: "soft-drink", priceGbp: "2.40" },
        ],
      }),
    ).toEqual({
      payerHandle: "ken",
      recordedByHandle: "ale",
      venueId: "venue-1",
      venueName: "The Ship",
      clientRef: "spend-2",
      totalPence: 860,
      items: [
        { drinkName: "Guinness", drinkCategory: "beer", pricePence: 620, source: "round" },
        {
          drinkName: "Lime and soda",
          drinkCategory: "soft-drink",
          pricePence: 240,
          source: "round",
        },
      ],
    });
  });

  it("marks only an explicit demo line as lifted from a menu", () => {
    const clean = cleanNewRoundSpend({
      ...base,
      clientRef: "spend-3",
      items: [
        {
          drinkName: "House Malbec",
          drinkCategory: "wine",
          priceGbp: 7.5,
          priceSource: "demo",
        },
        { drinkName: "Guinness", drinkCategory: "beer", priceGbp: 6.2 },
        {
          drinkName: "Talisker 10",
          drinkCategory: "whisky",
          priceGbp: 5.8,
          priceSource: "made up",
        },
      ],
    });
    expect(clean?.items.map((item) => item.source)).toEqual([
      "demo",
      "round",
      "round",
    ]);
    // The caption and the write path ask this one function what was observed.
    expect(firstPartyPriceItems(clean!.items).map((item) => item.drinkName)).toEqual([
      "Guinness",
      "Talisker 10",
    ]);
  });

  it("rejects missing identities, venue details, or idempotency reference", () => {
    expect(cleanNewRoundSpend({ ...base, payerHandle: "", totalGbp: 20 })).toBeNull();
    expect(cleanNewRoundSpend({ ...base, recordedByHandle: "", totalGbp: 20 })).toBeNull();
    expect(cleanNewRoundSpend({ ...base, venueId: "", totalGbp: 20 })).toBeNull();
    expect(cleanNewRoundSpend({ ...base, venueName: "", totalGbp: 20 })).toBeNull();
    expect(cleanNewRoundSpend({ ...base, clientRef: "", totalGbp: 20 })).toBeNull();
  });

  it("rejects plain totals outside a real round envelope", () => {
    for (const totalGbp of [0, 0.99, -4, 1000.01, "not money"]) {
      expect(cleanNewRoundSpend({ ...base, totalGbp })).toBeNull();
    }
    expect(cleanNewRoundSpend({ ...base, totalGbp: 1 })).not.toBeNull();
    expect(cleanNewRoundSpend({ ...base, totalGbp: 1000 })).not.toBeNull();
  });

  it("rejects malformed drink lines instead of falling back to the supplied total", () => {
    expect(
      cleanNewRoundSpend({
        ...base,
        totalGbp: 20,
        items: [{ drinkName: "Mystery", drinkCategory: "mead", priceGbp: 6 }],
      }),
    ).toBeNull();
    expect(
      cleanNewRoundSpend({
        ...base,
        totalGbp: 20,
        items: [{ drinkName: "", drinkCategory: "beer", priceGbp: 6 }],
      }),
    ).toBeNull();
    expect(
      cleanNewRoundSpend({
        ...base,
        totalGbp: 20,
        items: [{ drinkName: "Pint", drinkCategory: "beer", priceGbp: 31 }],
      }),
    ).toBeNull();
  });

  it("caps itemisation at twenty drinks", () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      drinkName: `Drink ${index + 1}`,
      drinkCategory: "beer",
      priceGbp: 5,
    }));
    expect(cleanNewRoundSpend({ ...base, items })).toBeNull();
  });
});

describe("roundTurn - buying rotation", () => {
  const members: RoundMemberDTO[] = [
    { handle: "ken", joinedAt: "2026-07-27T18:00:00.000Z" },
    { handle: "ale", joinedAt: "2026-07-27T18:05:00.000Z" },
    { handle: "jo", joinedAt: "2026-07-27T18:10:00.000Z" },
  ];
  const spend = (payerHandle: string, recordedAt: string): RoundSpendDTO => ({
    id: `spend-${recordedAt}`,
    clientRef: `ref-${recordedAt}`,
    payerHandle,
    recordedByHandle: payerHandle,
    venueId: "venue-1",
    venueName: "The Ship",
    totalPence: 2000,
    items: [],
    recordedAt,
  });

  it("starts with the first member when nobody has bought yet", () => {
    expect(roundTurn(members, [])).toEqual({
      currentHandle: "ken",
      lastPayerHandle: null,
    });
  });

  it("moves to the member after the latest payer", () => {
    expect(
      roundTurn(members, [
        spend("ken", "2026-07-27T18:15:00.000Z"),
        spend("ale", "2026-07-27T18:30:00.000Z"),
      ]),
    ).toEqual({
      currentHandle: "jo",
      lastPayerHandle: "ale",
    });
  });

  it("wraps back to the first member after the last member pays", () => {
    expect(roundTurn(members, [spend("jo", "2026-07-27T19:00:00.000Z")])).toEqual({
      currentHandle: "ken",
      lastPayerHandle: "jo",
    });
  });

  it("returns an empty rotation for an empty crew", () => {
    expect(roundTurn([], [])).toEqual({
      currentHandle: null,
      lastPayerHandle: null,
    });
  });
});
