import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KEYLESS_CONVEX_FLAGS } from "@/lib/convex/contracts";

const ROOT = process.cwd();

// Wayfinder Wave 0.6 contains Convex to Pub Pal. Migration infrastructure and
// the pre-ruling Plan Completion scaffold are grandfathered, not expansion
// points. Any addition must arrive with an explicit owner-approved map ruling.
const PAL_TABLES = ["pubPals", "palMemories", "masteryEvents", "palUnlocks"];
const MIGRATION_TABLES = ["migrationBatches", "shadowReadComparisons"];
const FROZEN_PRE_RULING_TABLES = ["planCompletions"];

function schemaTables(): string[] {
  const schema = readFileSync(join(ROOT, "convex/schema.ts"), "utf8");
  return [...schema.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): defineTable\(/gm)]
    .map((match) => match[1])
    .sort();
}

describe("Convex domain containment (Wayfinder Wave 0.6)", () => {
  it("rejects unapproved Convex schema domains", () => {
    expect(schemaTables()).toEqual(
      [...PAL_TABLES, ...MIGRATION_TABLES, ...FROZEN_PRE_RULING_TABLES].sort(),
    );
  });

  it("keeps Plan completion and collaboration on the Supabase seam", () => {
    expect(KEYLESS_CONVEX_FLAGS.plan_completion).toBe("supabase");

    for (const file of ["lib/planStore.ts", "lib/planCollaborationStore.ts"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).not.toMatch(/(?:@\/lib\/convex|from ["']convex(?:\/|["']))/);
      expect(source, file).toContain("Supabase");
    }
  });
});
