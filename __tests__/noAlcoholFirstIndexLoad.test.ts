import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Alcohol-free-first crawl style must load the corroborated NA price index the
// same way the no-alcohol experience lens does. Without that wiring,
// scoreVenue's NA bias always sees an empty map.

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");

describe("noAlcoholFirst crawl style loads the NA price index", () => {
  it("calls loadNoAlcoholPriceIndex when crawlStyle is noAlcoholFirst", () => {
    expect(pubMap).toMatch(
      /filters\.crawlStyle === ["']noAlcoholFirst["'][\s\S]*loadNoAlcoholPriceIndex\(\)/,
    );
  });

  it("still loads the index when the experience lens is no-alcohol", () => {
    expect(pubMap).toMatch(
      /next === ["']no-alcohol["'][\s\S]*loadNoAlcoholPriceIndex\(\)/,
    );
  });
});
