import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260831120000_0126_price_trust_reconciliation_queue.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260831120000_0126_price_trust_reconciliation_queue_rollback.sql",
);

function source(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function compactSql(path: string): string {
  return source(path).replace(/\s+/g, " ");
}

describe("0126 price trust reconciliation queue", () => {
  it("creates one revisioned service-role queue per Venue and category", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    const sql = compactSql(MIGRATION);

    expect(sql).toMatch(
      /create table if not exists public\.price_trust_reconciliation_queue/,
    );
    expect(sql).toMatch(/primary key \(venue_id, category\)/);
    expect(sql).toMatch(/create sequence if not exists public\.price_trust_reconciliation_version_seq/);
    expect(sql).toMatch(
      /version bigint not null default nextval\('public\.price_trust_reconciliation_version_seq'\)/,
    );
    expect(sql).toMatch(/check \(version > 0\)/);
    expect(sql).toMatch(
      /alter table public\.price_trust_reconciliation_queue enable row level security/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.price_trust_reconciliation_queue from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.price_trust_reconciliation_queue to service_role/,
    );
  });

  it("queues only attributed price inserts and price-authority corrections", () => {
    const sql = compactSql(MIGRATION);

    expect(sql).toMatch(
      /after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at\s+on public\.community_prices/,
    );
    expect(sql).toMatch(
      /new\.actor is not null and new\.drink_category is not null/i,
    );
    expect(sql).toMatch(
      /on conflict on constraint price_trust_reconciliation_queue_pkey do update/,
    );
    expect(sql).toMatch(
      /set version = nextval\('public\.price_trust_reconciliation_version_seq'\)/,
    );
    expect(sql).toMatch(/old\.venue_id/);
    expect(sql).toMatch(/old\.drink_category/);
    expect(sql).not.toMatch(/update of [^;]*(hidden_at|moderated_at)/i);
  });

  it("keeps explicit enqueue service-role only", () => {
    const sql = compactSql(MIGRATION);

    expect(sql).toMatch(
      /create or replace function public\.enqueue_price_trust_reconciliation/,
    );
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/or p_category is null/);
    expect(sql).toMatch(
      /revoke all on function public\.enqueue_price_trust_reconciliation\(text, text\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.enqueue_price_trust_reconciliation\(text, text\) to service_role/,
    );
  });

  it("removes every queue object on rollback", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    const sql = compactSql(ROLLBACK);

    expect(sql).toMatch(/drop trigger if exists community_prices_queue_price_trust/);
    expect(sql).toMatch(
      /drop function if exists public\.enqueue_price_trust_reconciliation\(text, text\)/,
    );
    expect(sql).toMatch(
      /drop table if exists public\.price_trust_reconciliation_queue/,
    );
    expect(sql).toMatch(
      /drop sequence if exists public\.price_trust_reconciliation_version_seq/,
    );
  });
});
