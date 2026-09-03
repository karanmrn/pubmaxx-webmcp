import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isSlopDescription, presentableDescription, SLOP_PHRASES } from "@/lib/slopFilter";

// Verbatim scraped descriptions from data/borough_embedded_pint_prices.json that
// read as AI marketing slop. Each is truncated to the point that carries a tell.
const KNOWN_SLOP = [
  // "welcome to" + exclamation-led opener
  "Welcome to Bexleyheath Working Mens Club! Located on Royal Oak Rd in Bexleyheath, our pub offers a beer garden, live sports, live music, and pool for your entertainment.",
  // "whether you"
  "Located in Bexley, The George pub is a popular spot offering delicious food, a beer garden, and live sports for entertainment. Whether you're looking to enjoy a meal, catch a game, or unwind.",
  // "vibrant"
  "Located at 40 Watling St in Bexleyheath, The Lord Hill is a pub with a vibrant atmosphere and a beer garden for you to enjoy.",
  // "boasts" (+ real fact, still filtered — voice trumps the buried date)
  "Step into history at The Dog & Duck, a unique city centre pub in London with a rich heritage dating back to 1897. This Grade II listed building boasts a fascinating past.",
  // "hidden gem"
  "Located in Stockwell, London, The Priory Arms is a hidden gem known for its extensive selection of craft beers and ciders.",
  // "must-visit"
  "Located in Islington, London, the Hope & Anchor is a Grade II listed pub with a rich history dating back to 1880. This pub is a must-visit for music lovers.",
] as const;

// Verbatim scraped descriptions that carry a genuine, specific fact and trip no
// tell — these must be preserved and rendered as-is.
const KNOWN_GOOD = [
  "Located in Limehouse, London, The Grapes is a historic pub that has been recommended by The Good Pub Guide since 1996. Overlooking the Thames, this pub is one of the oldest in London and has a rich history dating back over 500 years.",
  "The Toll Gate pub, located at 26-30 Turnpike Ln, London N8 0PS, takes its name from the toll gate erected in 1765 where High Road meets Green Lanes.",
  "Located in the picturesque backstreets of Islington, The George & Monkey is a traditional independent London pub established in 1824.",
  "Located in the center of Wandsworth, The Grapes SW18 is a historic pub with a wood-paneled interior, a heated conservatory, and a large beer garden. This Grade II listed pub is a local hub serving premium draught lagers, cider, and cask ale.",
  "The Robin Ale & Cider House is a unique pub located at 29 Crouch Hill in London. They specialize in serving craft beer, real ale, and ciders from small and independent UK breweries. With 20 taps in total.",
] as const;

describe("isSlopDescription", () => {
  it("flags every known-slop scraped description", () => {
    for (const text of KNOWN_SLOP) {
      expect(isSlopDescription(text), text).toBe(true);
    }
  });

  it("preserves known-good fact-carrying descriptions", () => {
    for (const text of KNOWN_GOOD) {
      expect(isSlopDescription(text), text).toBe(false);
    }
  });

  it("matches every required tell case-insensitively", () => {
    expect(isSlopDescription("A proper local, NESTLED between two chippies.")).toBe(true);
    expect(isSlopDescription("The PERFECT SPOT for a Sunday roast.")).toBe(true);
    expect(isSlopDescription("Come and UNWIND with a pint.")).toBe(true);
    expect(isSlopDescription("WELCOME TO the finest boozer in town.")).toBe(true);
  });

  it("treats an exclamation-led opener as slop", () => {
    expect(isSlopDescription("This is a cracking little pub! Come by after work.")).toBe(true);
  });

  it("does not trip on a '!' buried past the opening sentence", () => {
    expect(
      isSlopDescription("A 1720 coaching inn on the Thames. Regulars swear by the pies!"),
    ).toBe(false);
  });

  it("is not slop for empty, whitespace, or nullish input", () => {
    expect(isSlopDescription("")).toBe(false);
    expect(isSlopDescription("   ")).toBe(false);
    expect(isSlopDescription(null)).toBe(false);
    expect(isSlopDescription(undefined)).toBe(false);
  });
});

describe("presentableDescription", () => {
  it("returns null for slop so the honest empty state takes over", () => {
    for (const text of KNOWN_SLOP) {
      expect(presentableDescription(text)).toBeNull();
    }
  });

  it("returns the trimmed description for genuine notes", () => {
    expect(presentableDescription("  " + KNOWN_GOOD[0] + "  ")).toBe(KNOWN_GOOD[0]);
  });

  it("returns null for missing descriptions", () => {
    expect(presentableDescription(null)).toBeNull();
    expect(presentableDescription(undefined)).toBeNull();
    expect(presentableDescription("   ")).toBeNull();
  });
});

describe("slop filter over the live dataset", () => {
  // Locked against data/borough_embedded_pint_prices.json: the filter must strip
  // the overwhelming majority of scraped descriptions while sparing a real
  // minority, and nothing it preserves may contain a banned phrase.
  const dataUrl = new URL("../data/borough_embedded_pint_prices.json", import.meta.url);
  const rows = JSON.parse(readFileSync(fileURLToPath(dataUrl), "utf8")) as Array<{
    description?: string | null;
  }>;
  const unique = [...new Set(rows.map((r) => r.description).filter((d): d is string => Boolean(d)))];

  it("filters most descriptions and preserves some", () => {
    const filtered = unique.filter((d) => isSlopDescription(d));
    const preserved = unique.filter((d) => !isSlopDescription(d));
    // Sanity: the dataset still looks like the one this filter was tuned against.
    expect(unique.length).toBeGreaterThan(500);
    // The great majority is slop...
    expect(filtered.length / unique.length).toBeGreaterThan(0.85);
    // ...but the filter is not a nuke — genuine notes survive.
    expect(preserved.length).toBeGreaterThan(20);
  });

  it("never preserves a description carrying a banned phrase", () => {
    const preserved = unique.filter((d) => !isSlopDescription(d));
    for (const text of preserved) {
      const lower = text.toLowerCase();
      for (const phrase of SLOP_PHRASES) {
        expect(lower.includes(phrase), `${phrase} leaked through: ${text}`).toBe(false);
      }
    }
  });
});
