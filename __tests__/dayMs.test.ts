import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DAY_MS } from "@/lib/dayMs";

describe("DAY_MS owner", () => {
  it("is one day in milliseconds", () => {
    expect(DAY_MS).toBe(86_400_000);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("is the only 86_400_000 in the scoped day-window owner consumers", () => {
    for (const rel of [
      "lib/weeklyDigest.ts",
      "lib/pintContributions.ts",
      "lib/a2hsPrompt.ts",
      "lib/dailyActivity.ts",
      "lib/priceConfirmStore.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), rel), "utf8");
      expect(source).not.toMatch(/86_400_000/);
      expect(source).toMatch(/DAY_MS/);
    }
  });
});
