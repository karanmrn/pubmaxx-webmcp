import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("plan ending selection migration", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260717065012_0038_plan_ending_selection.sql", import.meta.url),
    "utf8",
  );

  it("persists the typed selection atomically and keeps the RPC service-role only", () => {
    expect(sql).toMatch(/add column if not exists ending_selection jsonb/i);
    expect(sql).toMatch(/insert into public\.plan_completions[\s\S]*ending_selection/i);
    expect(sql).toMatch(/p_ending_selection/i);
    expect(sql).toMatch(/if p_ending_selection is null or/i);
    expect(sql).toMatch(/revoke all on function public\.complete_plan_atomic[\s\S]*from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.complete_plan_atomic[\s\S]*to service_role/i);
  });

  it("requires the first plan member to confirm completion", () => {
    expect(sql).toMatch(/if actor_id <> \([\s\S]*order by joined_at, id[\s\S]*limit 1[\s\S]*\) then return 'forbidden'/i);
  });
});
