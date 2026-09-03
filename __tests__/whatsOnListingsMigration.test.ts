import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = join(process.cwd(), "supabase/migrations/20260824120000_0119_whats_on_listings.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260824120000_0119_whats_on_listings_rollback.sql");

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const path of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    name,
  ]) {
    try {
      if (path === name) execFileSync("which", [name], { stdio: "pipe" });
      else if (!existsSync(path)) continue;
      return path;
    } catch {}
  }
  return null;
}

type Database = {
  sql(statement: string): string;
  apply(path: string): void;
  stop(): Promise<void>;
};

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
    server.on("error", reject);
  });
}

async function startDatabase(): Promise<Database> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL is unavailable.");
  const directory = mkdtempSync(join(tmpdir(), "pubmax-whats-on-listings-"));
  const port = await freePort();
  execFileSync(initdb, ["-D", directory, "--auth=trust", "--username=postgres", "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap"], { stdio: "pipe" });
  writeFileSync(join(directory, "postgresql.auto.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\n`);
  const server: ChildProcess = spawn(postgres, ["-D", directory, "-h", "127.0.0.1", "-p", String(port)], { stdio: "ignore" });
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
      break;
    } catch {
      if (attempt === 49) throw new Error("PostgreSQL did not start.");
      await sleep(100);
    }
  }
  const run = (args: string[]) => execFileSync(
    psql,
    [...connection, "-v", "ON_ERROR_STOP=1", ...args],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => server.once("exit", () => resolve())),
          sleep(1_000),
        ]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function rowJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "event-1",
    kind: "event",
    payload: { id: "event-1", kind: "event", title: "Live jazz" },
    observed_at: "2026-08-24T10:00:00.000Z",
    city: "london",
    ...overrides,
  }).replaceAll("'", "''");
}

const postgresAvailable = process.env.PUBMAX_RLS_NO_PG !== "1" && ["initdb", "postgres", "psql"].every((name) => binary(name as "initdb" | "postgres" | "psql") !== null);

describe.skipIf(!postgresAvailable)("0119 whats_on_listings migration", () => {
  let database: Database | null = null;

  beforeAll(async () => {
    database = await startDatabase();
    database.sql("create role anon noinherit; create role authenticated noinherit; create role service_role noinherit bypassrls;");
    database.apply(MIGRATION);
  }, 60_000);

  afterAll(async () => database?.stop());

  it("applies schema, service-role permissions, and atomic replacement", () => {
    const db = database!;
    expect(db.sql("select to_regclass('public.whats_on_listings') is not null")).toBe("t");
    expect(db.sql("select to_regclass('public.whats_on_listing_generations') is not null")).toBe("t");
    expect(db.sql("select relrowsecurity from pg_class where oid='public.whats_on_listings'::regclass")).toBe("t");
    expect(db.sql("select relrowsecurity from pg_class where oid='public.whats_on_listing_generations'::regclass")).toBe("t");
    expect(db.sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='whats_on_listings'")).toBe("id,kind,payload,observed_at,generated_at,city");
    expect(db.sql("select has_table_privilege('anon','public.whats_on_listings','select')")).toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.whats_on_listings','select')")).toBe("t");
    expect(db.sql("select has_table_privilege('anon','public.whats_on_listing_generations','select')")).toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.whats_on_listing_generations','select')")).toBe("t");
    expect(db.sql("select has_function_privilege('anon', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_whats_on_listings'")).toBe("f");
    expect(db.sql("select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_whats_on_listings'")).toBe("t");
    expect(db.sql("select count(*) from pg_policies where schemaname='public' and tablename='whats_on_listings'")).toBe("2");

    const good = rowJson();
    expect(db.sql(`select public.replace_whats_on_listings('event','[${good}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toBe("1");
    expect(db.sql("select to_char(generated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from public.whats_on_listing_generations where kind='event'")).toBe("2026-08-24 20:00:00");
    const invalid = rowJson({ observed_at: "not-a-timestamp" });
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${invalid}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toThrow();
    expect(db.sql("select count(*) from public.whats_on_listings where id='event-1'")).toBe("1");

    const stale = rowJson({ payload: { id: "event-1", kind: "event", title: "Older jazz" } });
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${stale}]'::jsonb,'2026-08-24T19:00:00.000Z')`)).toThrow();
    expect(db.sql("select payload->>'title' from public.whats_on_listings where id='event-1'")).toBe("Live jazz");

    const mismatchedKind = rowJson({
      id: "mismatched-kind",
      kind: "quiz",
      payload: { id: "mismatched-kind", kind: "quiz", title: "Still event lane" },
    });
    expect(db.sql(`select public.replace_whats_on_listings('event','[${mismatchedKind}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toBe("1");
    expect(db.sql("select kind from public.whats_on_listings where id='mismatched-kind'")).toBe("event");

    expect(db.sql("select public.replace_whats_on_listings('event','[]'::jsonb,'2026-08-24T21:00:00.000Z')")).toBe("0");
    expect(db.sql("select count(*) from public.whats_on_listings where kind='event'")).toBe("0");
    expect(db.sql("select to_char(generated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from public.whats_on_listing_generations where kind='event'")).toBe("2026-08-24 21:00:00");
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${good}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toThrow();
    expect(db.sql("select count(*) from public.whats_on_listings where kind='event'")).toBe("0");
  });

  it("rolls back the table and replacement function", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.whats_on_listings') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.whats_on_listing_generations') is null")).toBe("t");
    expect(db.sql("select to_regprocedure('public.replace_whats_on_listings(text,jsonb,timestamptz)') is null")).toBe("t");
  });
});
