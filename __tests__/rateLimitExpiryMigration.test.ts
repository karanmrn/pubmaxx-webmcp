import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260806145644_0070_rate_limit_expiry.sql",
);

type PostgresSession = {
  sql: (statement: string) => string;
  stop: () => Promise<void>;
};

function findPostgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/bin/${name}`,
    name,
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === name) {
        execFileSync("which", [name], { stdio: "pipe" });
        return name;
      }
      if (existsSync(candidate)) return candidate;
    } catch {
      // Try next known PostgreSQL installation path.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_RATE_LIMIT_EXPIRY_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_RATE_LIMIT_EXPIRY_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const)
    .filter((name) => findPostgresBinary(name) === null);
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run deletion proofs.`
    : null;
}

async function pickPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startPostgresSession(): Promise<PostgresSession> {
  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL binaries unavailable.");
  }

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-rate-limit-expiry-"));
  const port = await pickPort();
  execFileSync(
    initdb,
    ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"],
    { stdio: "pipe" },
  );
  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "max_connections = 12",
      "shared_buffers = 16MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );

  const processHandle = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
  );
  const logs: string[] = [];
  processHandle.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  processHandle.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

  const connectionArgs = [
    "-h", "127.0.0.1",
    "-p", String(port),
    "-U", "postgres",
  ];
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      execFileSync(psql, [...connectionArgs, "-d", "postgres", "-c", "select 1"], {
        stdio: "pipe",
      });
      ready = true;
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!ready) {
    processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`PostgreSQL failed to start:\n${logs.join("")}`);
  }

  const database = "pubmax_rate_limit_expiry";
  execFileSync(
    psql,
    [...connectionArgs, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`],
    { stdio: "pipe" },
  );
  const databaseArgs = [...connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1"];

  const sql = (statement: string): string =>
    execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

  try {
    sql(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;

      create table public.rate_limits (
        key text primary key,
        hits timestamptz[] not null default '{}',
        updated_at timestamptz not null default now()
      );

      create table public.round_spends (
        id uuid primary key,
        items jsonb not null default '[]'::jsonb,
        promotion_actor text
      );

      create table public.round_price_line_charges (
        spend_id uuid not null references public.round_spends(id) on delete cascade,
        line_index integer not null,
        actor text not null,
        primary key (spend_id, line_index)
      );
    `);
    execFileSync(psql, [...databaseArgs, "-f", MIGRATION_PATH], { stdio: "pipe" });
  } catch (error) {
    processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }

  const stop = async (): Promise<void> => {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
    }
    if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  };

  return { sql, stop };
}

let session: PostgresSession | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error([
      "",
      "RATE-LIMIT EXPIRY TESTS SKIPPED - THIS IS NOT A PASS",
      `Reason: ${skipReason}`,
      "No rate_limits row was inserted or deleted on this host.",
      "",
    ].join("\n"));
    return;
  }
  session = await startPostgresSession();
}, 60_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
  session?.sql("truncate public.round_price_line_charges, public.round_spends, public.rate_limits");
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL expiry session did not start.");
  return session;
}

function seedExpiredAndFreshRows(): void {
  requireSession().sql(`
    insert into public.rate_limits (key, expires_at) values
      ('expired', now() - interval '1 minute'),
      ('fresh', now() + interval '1 hour');
  `);
}

function storedKeys(): string[] {
  const output = requireSession().sql(
    "select key from public.rate_limits order by key",
  );
  return output ? output.split("\n") : [];
}

describe("durable rate-limit expiry migration", () => {
  it("deletes an expired row and preserves a fresh row", () => {
    seedExpiredAndFreshRows();

    expect(requireSession().sql("select public.prune_expired_rate_limits()"))
      .toBe("1");
    expect(storedKeys()).toEqual(["fresh"]);
  });

  it("prunes expired rows when check_rate_limit records a hit", () => {
    seedExpiredAndFreshRows();

    expect(requireSession().sql(
      "select public.check_rate_limit('check-writer', 10, 60000)",
    )).toBe("f");
    expect(storedKeys()).toEqual(["check-writer", "fresh"]);
  });

  it("prunes expired rows when charge_round_price_line records a hit", () => {
    seedExpiredAndFreshRows();
    requireSession().sql(`
      insert into public.round_spends (id, items, promotion_actor)
      values (
        '11111111-1111-4111-8111-111111111111',
        '[{"promotionStatus":"pending"}]'::jsonb,
        'profile:test'
      );
    `);

    expect(requireSession().sql(`
      select public.charge_round_price_line(
        'profile:test',
        'round-writer',
        10,
        0,
        '11111111-1111-4111-8111-111111111111',
        60000
      )
    `)).toBe("charged");
    expect(storedKeys()).toEqual(["fresh", "round-writer"]);
  });
});
