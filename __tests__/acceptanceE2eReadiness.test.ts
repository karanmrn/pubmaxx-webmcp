import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const STORAGE_DENIAL_SPECS = [
  "e2e/near-venue-acceptance.spec.ts",
  "e2e/tonight-trusted-ui.spec.ts",
  "e2e/venue-acceptance.spec.ts",
] as const;

describe("acceptance storage-denial browser readiness", () => {
  it("uses the visible error as completion instead of a fixed delay", () => {
    for (const path of STORAGE_DENIAL_SPECS) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).not.toContain("await page.waitForTimeout(400);");
    }
  });
});
