// scripts/qa/migration-apply-list.mjs derives the owner apply list from
// supabase/migrations/*.sql instead of a hand-typed list, because a hand-typed
// list drifts (FABLE_HANDOFF.md's stopped updating and fell many migrations
// behind). This test pins two things: apply order is TIMESTAMP order, not the
// four-digit number embedded in a filename (real case: 0075's file has a
// later timestamp than 0076's and 0077's), and --against drops already
// applied migrations while keeping apply order for the rest.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listMigrations,
  parseAppliedVersions,
  unappliedMigrations,
  versionOf,
} from "../scripts/qa/migration-apply-list.mjs";

const temporaryRoots: string[] = [];

function makeMigrationsDir(filenames: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "migration-apply-list-"));
  temporaryRoots.push(dir);
  for (const name of filenames) {
    writeFileSync(join(dir, name), "-- fixture\n");
  }
  return dir;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const dir = temporaryRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("migration-apply-list", () => {
  it("orders by timestamp, not by the embedded four-digit number", () => {
    // Real case from supabase/migrations: 0075's file landed later than
    // 0076's and 0077's, so its timestamp is later even though its number
    // is smaller. Apply order must follow the timestamp.
    const dir = makeMigrationsDir([
      "20260806160000_0076_plan_member_group_prefs.sql",
      "20260806162000_0077_pending_plan_recaps.sql",
      "20260806235944_0075_social_crews.sql",
      "20260807000000_0078_profile_tombstone.sql",
      "20260807010000_0079_handle_claim_no_inheritance.sql",
    ]);

    expect(listMigrations(dir)).toEqual([
      "20260806160000_0076_plan_member_group_prefs.sql",
      "20260806162000_0077_pending_plan_recaps.sql",
      "20260806235944_0075_social_crews.sql",
      "20260807000000_0078_profile_tombstone.sql",
      "20260807010000_0079_handle_claim_no_inheritance.sql",
    ]);
  });

  it("includes filenames with no embedded number, by timestamp", () => {
    const dir = makeMigrationsDir([
      "20260715091628_pub_pal_plan_completion_indexes.sql",
      "20260701000000_0001_visit_reports.sql",
      "20260717055514_plan_completion_arrival.sql",
    ]);

    expect(listMigrations(dir)).toEqual([
      "20260701000000_0001_visit_reports.sql",
      "20260715091628_pub_pal_plan_completion_indexes.sql",
      "20260717055514_plan_completion_arrival.sql",
    ]);
  });

  it("drops applied migrations and keeps apply order for the rest", () => {
    const migrations = [
      "20260806160000_0076_plan_member_group_prefs.sql",
      "20260806162000_0077_pending_plan_recaps.sql",
      "20260806235944_0075_social_crews.sql",
      "20260807000000_0078_profile_tombstone.sql",
    ];

    // Mimics a raw paste of `supabase migration list` output: a header row,
    // a separator row, and rows with extra columns.
    const appliedText = [
      "   Local          | Remote         | Time (UTC)",
      "  ----------------|----------------|---------------------",
      "   20260806160000 | 20260806160000 | 2026-08-06 16:00:00",
      "   20260806235944 | 20260806235944 | 2026-08-06 23:59:44",
      "",
    ].join("\n");

    const applied = parseAppliedVersions(appliedText);
    expect(unappliedMigrations(migrations, applied)).toEqual([
      "20260806162000_0077_pending_plan_recaps.sql",
      "20260807000000_0078_profile_tombstone.sql",
    ]);
  });

  it("reads the version prefix off a filename", () => {
    expect(versionOf("20260806235944_0075_social_crews.sql")).toBe("20260806235944");
    expect(versionOf("not-a-migration.sql")).toBeNull();
  });
});
