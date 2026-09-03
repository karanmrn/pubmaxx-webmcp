import { describe, it, expect } from "vitest";
import {
  isValidDrinkPriceUpdate,
  parseDrinkPriceUpdates,
  mergeDrinkPriceUpdates,
  drinkFromPriceUpdate,
  applyDrinkPriceUpdatesToMenu,
  DRINK_PRICE_UPDATE_PROVENANCE,
  type DrinkPriceUpdate,
  type DrinkMenuRow,
} from "@/lib/drinkPriceUpdates";
import type { Drink } from "@/lib/drinks";

const NOW = Date.parse("2026-07-07T12:00:00.000Z");

function makeUpdate(overrides: Partial<DrinkPriceUpdate> = {}): DrinkPriceUpdate {
  return {
    venueKey: "the test arms|1 test street|51.50000|-0.10000",
    drinkName: "Doom Bar",
    category: "beer",
    priceGbp: 5.29,
    source: {
      label: "J D Wetherspoon — official site",
      url: "https://www.jdwetherspoon.com/pubs/all-pubs/the-test-arms",
      licence: "All rights reserved — first-party publisher, attributed use only.",
    },
    observedAt: "2026-07-01T00:00:00.000Z",
    lane: "publisher",
    ...overrides,
  };
}

function makeRow(overrides: Partial<DrinkMenuRow> = {}): DrinkMenuRow {
  return {
    venueKey: "the test arms|1 test street|51.50000|-0.10000",
    drinkName: "Doom Bar",
    category: "beer",
    priceGbp: 6.5,
    latestContributorAt: null,
    ...overrides,
  };
}

describe("isValidDrinkPriceUpdate", () => {
  it("accepts a well-formed update", () => {
    expect(isValidDrinkPriceUpdate(makeUpdate(), NOW)).toBe(true);
    // price 0 (free-drink promo) is allowed.
    expect(isValidDrinkPriceUpdate(makeUpdate({ priceGbp: 0 }), NOW)).toBe(true);
    // Coffee is a first-class DrinkCategory, not an outside-taxonomy token.
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ drinkName: "Flat white", category: "coffee" }), NOW),
    ).toBe(true);
  });

  it("rejects non-objects and missing fields", () => {
    expect(isValidDrinkPriceUpdate(null, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(undefined, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate("nope", NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(42, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({}, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(makeUpdate({ venueKey: "" }), NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(makeUpdate({ drinkName: "" }), NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), category: "" }, NOW)).toBe(false);
    // tea is not a DrinkCategory (cider likewise lives under beer/other).
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), category: "tea" }, NOW)).toBe(false);
  });

  it("rejects bad prices", () => {
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), priceGbp: "5.5" }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(makeUpdate({ priceGbp: -1 }), NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), priceGbp: NaN }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), priceGbp: Infinity }, NOW)).toBe(false);
  });

  it("rejects malformed optional metadata", () => {
    expect(isValidDrinkPriceUpdate(makeUpdate({ producer: "Adnams", abv: 0.5 }), NOW)).toBe(true);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), producer: "" }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), style: "" }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), region: "" }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), servingSize: "" }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), abv: -0.1 }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), abv: 101 }, NOW)).toBe(false);
  });

  it("requires a labelled, http(s), LICENCED source (governance: source+licence+observedAt)", () => {
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), source: null }, NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate({ ...makeUpdate(), source: "nope" }, NOW)).toBe(false);
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ source: { label: "", url: "https://x.com", licence: "X" } }), NOW),
    ).toBe(false);
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ source: { label: "X", url: "not-a-url", licence: "X" } }), NOW),
    ).toBe(false);
    // Empty-string url (falsy-string branch of the http(s) guard).
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ source: { label: "X", url: "", licence: "X" } }), NOW),
    ).toBe(false);
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ source: { label: "X", url: "ftp://x.com", licence: "X" } }), NOW),
    ).toBe(false);
    // Missing licence — a source without a documented licence is not permissible.
    expect(
      isValidDrinkPriceUpdate(makeUpdate({ source: { label: "X", url: "https://x.com", licence: "" } }), NOW),
    ).toBe(false);
  });

  it("rejects a missing/invalid/future observedAt (never present stale-or-fake as live)", () => {
    expect(isValidDrinkPriceUpdate(makeUpdate({ observedAt: "" }), NOW)).toBe(false);
    expect(isValidDrinkPriceUpdate(makeUpdate({ observedAt: "yesterday" }), NOW)).toBe(false);
    // A future observation is a data error.
    expect(isValidDrinkPriceUpdate(makeUpdate({ observedAt: "2026-07-08T00:00:00.000Z" }), NOW)).toBe(false);
  });
});

