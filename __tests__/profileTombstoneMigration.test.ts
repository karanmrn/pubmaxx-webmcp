import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const FORWARD = "supabase/migrations/20260807000000_0078_profile_tombstone.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260807000000_0078_profile_tombstone_rollback.sql";

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("0078 profile tombstone migration", () => {
  it("adds tombstoned_at and stamps it from auth.users delete, not user_id null", () => {
    const sql = read(FORWARD);
    expect(sql).toMatch(/add column if not exists tombstoned_at timestamptz null/i);
    expect(sql).toMatch(/stamp_profile_tombstone_on_auth_user_delete/i);
    expect(sql).toMatch(/before delete on auth\.users/i);
    expect(sql).toMatch(/where user_id = old\.id/i);
    // Must not redefine the FK to cascade-delete profiles.
    expect(sql).not.toMatch(/on delete cascade/i);
  });

  it("rollback drops trigger, function, index, and column", () => {
    const sql = read(ROLLBACK);
    expect(sql).toMatch(/drop trigger if exists profiles_tombstone_on_auth_user_delete/i);
    expect(sql).toMatch(/drop function if exists public\.stamp_profile_tombstone_on_auth_user_delete/i);
    expect(sql).toMatch(/drop column if exists tombstoned_at/i);
  });
});
