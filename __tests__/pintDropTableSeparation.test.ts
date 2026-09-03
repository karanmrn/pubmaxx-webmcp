import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationPath = join(
  root,
  "supabase/migrations/20260824010000_0118_pint_drop_table_separation.sql",
);
const rollbackPath = join(
  root,
  "supabase/migrations/rollback/20260824010000_0118_pint_drop_table_separation_rollback.sql",
);

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("Pint Drop persistence boundary", () => {
  it("uses one Pint Drop table name across runtime readers and writers", () => {
    expect(read("lib/pintDropTable.ts")).toContain(
      'export const PINT_DROPS_TABLE = "pint_drops"',
    );

    for (const path of [
      "lib/pintDropsStore.ts",
      "lib/pintDropLookup.ts",
      "lib/notificationsStore.ts",
      "lib/realtime.ts",
    ]) {
      const source = read(path);
      expect(source, path).not.toContain('.from("visit_reports")');
      expect(source, path).not.toMatch(/subscribeInsert\([^)]*"visit_reports"/);
      expect(source, path).not.toContain('const TABLE = "visit_reports"');
      expect(source, path).toContain("PINT_DROPS_TABLE");
    }
  });

  it("renames the legacy Pint Drop table without copying or deleting rows", () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(
      /alter table public\.visit_reports\s+rename to pint_drops/i,
    );
    expect(sql).toMatch(
      /create or replace view public\.visit_reports\s+with \(security_invoker = true\)\s+as\s+select \* from public\.pint_drops/i,
    );
    expect(sql).toMatch(/update public\.pint_drops/i);
    expect(sql).not.toMatch(/create table public\.pint_drops/i);
    expect(sql).not.toMatch(/delete from public\.visit_reports/i);
  });

  it("provides a lossless table-name rollback", () => {
    const sql = readFileSync(rollbackPath, "utf8");
    expect(sql).toMatch(/drop view if exists public\.visit_reports/i);
    expect(sql).toMatch(
      /alter table public\.pint_drops\s+rename to visit_reports/i,
    );
    expect(sql).not.toMatch(/\b(delete|truncate)\b/i);
  });
});
