import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260810100000_0099_account_has_password.sql";
const ROLLBACK =
  "supabase/migrations/rollback/20260810100000_0099_account_has_password_rollback.sql";

const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
const rollback = readFileSync(join(process.cwd(), ROLLBACK), "utf8");

describe("0099 account_has_password", () => {
  it("returns a boolean and never the hash it looked at", () => {
    expect(sql).toMatch(/returns boolean/);
    expect(sql).toMatch(/select exists \(/);
    // `select exists` is the whole point: nothing about the password leaves.
    expect(sql).not.toMatch(/select\s+u\.encrypted_password/);
    expect(sql).not.toMatch(/returns\s+(text|record|setof)/i);
  });

  it("asks the one question it exists to answer", () => {
    expect(sql).toMatch(/from auth\.users u/);
    expect(sql).toMatch(/u\.encrypted_password is not null/);
    expect(sql).toMatch(/u\.encrypted_password <> ''/);
    expect(sql).toMatch(/where u\.id = p_user_id/);
  });

  it("is reachable by the service role alone", () => {
    // A browser-callable version would answer "which accounts have passwords"
    // for any id somebody cared to try.
    expect(sql).toMatch(/security definer/);
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.account_has_password\\(uuid\\) from ${role};`,
        ),
      );
    }
    expect(sql).toMatch(
      /grant execute on function public\.account_has_password\(uuid\) to service_role;/,
    );
    expect(sql).not.toMatch(/to (anon|authenticated)\b/);
  });

  it("pins search_path, so definer rights cannot be borrowed", () => {
    expect(sql).toMatch(/set search_path = ''/);
  });

  it("applies and rolls back inside one transaction each", () => {
    for (const script of [sql, rollback]) {
      expect(script.trimStart().startsWith("begin;")).toBe(false);
      expect(script).toMatch(/\nbegin;/);
      expect(script.trimEnd().endsWith("commit;")).toBe(true);
    }
    expect(rollback).toMatch(
      /drop function if exists public\.account_has_password\(uuid\);/,
    );
  });

  it("is re-appliable, because a captain may run it twice", () => {
    expect(sql).toMatch(/create or replace function/);
  });
});