describe("parseDrinkPriceUpdates", () => {
  it("drops bad rows and keeps good ones", () => {
    const parsed = parseDrinkPriceUpdates(
      [makeUpdate(), { garbage: true }, makeUpdate({ drinkName: "Lager", priceGbp: -3 })],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].drinkName).toBe("Doom Bar");
  });

  it("accepts a { updates: [...] } envelope", () => {
    const parsed = parseDrinkPriceUpdates({ updates: [makeUpdate()] }, NOW);
    expect(parsed).toHaveLength(1);
  });

  it("returns [] for non-array, non-envelope input", () => {
    expect(parseDrinkPriceUpdates(null, NOW)).toEqual([]);
    expect(parseDrinkPriceUpdates("nope", NOW)).toEqual([]);
    expect(parseDrinkPriceUpdates(42, NOW)).toEqual([]);
    expect(parseDrinkPriceUpdates({}, NOW)).toEqual([]);
  });

  it("keeps only the newest observation per venue+drink+category", () => {
    const parsed = parseDrinkPriceUpdates(
      [
        makeUpdate({ priceGbp: 5.0, observedAt: "2026-06-01T00:00:00.000Z" }),
        makeUpdate({ priceGbp: 5.9, observedAt: "2026-07-02T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].priceGbp).toBe(5.9);
  });

  it("ignores an OLDER duplicate arriving after the newest (order-independent)", () => {
    const parsed = parseDrinkPriceUpdates(
      [
        makeUpdate({ priceGbp: 5.9, observedAt: "2026-07-02T00:00:00.000Z" }),
        // Same key, older observedAt, appears SECOND — must not overwrite the newer one.
        makeUpdate({ priceGbp: 5.0, observedAt: "2026-06-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].priceGbp).toBe(5.9);
  });

  it("treats different drinks at the same venue as independent rows", () => {
    const parsed = parseDrinkPriceUpdates(
      [makeUpdate({ drinkName: "Doom Bar" }), makeUpdate({ drinkName: "Guinness", category: "beer" })],
      NOW,
    );
    expect(parsed).toHaveLength(2);
  });

  it("treats the same drink name in a different valid category as an independent row", () => {
    const parsed = parseDrinkPriceUpdates(
      [
        makeUpdate({ drinkName: "House Blend", category: "wine" }),
        makeUpdate({ drinkName: "House Blend", category: "cocktail" }),
      ],
      NOW,
    );
    expect(parsed).toHaveLength(2);
  });
});

describe("mergeDrinkPriceUpdates precedence", () => {
  const keyFor = (row: DrinkMenuRow) => row.venueKey;

  it("a sourced update overrides the baseline price and stamps attribution", () => {
    const row = makeRow();
    const [merged] = mergeDrinkPriceUpdates([row], [makeUpdate({ priceGbp: 4.99 })], keyFor);
    expect(merged.priceGbp).toBe(4.99);
    expect(merged.sourcedPrice).not.toBeNull();
    expect(merged.sourcedPrice?.provenance).toBe(DRINK_PRICE_UPDATE_PROVENANCE);
    expect(merged.sourcedPrice?.provenance).toBe("sourced");
    expect(merged.sourcedPrice?.sourceUrl).toBe(
      "https://www.jdwetherspoon.com/pubs/all-pubs/the-test-arms",
    );
    expect(merged.sourcedPrice?.licence).toContain("first-party");
    expect(merged.sourcedPrice?.observedAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("no update for this venue+drink → baseline stands, sourcedPrice null", () => {
    const row = makeRow();
    const [merged] = mergeDrinkPriceUpdates([row], [], keyFor);
    expect(merged.priceGbp).toBe(6.5);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("an update for a DIFFERENT drink at the same venue does not affect this row", () => {
    const row = makeRow({ drinkName: "Guinness" });
    const [merged] = mergeDrinkPriceUpdates([row], [makeUpdate({ drinkName: "Doom Bar" })], keyFor);
    expect(merged.priceGbp).toBe(6.5);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("a FRESHER community observation beats the sourced update (community stays live)", () => {
    const row: DrinkMenuRow = {
      ...makeRow(),
      priceGbp: 4.5,
      latestContributorAt: "2026-07-05T00:00:00.000Z", // after the update's observedAt
    };
    const [merged] = mergeDrinkPriceUpdates(
      [row],
      [makeUpdate({ priceGbp: 5.5, observedAt: "2026-07-01T00:00:00.000Z" })],
      keyFor,
    );
    // The community price is untouched; the update is ignored.
    expect(merged.priceGbp).toBe(4.5);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("a community observation EQUALLY as fresh as the update also wins (>= not >)", () => {
    const row: DrinkMenuRow = {
      ...makeRow(),
      priceGbp: 4.5,
      latestContributorAt: "2026-07-01T00:00:00.000Z",
    };
    const [merged] = mergeDrinkPriceUpdates(
      [row],
      [makeUpdate({ priceGbp: 5.5, observedAt: "2026-07-01T00:00:00.000Z" })],
      keyFor,
    );
    expect(merged.priceGbp).toBe(4.5);
    expect(merged.sourcedPrice).toBeNull();
  });

  it("a STALE community observation does NOT block a fresher sourced update", () => {
    const row: DrinkMenuRow = {
      ...makeRow(),
      priceGbp: 4.5,
      latestContributorAt: "2026-06-01T00:00:00.000Z", // BEFORE the update
    };
    const [merged] = mergeDrinkPriceUpdates(
      [row],
      [makeUpdate({ priceGbp: 5.5, observedAt: "2026-07-01T00:00:00.000Z" })],
      keyFor,
    );
    expect(merged.priceGbp).toBe(5.5);
    expect(merged.sourcedPrice?.provenance).toBe("sourced");
  });

  it("preserves extra fields on the row (generic over T extends DrinkMenuRow)", () => {
    type ExtendedRow = DrinkMenuRow & { drinkId: string };
    const row: ExtendedRow = { ...makeRow(), drinkId: "abc123" };
    const [merged] = mergeDrinkPriceUpdates([row], [makeUpdate()], keyFor);
    expect(merged.drinkId).toBe("abc123");
  });
});

describe("drink menu materialisation from updates", () => {
  function makeDrink(overrides: Partial<Drink> = {}): Drink {
    return {
      id: "drink-doom-bar",
      category: "beer",
      name: "Doom Bar",
      priceGbp: 6.5,
      servingSize: "pint",
      provenance: {
        source: "app-dataset",
        licence: "first-party",
        observedAt: "2026-07-01T12:00:00.000Z",
      },
      ...overrides,
    };
  }

  it("turns an update into a stable Drink with provenance and low/no classification", () => {
    const drink = drinkFromPriceUpdate(
      makeUpdate({
        drinkName: "Lucky Saint 0.5%",
        priceGbp: 4.6,
        producer: "Lucky Saint",
        abv: 0.5,
        style: "Low-alcohol lager",
        servingSize: "330ml bottle",
      }),
    );

    expect(drink.id).toMatch(/^drink-/);
    expect(drink.name).toBe("Lucky Saint 0.5%");
    expect(drink.priceGbp).toBe(4.6);
    expect(drink.alcoholType).toBe("low-no");
    expect(drink.provenance).toEqual({
      source: "J D Wetherspoon — official site",
      sourceUrl: "https://www.jdwetherspoon.com/pubs/all-pubs/the-test-arms",
      licence: "All rights reserved — first-party publisher, attributed use only.",
      observedAt: "2026-07-01T00:00:00.000Z",
      lane: "drink-price-update",
    });
  });

  it("updates matching menu drinks and appends new drinks for the same venue", () => {
    const venueKey = "the test arms|1 test street|51.50000|-0.10000";
    const menu = applyDrinkPriceUpdatesToMenu(
      venueKey,
      [makeDrink()],
      [
        makeUpdate({ drinkName: "Doom Bar", priceGbp: 4.99 }),
        makeUpdate({
          drinkName: "Lucky Saint 0.5%",
          priceGbp: 4.6,
          producer: "Lucky Saint",
          abv: 0.5,
        }),
        makeUpdate({
          venueKey: "elsewhere|1 test street|51.50000|-0.10000",
          drinkName: "Ignored",
          priceGbp: 1,
        }),
      ],
    );

    expect(menu).toHaveLength(2);
    expect(menu.find((d) => d.name === "Doom Bar")!.priceGbp).toBe(4.99);
    expect(menu.find((d) => d.name === "Doom Bar")!.id).toBe("drink-doom-bar");
    expect(menu.find((d) => d.name === "Lucky Saint 0.5%")!.alcoholType).toBe("low-no");
    expect(menu.some((d) => d.name === "Ignored")).toBe(false);
  });
});
