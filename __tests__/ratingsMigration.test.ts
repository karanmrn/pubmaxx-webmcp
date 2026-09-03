import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Migration files carry a remote-ledger timestamp prefix
// (`<version>_NNNN_name.sql`) so the Supabase preview-branch check matches them.
// Resolve by the stable `NNNN_name` suffix rather than a fixed prefix.
function readMigration(suffix: string): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`migration *_${suffix}.sql not found`);
  return readFileSync(path.join(dir, file), "utf8");
}

describe("ratings migration RLS posture", () => {
  it("keeps raw rating rows API-only, not public-readable", () => {
    const sql = readMigration("0020_ratings");

    expect(sql).toMatch(/alter table public\.drink_ratings enable row level security;/);
    expect(sql).toMatch(/alter table public\.venue_ratings enable row level security;/);
    expect(sql).toMatch(/drop policy if exists drink_ratings_public_read/);
    expect(sql).toMatch(/drop policy if exists venue_ratings_public_read/);
    expect(sql).not.toMatch(/create policy drink_ratings_public_read/);
    expect(sql).not.toMatch(/create policy venue_ratings_public_read/);
  });
});
