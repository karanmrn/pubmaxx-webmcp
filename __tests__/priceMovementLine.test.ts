import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { priceMovementLine } from "@/lib/priceMovementLine";

// One sentence, two surfaces. The venue sheet's price history and the Pint
// Index's national yardstick print the same movement line under a then-and-now
// pair. They are separate price lanes and stay fenced from each other, but a
// reader meets both, so the wording is shared rather than copied.

const ROOT = resolve(__dirname, "..");
const CONSUMERS = [
  "components/map/VenuePriceThen.tsx",
  "components/pintindex/NationalPintBenchmarks.tsx",
];

describe("the movement line", () => {
  it("counts the years when there are years to count", () => {
    expect(priceMovementLine(3.61, 35)).toBe("Up £3.61 in 35 years.");
    expect(priceMovementLine(0.4, 1)).toBe("Up £0.40 in 1 year.");
    expect(priceMovementLine(-0.5, 4)).toBe("Down £0.50 in 4 years.");
  });

  it("says 'since then' rather than claiming a gap of no years", () => {
    expect(priceMovementLine(1.2, 0)).toBe("Up £1.20 since then.");
  });

  it("gives a flat price its own sentence rather than a £0.00 movement", () => {
    expect(priceMovementLine(0, 6)).toBe("Same price in 6 years.");
    expect(priceMovementLine(0.001, 6)).toBe("Same price in 6 years.");
  });

  it("is the only place either surface builds the sentence", () => {
    // A second copy is how the two surfaces come to read differently, so the
    // fence is that neither one owns a builder of its own.
    for (const consumer of CONSUMERS) {
      const source = readFileSync(join(ROOT, consumer), "utf8");
      expect(source, `${consumer} must use the shared line`).toMatch(/priceMovementLine\(/);
      expect(source, `${consumer} must not rebuild the line`).not.toMatch(/Same price \$\{/);
    }
  });
});
