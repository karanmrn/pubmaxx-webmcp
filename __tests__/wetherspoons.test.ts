import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  candidateRowsFromPayload,
  mapSectionToCategory,
  matchVenue,
  parsePubMenuPage,
  slugFromMenuUrl,
  splitPubSlug,
  type DatasetVenue,
  type WetherspoonsMenuPayload,
} from "@/lib/wetherspoons";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("slug parsing", () => {
  it("extracts the slug from a real menu URL", () => {
    expect(
      slugFromMenuUrl("https://www.jdwetherspoon.com/pub-menus/the-rochester-castle-stoke-newington/"),
    ).toBe("the-rochester-castle-stoke-newington");
  });

  it("returns null for a non-menu URL", () => {
    expect(slugFromMenuUrl("https://www.jdwetherspoon.com/pubs/the-red-lion-crawley/")).toBeNull();
  });

  it("splits a single-word locality slug", () => {
    expect(splitPubSlug("the-railway-bell-barnet")).toEqual({
      name: "The Railway Bell",
      locality: "Barnet",
    });
  });

  it("splits a known multi-word locality tail", () => {
    expect(splitPubSlug("hamilton-hall-city-of-london")).toEqual({
      name: "Hamilton Hall",
      locality: "City Of London",
    });
    expect(splitPubSlug("the-rochester-castle-stoke-newington")).toEqual({
      name: "The Rochester Castle",
      locality: "Stoke Newington",
    });
  });
});

describe("parsePubMenuPage (real fixture)", () => {
  const html = readFixture("wetherspoons-pub-menu-page.html");
  const url = "https://www.jdwetherspoon.com/pub-menus/the-rochester-castle-stoke-newington/";

  it("parses identity from the real first-party page, snapshot-pinned", () => {
    const identity = parsePubMenuPage(html, url);
    // Snapshot the whole identity — if the page's structure drifts (title suffix,
    // canonical tag, PDF link), this fails loudly in CI.
    expect(identity).toMatchInlineSnapshot(`
      {
        "locality": "Stoke Newington",
        "menuDocUrl": "https://www.jdwetherspoon.com/wp-content/uploads/menus/currentmenus/MENU_3.pdf",
        "name": "The Rochester Castle",
        "pageUrl": "https://www.jdwetherspoon.com/pub-menus/the-rochester-castle-stoke-newington/",
      }
    `);
  });

  it("HONEST RECORD: the real page carries NO per-drink prices", () => {
    // The whole point of the probe: the first-party web page has no £ prices and
    // no priced menu items. If this ever changes (a real priced feed appears),
    // this assertion fires and we revisit the extractor.
    expect(html.includes("£")).toBe(false);
    const identity = parsePubMenuPage(html, url)!;
    const payload: WetherspoonsMenuPayload = { identity, items: [] };
    expect(candidateRowsFromPayload(payload)).toEqual([]);
  });

  it("returns null for HTML that is not a menu page", () => {
    expect(parsePubMenuPage("<html><body>nope</body></html>", "https://x.example/")).toBeNull();
  });
});

describe("category mapping (their sections → our taxonomy)", () => {
  it("maps representative Wetherspoons sections", () => {
    expect(mapSectionToCategory("Draught beer")).toBe("beer");
    expect(mapSectionToCategory("Cask ale")).toBe("beer");
    expect(mapSectionToCategory("Wines")).toBe("wine");
    expect(mapSectionToCategory("Prosecco & sparkling")).toBe("wine");
    expect(mapSectionToCategory("Gin")).toBe("gin");
    expect(mapSectionToCategory("Whisky")).toBe("whisky");
    expect(mapSectionToCategory("Vodka")).toBe("vodka");
    expect(mapSectionToCategory("Rum")).toBe("rum");
    expect(mapSectionToCategory("Cocktails")).toBe("cocktail");
    expect(mapSectionToCategory("Shots")).toBe("shot");
    expect(mapSectionToCategory("Soft drinks")).toBe("soft-drink");
    expect(mapSectionToCategory("Coffee")).toBe("coffee");
    expect(mapSectionToCategory("Hot drinks")).toBe("coffee");
    expect(mapSectionToCategory("Alcohol-free")).toBe("alcohol-free");
    expect(mapSectionToCategory("No & Low")).toBe("alcohol-free");
    expect(mapSectionToCategory("Other")).toBe("other");
  });

  it("drops (null) an unmappable section — never guesses", () => {
    expect(mapSectionToCategory("Burgers")).toBeNull();
    expect(mapSectionToCategory("")).toBeNull();
  });
});

describe("candidateRowsFromPayload", () => {
  const identity = {
    name: "The Rochester Castle",
    locality: "Stoke Newington",
    pageUrl: "https://www.jdwetherspoon.com/pub-menus/the-rochester-castle-stoke-newington/",
    menuDocUrl: null,
  };

  it("emits a row per priced, mappable item and drops the rest", () => {
    const payload: WetherspoonsMenuPayload = {
      identity,
      items: [
        { name: "Ruddles Best", section: "Cask ale", priceGbp: 2.59 },
        { name: "Pinot Grigio", section: "Wines", priceGbp: 4.1, servingSize: "175ml" },
        { name: "Chicken burger", section: "Burgers", priceGbp: 7.5 }, // unmappable → dropped
        { name: "No price lager", section: "Draught beer", priceGbp: Number.NaN }, // no price → dropped
        { name: "", section: "Gin", priceGbp: 3 }, // no name → dropped
      ],
    };
    const rows = candidateRowsFromPayload(payload);
    expect(rows.map((r) => [r.drinkName, r.category, r.priceGbp])).toEqual([
      ["Ruddles Best", "beer", 2.59],
      ["Pinot Grigio", "wine", 4.1],
    ]);
  });
});

describe("matchVenue against OUR dataset (pure, conservative)", () => {
  const dataset: DatasetVenue[] = [
    { venueKey: "k-furze", name: "The Furze Wren (Wetherspoons)", address: "Broadway Square, Bexleyheath DA6 7DY" },
    { venueKey: "k-rochester", name: "The Rochester Castle", address: "145 High St, Stoke Newington, London N16 0NY" },
    { venueKey: "k-railway", name: "The Railway Bell", address: "13 East Barnet Rd, Barnet EN4 8RR" },
    { venueKey: "k-other-castle", name: "The Rochester Castle", address: "Somewhere else, Manchester M1 1AA" },
  ];

  it("matches by strong name overlap + locality-in-address", () => {
    const m = matchVenue(
      { name: "The Rochester Castle", locality: "Stoke Newington", pageUrl: "u", menuDocUrl: null },
      dataset,
    );
    expect(m?.venueKey).toBe("k-rochester");
  });

  it("drops (null) when locality does not appear in any address", () => {
    const m = matchVenue(
      { name: "The Rochester Castle", locality: "Brighton", pageUrl: "u", menuDocUrl: null },
      dataset,
    );
    expect(m).toBeNull();
  });

  it("refuses ambiguous ties rather than guessing", () => {
    // Two identical-name venues; empty locality relaxes to name-only, so both tie.
    const m = matchVenue(
      { name: "The Rochester Castle", locality: "", pageUrl: "u", menuDocUrl: null },
      dataset,
    );
    expect(m).toBeNull();
  });

  it("drops a pub absent from our dataset (never fabricated)", () => {
    const m = matchVenue(
      { name: "The Nonexistent Tavern", locality: "Nowhere", pageUrl: "u", menuDocUrl: null },
      dataset,
    );
    expect(m).toBeNull();
  });
});
