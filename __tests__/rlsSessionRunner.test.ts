import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("RLS session runner", () => {
  it("makes a missing-Postgres skip impossible to mistake for a pass", () => {
    const result = spawnSync("npm", ["run", "test:rls"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        PUBMAX_RLS_NO_PG: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("RLS SESSION SUITE SKIPPED");
    expect(result.stdout).toContain("THIS IS NOT A PASS");
    expect(result.stdout).toContain("__tests__/rlsWave2Session.test.ts");
    expect(result.stdout).toContain("__tests__/socialCrewMigration.test.ts");
    expect(result.stdout).toContain("__tests__/socialCrewLegacyRoutesRls.test.ts");
    expect(result.stdout).toContain("__tests__/pintDropVerifiedReportsMigrationEffective.test.ts");
    expect(result.stdout).toContain("PostgreSQL 16+ binaries not found");
    expect(result.stdout).toContain("They were NOT executed");
    expect(result.stdout).toContain("zero policy proofs ran on this host");
  });
});
