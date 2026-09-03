import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260816180000_0107_venue_occupancy_reports.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260816180000_0107_venue_occupancy_reports_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0107 venue_occupancy_reports", () => {
  it("stores a signed-in crowd report and maps the visit-report scale", () => {
    expect(sql).toMatch(/create table if not exists public\.venue_occupancy_reports/);
    expect(sql).toMatch(/venue_id text not null/);
    expect(sql).toMatch(/reported_at timestamptz not null default now\(\)/);
    expect(sql).toMatch(
      /reporter_user_id uuid not null references auth\.users\(id\) on delete cascade/,
    );
    expect(sql).toMatch(/source text not null default 'crowd'/);
    expect(sql).toMatch(/level in \('empty', 'some_seats', 'full'\)/);
    expect(sql).toMatch(/source = 'crowd'/);
    expect(sql).toMatch(/quiet \| steady \| rammed/);
  });

  it("keeps the table service-role only", () => {
    expect(sql).toMatch(
      /alter table public\.venue_occupancy_reports enable row level security;/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.venue_occupancy_reports from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.venue_occupancy_reports to service_role;/,
    );
    expect(sql).not.toMatch(/grant [^;]* to authenticated/i);
    expect(sql).not.toMatch(/using \(true\)/);
    expect(sql).toMatch(
      /venue_occupancy_reports_anon_deny[\s\S]*using \(false\) with check \(false\)/,
    );
    expect(sql).toMatch(
      /venue_occupancy_reports_authenticated_deny[\s\S]*using \(false\) with check \(false\)/,
    );
  });

  it("indexes the now read and the retake lookup", () => {
    expect(sql).toMatch(/venue_occupancy_reports_now_idx/);
    expect(sql).toMatch(/venue_occupancy_reports_retake_idx/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.venue_occupancy_reports;/);
  });
});
