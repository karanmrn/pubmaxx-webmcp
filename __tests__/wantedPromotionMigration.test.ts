import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Wanted promotion migration", () => {
  it("adds paired durable list and time columns without a new table", () => {
    const sql = readFileSync(
      join(ROOT, "supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql"),
      "utf8",
    );

    expect(sql).toContain("alter table public.wanteds");
    expect(sql).toContain("promoted_list_type");
    expect(sql).toContain("promoted_at");
    expect(sql).toMatch(/check[\s\S]*promoted_list_type[\s\S]*promoted_at/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).toContain("promote_wanted_to_saved_list");
    expect(sql).toMatch(/for\s+update/i);
    expect(sql).toMatch(/insert\s+into\s+public\.saved_pubs/i);
    expect(sql).toMatch(/v_wanted\.status\s*<>\s*'open'/i);
    expect(sql).toMatch(/on\s+conflict\s*\(profile_id, venue_id, list_type\)\s*do\s+nothing/i);
  });

  it("points schema recovery at the promotion migration", () => {
    const store = readFileSync(join(ROOT, "lib/wantedStore.ts"), "utf8");

    expect(store).toContain('migrationHint: "apply migration 0121"');
    expect(store).not.toContain('migrationHint: "apply migration 0119"');
  });
});

describe("Wanted promotion already-saved fix migration", () => {
  it("reports already_saved, not saved, when the first-promotion insert hits an existing row", () => {
    const sql = readFileSync(
      join(
        ROOT,
        "supabase/migrations/20260827120000_0122_wanted_promotion_already_saved_fix.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("promote_wanted_to_saved_list");
    // The first-promotion branch must check whether its own insert actually
    // inserted a row (v_inserted := found, immediately after the insert) and
    // branch the outcome on it, rather than always answering 'saved'.
    const firstPromotionBranch = sql.slice(sql.lastIndexOf("insert into public.saved_pubs"));
    expect(firstPromotionBranch).toMatch(/v_inserted\s*:=\s*found/i);
    expect(firstPromotionBranch).toMatch(/if\s+v_inserted\s+then/i);
    expect(firstPromotionBranch).toContain("'already_saved'::text, p_list_type, v_promoted_at");
  });

  it("has a rollback restoring 0121's original unconditional 'saved' outcome", () => {
    const rollback = readFileSync(
      join(
        ROOT,
        "supabase/migrations/rollback/20260827120000_0122_wanted_promotion_already_saved_fix_rollback.sql",
      ),
      "utf8",
    );

    expect(rollback).toContain("promote_wanted_to_saved_list");
    expect(rollback).not.toContain("v_inserted");
    expect(rollback).toMatch(/return query select\s+'saved'::text, p_list_type, v_promoted_at;\s*\nend/i);
  });
});
