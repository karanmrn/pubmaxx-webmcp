import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260717081713_pnc_metrics_view.sql"),
  "utf8",
);
const LEAST_PRIVILEGE_SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260717081802_pnc_metrics_least_privilege.sql"),
  "utf8",
);

describe("canonical PNC metrics view", () => {
  it("counts only completions with an arrival and explicit ending selection", () => {
    expect(SQL).toMatch(/create or replace view public\.pnc_qualified_completions/i);
    expect(SQL).toMatch(/qualifying_arrival_action_id is not null/i);
    expect(SQL).toMatch(/qualifying_arrival_stop_position is not null/i);
    expect(SQL).toMatch(/qualifying_arrival_at <= completion\.completed_at/i);
    expect(SQL).toMatch(/ending_selection is not null/i);
  });

  it("exposes no identity, capability, free-text, or precise-location columns", () => {
    const selectList = SQL.match(/select([\s\S]*?)from public\.plan_completions/i)?.[1] ?? "";
    expect(selectList).not.toMatch(/actor_member_id|owner_user_id|token_hash|title|venue_name|latitude|longitude/i);
  });

  it("is an invoker-rights, service-role-only reporting surface", () => {
    expect(SQL).toMatch(/with \(security_invoker = true\)/i);
    expect(SQL).toMatch(/revoke all on public\.pnc_qualified_completions from public, anon, authenticated/i);
    expect(LEAST_PRIVILEGE_SQL).toMatch(/revoke all on public\.pnc_qualified_completions from service_role/i);
    expect(LEAST_PRIVILEGE_SQL).toMatch(/grant select on public\.pnc_qualified_completions to service_role/i);
  });
});
