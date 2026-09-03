import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("clean-main CI release gate", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

  it("runs a dedicated production build", () => {
    expect(workflow).toContain("name: Production build");
    expect(workflow).toMatch(/production-build:[\s\S]*run: npm run build/);
  });

  it("does not persist the workflow token in build checkouts", () => {
    const checkouts = workflow.match(/uses: actions\/checkout@v4/g) ?? [];
    const protectedCheckouts =
      workflow.match(
        /uses: actions\/checkout@v4\n\s+with:\n\s+persist-credentials: false/g,
      ) ?? [];

    expect(checkouts.length).toBeGreaterThan(0);
    expect(protectedCheckouts).toHaveLength(checkouts.length);
  });

  it("gives TypeScript and production Playwright builds enough heap", () => {
    expect(workflow).toMatch(
      /name: Typecheck[\s\S]*NODE_OPTIONS: "--max-old-space-size=6144"[\s\S]*run: npx tsc --noEmit/,
    );
    expect(workflow.match(/NODE_OPTIONS: "--max-old-space-size=6144"/g)).toHaveLength(5);
  });

  it("gates coverage and freshness independently", () => {
    expect(workflow).toMatch(/coverage:[\s\S]*name: Coverage[\s\S]*run: >-[\s\S]*npm run coverage/);
    expect(workflow).toMatch(
      /coverage:[\s\S]*PUBMAX_RLS_NO_PG: "1"[\s\S]*--exclude '__tests__\/\*\*\/\*Migration\.test\.ts'/,
    );
    expect(workflow).toMatch(
      /freshness:[\s\S]*name: Freshness release gate[\s\S]*npm run check:freshness -- --artifacts-only[\s\S]*node scripts\/check-production-store-freshness\.mjs/,
    );
  });
});
