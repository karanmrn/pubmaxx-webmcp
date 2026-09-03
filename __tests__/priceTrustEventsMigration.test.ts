import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260816210000_0108_price_trust_events.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260816210000_0108_price_trust_events_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0108 price_trust_events", () => {
  it("stores an append-only event with a unique evidence fingerprint", () => {
    expect(sql).toMatch(/create table if not exists public\.price_trust_events/);
    expect(sql).toMatch(/evidence_fingerprint text not null/);
    expect(sql).toMatch(/venue_id text not null/);
    expect(sql).toMatch(/category text not null/);
    expect(sql).toMatch(/observation_ids text\[] not null/);
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(sql).toMatch(
      /reversal_of uuid references public\.price_trust_events\(id\)/,
    );
    expect(sql).toMatch(
      /price_trust_events_fingerprint_key unique \(evidence_fingerprint\)/,
    );
    expect(sql).not.toMatch(/update public\.price_trust_events/i);
  });

  it("binds credits to auth.users and the event, unique per pair", () => {
    expect(sql).toMatch(/create table if not exists public\.price_trust_credits/);
    expect(sql).toMatch(
      /user_id uuid not null references auth\.users\(id\) on delete cascade/,
    );
    expect(sql).toMatch(
      /trust_event_id uuid not null references public\.price_trust_events\(id\) on delete cascade/,
    );
    expect(sql).toMatch(/primary key \(user_id, trust_event_id\)/);
  });

  it("keeps both tables service-role only", () => {
    for (const table of ["price_trust_events", "price_trust_credits"]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security;`),
      );
      expect(sql).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from public, anon, authenticated;`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to service_role;`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `${table}_anon_deny[\\s\\S]*using \\(false\\) with check \\(false\\)`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `${table}_authenticated_deny[\\s\\S]*using \\(false\\) with check \\(false\\)`,
        ),
      );
    }
    expect(sql).not.toMatch(/grant [^;]* to authenticated/i);
    expect(sql).not.toMatch(/using \(true\)/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.price_trust_credits;/);
    expect(rollback).toMatch(/drop table if exists public\.price_trust_events;/);
  });
});
