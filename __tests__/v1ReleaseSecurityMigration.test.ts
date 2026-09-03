/**
 * V1 release security migration contract (SQL catalog shape).
 *
 * Effective allow/deny proof belongs in the PostgreSQL/PostgREST RLS suite.
 * This file pins the final grants and policy catalog shipped by migration 0070,
 * plus the rollback's exact restoration of the pre-0070 catalog.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const ROLLBACK_DIR = join(MIGRATIONS_DIR, "rollback");
const FORWARD_NAME = "20260806035204_0070_v1_release_security.sql";
const ROLLBACK_NAME = "20260806035204_v1_release_security_rollback.sql";
const FORWARD_PATH = join(MIGRATIONS_DIR, FORWARD_NAME);
const ROLLBACK_PATH = join(ROLLBACK_DIR, ROLLBACK_NAME);

const PROTECTED_TABLES = [
  "night_memories",
  "night_moments",
  "night_moment_consents",
  "night_stories",
  "night_story_contributors",
  "night_story_moments",
  "night_story_publish_proposals",
  "pub_pal_voice_usage",
] as const;

const WRITE_PRIVILEGES = ["insert", "update", "delete"] as const;
const SERVICE_PRIVILEGES = ["select", ...WRITE_PRIVILEGES] as const;

const RLS_HELPERS = [
  "rls_current_profile_id()",
  "rls_owns_profile(uuid)",
  "rls_owns_handle(text)",
  "rls_is_plan_participant(uuid)",
  "rls_is_conversation_participant(uuid)",
  "rls_current_price_actor()",
  "rls_follows_handle(text)",
  "rls_can_read_visit_report(text, text, text)",
] as const;

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function normalize(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

type Policy = {
  command: string;
  roles: readonly string[];
  statement: string;
};

type PolicyCatalog = Map<string, Policy>;

function policyKey(table: string, name: string): string {
  return `${table}.${name}`;
}

function applyPolicies(catalog: PolicyCatalog, sql: string): void {
  const statements = sql.match(
    /(?:drop\s+policy\s+(?:if\s+exists\s+)?(?:"[^"]+"|[a-z0-9_]+)\s+on\s+(?:public\.)?[a-z0-9_]+|create\s+policy\s+(?:"[^"]+"|[a-z0-9_]+)\s+on\s+(?:public\.)?[a-z0-9_]+[\s\S]*?);/gi,
  ) ?? [];

  for (const rawStatement of statements) {
    const statement = normalize(rawStatement);
    const dropped = statement.match(
      /^drop policy (?:if exists )?("[^"]+"|[a-z0-9_]+) on (?:public\.)?([a-z0-9_]+)/,
    );
    if (dropped) {
      catalog.delete(policyKey(dropped[2], dropped[1].replaceAll('"', "")));
      continue;
    }

    const created = statement.match(
      /^create policy ("[^"]+"|[a-z0-9_]+) on (?:public\.)?([a-z0-9_]+)/,
    );
    if (!created) continue;
    const command = statement.match(/\sfor\s+(all|select|insert|update|delete)\b/)?.[1] ?? "all";
    const roles =
      statement
        .match(/\sto\s+([a-z0-9_,\s]+?)(?=\susing\s|\swith\scheck\s|;)/)?.[1]
        .split(",")
        .map((role) => role.trim()) ?? ["public"];
    catalog.set(policyKey(created[2], created[1].replaceAll('"', "")), {
      command,
      roles,
      statement,
    });
  }
}

type PrivilegeCatalog = Map<string, Set<string>>;

function privilegeKey(role: string, table: string): string {
  return `${role}.${table}`;
}

function applyPrivileges(catalog: PrivilegeCatalog, sql: string): void {
  const statements = sql.match(
    /(?:grant|revoke)\s+[a-z_,\s]+\s+on\s+(?:table\s+)?(?:public\.)?[a-z0-9_]+\s+(?:to|from)\s+[a-z0-9_,\s]+;/gi,
  ) ?? [];

  for (const rawStatement of statements) {
    const statement = normalize(rawStatement);
    const parsed = statement.match(
      /^(grant|revoke)\s+([a-z_,\s]+)\s+on\s+(?:table\s+)?(?:public\.)?([a-z0-9_]+)\s+(?:to|from)\s+([a-z0-9_,\s]+);$/,
    );
    if (!parsed) continue;
    const [, operation, rawPrivileges, table, rawRoles] = parsed;
    const privileges = rawPrivileges.split(",").map((privilege) => privilege.trim());
    const roles = rawRoles.split(",").map((role) => role.trim());

    for (const role of roles) {
      const key = privilegeKey(role, table);
      const current = catalog.get(key) ?? new Set<string>();
      const expanded = privileges.includes("all") || privileges.includes("all privileges")
        ? [...SERVICE_PRIVILEGES]
        : privileges;
      for (const privilege of expanded) {
        if (operation === "grant") current.add(privilege);
        else current.delete(privilege);
      }
      catalog.set(key, current);
    }
  }
}

function migrationSqlBeforeV1Release(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
}

function selectedPolicies(catalog: PolicyCatalog): Map<string, Policy> {
  return new Map(
    [...catalog].filter(([key]) => PROTECTED_TABLES.some((table) => key.startsWith(`${table}.`))),
  );
}

function selectedPrivileges(catalog: PrivilegeCatalog): Map<string, Set<string>> {
  return new Map(
    [...catalog].filter(([key]) =>
      PROTECTED_TABLES.some(
        (table) => key === privilegeKey("authenticated", table) || key === privilegeKey("service_role", table),
      ),
    ),
  );
}

const FORWARD = readIfPresent(FORWARD_PATH);
const ROLLBACK = readIfPresent(ROLLBACK_PATH);
const N_FORWARD = normalize(FORWARD);

describe("V1 release security migration", () => {
  it("ships forward and rollback migrations", () => {
    expect(existsSync(FORWARD_PATH), FORWARD_NAME).toBe(true);
    expect(existsSync(ROLLBACK_PATH), ROLLBACK_NAME).toBe(true);
  });

  it.each(PROTECTED_TABLES)("revokes authenticated browser writes on %s", (table) => {
    for (const privilege of WRITE_PRIVILEGES) {
      expect(N_FORWARD).toMatch(
        new RegExp(
          `revoke\\s+(?:[a-z_]+\\s*,\\s*)*${privilege}(?:\\s*,\\s*[a-z_]+)*\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+from\\s+authenticated`,
        ),
      );
    }
  });

  it.each(PROTECTED_TABLES)("grants service_role explicit DML on %s", (table) => {
    for (const privilege of SERVICE_PRIVILEGES) {
      expect(N_FORWARD).toMatch(
        new RegExp(
          `grant\\s+(?:[a-z_]+\\s*,\\s*)*${privilege}(?:\\s*,\\s*[a-z_]+)*\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+service_role`,
        ),
      );
    }
  });

  it("leaves no authenticated write policy on protected tables", () => {
    const catalog: PolicyCatalog = new Map();
    for (const sql of migrationSqlBeforeV1Release()) applyPolicies(catalog, sql);
    applyPolicies(catalog, FORWARD);

    const authenticatedWrites = [...selectedPolicies(catalog)].filter(([, policy]) =>
      policy.roles.includes("authenticated") &&
      ["all", ...WRITE_PRIVILEGES].includes(policy.command as "all" | typeof WRITE_PRIVILEGES[number]),
    );
    expect(authenticatedWrites).toEqual([]);
  });

  it("keeps voice reservation and compensation service-role only", () => {
    expect(N_FORWARD).toContain(
      "revoke all on function public.consume_pub_pal_voice_trial(uuid, date, integer) from public, anon, authenticated",
    );
    expect(N_FORWARD).toContain(
      "grant execute on function public.consume_pub_pal_voice_trial(uuid, date, integer) to service_role",
    );
    expect(N_FORWARD).toContain(
      "create or replace function public.release_pub_pal_voice_trial",
    );
    expect(N_FORWARD).toMatch(
      /release_pub_pal_voice_trial[\s\S]*security definer[\s\S]*set search_path = public/,
    );
    expect(N_FORWARD).toContain("set session_count = session_count - 1");
    expect(N_FORWARD).toContain("and session_count > 0");
    expect(N_FORWARD).toContain(
      "revoke all on function public.release_pub_pal_voice_trial(uuid, date) from public, anon, authenticated",
    );
    expect(N_FORWARD).toContain(
      "grant execute on function public.release_pub_pal_voice_trial(uuid, date) to service_role",
    );
    expect(normalize(ROLLBACK)).toContain(
      "revoke execute on function public.consume_pub_pal_voice_trial(uuid, date, integer) from service_role",
    );
  });

  it.each(RLS_HELPERS)("moves %s to an unexposed schema with ALTER FUNCTION", (helper) => {
    expect(N_FORWARD).toContain(
      `alter function public.${helper} set schema pubmax_private`,
    );
    expect(normalize(ROLLBACK)).toContain(
      `alter function pubmax_private.${helper} set schema public`,
    );
  });

  it("repairs only the three wrappers with private-qualified dependencies", () => {
    expect(N_FORWARD).toContain(
      "create or replace function pubmax_private.rls_is_conversation_participant",
    );
    expect(N_FORWARD).toContain("pubmax_private.rls_owns_handle(c.handle_a)");
    expect(N_FORWARD).toContain(
      "create or replace function pubmax_private.rls_current_price_actor",
    );
    expect(N_FORWARD).toContain("pubmax_private.rls_current_profile_id()");
    expect(N_FORWARD).toContain(
      "create or replace function pubmax_private.rls_can_read_visit_report",
    );
    expect(N_FORWARD).toContain("pubmax_private.rls_follows_handle(p_handle)");
  });

  it("limits the private schema and helper ACLs to policy roles", () => {
    expect(N_FORWARD).toContain("create schema if not exists pubmax_private");
    expect(N_FORWARD).toContain(
      "revoke all on schema pubmax_private from public, anon, authenticated, service_role",
    );
    expect(N_FORWARD).toContain(
      "grant usage on schema pubmax_private to authenticated, service_role",
    );
    expect(N_FORWARD).toContain("from public, anon");
    expect(N_FORWARD).toContain("to authenticated, service_role");

    const normalizedRollback = normalize(ROLLBACK);
    expect(normalizedRollback).toContain("drop schema pubmax_private");
    expect(normalizedRollback).not.toContain("drop schema pubmax_private cascade");
  });

  it("rollback restores the exact protected-table policy and privilege catalogs", () => {
    const beforePolicies: PolicyCatalog = new Map();
    const beforePrivileges: PrivilegeCatalog = new Map();
    for (const sql of migrationSqlBeforeV1Release()) {
      applyPolicies(beforePolicies, sql);
      applyPrivileges(beforePrivileges, sql);
    }

    const restoredPolicies: PolicyCatalog = new Map(beforePolicies);
    const restoredPrivileges: PrivilegeCatalog = new Map(
      [...beforePrivileges].map(([key, value]) => [key, new Set(value)]),
    );
    applyPolicies(restoredPolicies, FORWARD);
    applyPrivileges(restoredPrivileges, FORWARD);
    applyPolicies(restoredPolicies, ROLLBACK);
    applyPrivileges(restoredPrivileges, ROLLBACK);

    expect(selectedPolicies(restoredPolicies)).toEqual(selectedPolicies(beforePolicies));
    expect(selectedPrivileges(restoredPrivileges)).toEqual(selectedPrivileges(beforePrivileges));
  });
});
