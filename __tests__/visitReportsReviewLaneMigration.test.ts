import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readMigration(suffix: string): string {
  const dir = path.join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((entry) => entry.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`migration *_${suffix}.sql not found`);
  return readFileSync(path.join(dir, file), "utf8");
}

describe("Visit Report review-lane migration", () => {
  it("adds constrained observed conditions and the contributor count index", () => {
    const sql = readMigration("0059_visit_report_review_lane");

    expect(sql).toMatch(/add column if not exists noise text/);
    expect(sql).toMatch(/noise is null or noise in \('easy-to-talk', 'loud', 'had-to-shout'\)/);
    expect(sql).toMatch(/add column if not exists seating text/);
    expect(sql).toMatch(/seating is null or seating in \('plenty', 'tight', 'standing'\)/);
    expect(sql).toMatch(/add column if not exists service_wait text/);
    expect(sql).toMatch(/service_wait is null or service_wait in \('quick', 'some-wait', 'long'\)/);
    expect(sql).toMatch(/structured_visit_reports_contributor_idx[\s\S]*\(handle, status\)/);
  });

  it("indexes the moderation queue the way the admin route reads it", () => {
    const sql = readMigration("0059_visit_report_review_lane");

    expect(sql).toMatch(
      /structured_visit_reports_flagged_review_idx[\s\S]*\(reported_at desc\)[\s\S]*where moderated_at is null and report_count > 0/,
    );
  });

  it("is additive and keeps the service-role-only posture", () => {
    const sql = readMigration("0059_visit_report_review_lane");

    expect(sql).not.toMatch(/drop table/i);
    expect(sql).not.toMatch(/drop column/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/alter table public\.structured_visit_reports enable row level security/);
    expect(sql).toMatch(/revoke all on public\.structured_visit_reports from anon, authenticated/);
    expect(sql).toMatch(/grant all on public\.structured_visit_reports to service_role/);
  });
});
