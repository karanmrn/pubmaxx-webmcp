import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/migrations/20260823200000_0117_pint_drop_authority.sql",
);
const rollbackPath = join(
  root,
  "supabase/migrations/rollback/20260823200000_0117_pint_drop_authority_rollback.sql",
);

describe("Pint Drop authority migration", () => {
  it("adds a nullable per-venue verified authority key and matching rollback", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(rollbackPath)).toBe(true);

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(
      /alter table public\.visit_reports[\s\S]*add column if not exists authority_key text/i,
    );
    expect(migration).not.toMatch(/authority_key text not null/i);
    expect(migration).not.toMatch(/create\s+index/i);

    const rollback = readFileSync(rollbackPath, "utf8");
    expect(rollback).toMatch(/drop column if exists authority_key/i);
  });
});
