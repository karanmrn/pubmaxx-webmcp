import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260810200000_0103_adult_self_assertions.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260810200000_0103_adult_self_assertions_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0103 adult_self_assertions", () => {
  it("stores one row per account and nothing about the person", () => {
    expect(sql).toMatch(
      /user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/,
    );
    expect(sql).toMatch(/asserted_at timestamptz not null default now\(\)/);
    // Two columns. A third would be somebody deciding this row is a profile.
    const columns = sql
      .match(/create table if not exists public\.adult_self_assertions \(([\s\S]*?)\n\);/)?.[1]
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
    expect(columns).toHaveLength(2);
  });

  it("keeps the write on the service role and the read on the owner", () => {
    expect(sql).toMatch(/alter table public\.adult_self_assertions enable row level security;/);
    expect(sql).toMatch(
      /revoke all on table public\.adult_self_assertions from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant select on table public\.adult_self_assertions to authenticated;/,
    );
    // No client INSERT: the route is what binds an assertion to its own caller.
    expect(sql).not.toMatch(/grant[^;]*insert[^;]*to authenticated/i);
    expect(sql).toMatch(/using \(user_id = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/adult_self_assertions_anon_deny[\s\S]*using \(false\) with check \(false\)/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(/drop table if exists public\.adult_self_assertions;/);
  });

  it("is re-appliable, because a captain may run it twice", () => {
    expect(sql).toMatch(/create table if not exists/);
    expect(sql).toMatch(/drop policy if exists adult_self_assertions_owner_select/);
    expect(sql).toMatch(/drop policy if exists adult_self_assertions_anon_deny/);
  });
});
