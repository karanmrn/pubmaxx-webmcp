import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("PubMapCanvas nearby distance contract", () => {
  it("uses the shared nearby distance formatter", () => {
    const source = readFileSync(
      join(process.cwd(), "components/PubMapCanvas.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /import\s*\{[\s\S]*?formatLogNearbyDistance[\s\S]*?\}\s*from\s*["']@\/lib\/mapLogIntent["']/,
    );
    expect(source).not.toMatch(/km\s*<\s*1\s*\?\s*`\$\{Math\.round\(km\s*\*\s*1000\)/);
  });
});
