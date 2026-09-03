// Effective proof for 0107. The shape pins live in occupancyMigration.test.ts;
// this file APPLIES the migration to a real PostgreSQL 16 and exercises the
// table as the three Supabase roles, because a policy is a claim about what a
// role may do and only the database can answer that.
//
// Same host contract as the other effective migration proofs
// (rateLimitExpiryMigration, foundingMembersMigration): a host with no
// PostgreSQL binaries skips loudly rather than passing quietly.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260816180000_0107_venue_occupancy_reports.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260816180000_0107_venue_occupancy_reports_rollback.sql",
);

const REPORTER = "00000000-0000-4000-8000-000000000011";

type PostgresSession = {
  sql: (statement: string) => string;
  expectRefusal: (statement: string) => string;
  applyFile: (path: string) => void;
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
      // Try the next known PostgreSQL installation path.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_OCCUPANCY_MIGRATION_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_OCCUPANCY_MIGRATION_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run occupancy RLS proofs.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-occupancy-0107-"));
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

  const connectionArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
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

  const database = "pubmax_occupancy_0107";
  execFileSync(
    psql,
    [
      ...connectionArgs,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `create database ${database}`,
    ],
    { stdio: "pipe" },
  );
  const databaseArgs = [...connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1"];

  // psql prints a command tag for every statement, so `set role x; select …`
  // answers "SET\n<rows>". The rows are the answer; the tag is noise.
  const stripCommandTags = (output: string): string =>
    output
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "SET")
      .join("\n")
      .trim();

  const sql = (statement: string): string =>
    stripCommandTags(
      execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

  const expectRefusal = (statement: string): string => {
    try {
      execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      const shell = error as { stderr?: Buffer | string };
      return String(shell.stderr ?? "");
    }
    throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
  };

  const applyFile = (path: string): void => {
    execFileSync(psql, [...databaseArgs, "-f", path], { stdio: "pipe" });
  };

  try {
    // The Supabase roles this table is governed by. service_role carries
    // BYPASSRLS in a Supabase project, so the local cluster mirrors that or
    // "the write path still works" would not be the thing under test.
    sql(`
      create role anon nologin noinherit;
      create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls;
      grant usage on schema public to anon, authenticated, service_role;

      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${REPORTER}');
    `);
    applyFile(MIGRATION_PATH);
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

  return { sql, expectRefusal, applyFile, stop };
}

let session: PostgresSession | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "OCCUPANCY 0107 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "No occupancy row was inserted or refused on this host.",
        "",
      ].join("\n"),
    );
    return;
  }
  session = await startPostgresSession();
}, 90_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
  // The cascade proof deletes the account, so the reporter is re-seeded per
  // test rather than once, and a failed assertion cannot strand the next test.
  session?.sql(
    `truncate public.venue_occupancy_reports;
     insert into auth.users (id) values ('${REPORTER}') on conflict do nothing;`,
  );
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL occupancy session did not start.");
  return session;
}

function insertReport(
  level: string,
  options: { source?: string; reportedAt?: string; id?: string } = {},
): string {
  const source = options.source ?? "crowd";
  const reportedAt = options.reportedAt ?? "now()";
  const id = options.id ?? "gen_random_uuid()";
  return `
    insert into public.venue_occupancy_reports
      (id, venue_id, reported_at, level, reporter_user_id, source)
    values (${id}, 'venue-16pnwmm', ${reportedAt}, '${level}', '${REPORTER}', '${source}')
  `;
}

describe("0107 applied to PostgreSQL", () => {
  it("takes a crowd report from the service role and reads it back", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("some_seats")};`);

    expect(
      db.sql(
        "set role service_role; select level, source from public.venue_occupancy_reports",
      ),
    ).toBe("some_seats|crowd");
  });

  it("refuses a fourth word for a level, in either vocabulary", () => {
    const db = requireSession();

    // "rammed" is the Visit Report tense. The table stores the now tense only,
    // so the mapping has to happen before the insert, never in the column.
    expect(db.expectRefusal(`set role service_role; ${insertReport("rammed")};`))
      .toMatch(/venue_occupancy_reports_level_check/);
    expect(db.expectRefusal(`set role service_role; ${insertReport("packed")};`))
      .toMatch(/venue_occupancy_reports_level_check/);
    expect(
      db.expectRefusal(
        `set role service_role; ${insertReport("full", { source: "publish" })};`,
      ),
    ).toMatch(/venue_occupancy_reports_source_check/);
  });

  it("gives the browser roles neither a read nor a write", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("full")};`);

    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select level from public.venue_occupancy_reports`,
        ),
      ).toMatch(/permission denied for table venue_occupancy_reports/);
      expect(db.expectRefusal(`set role ${role}; ${insertReport("empty")};`))
        .toMatch(/permission denied for table venue_occupancy_reports/);
    }

    // The row is still there: the browser was refused, not the write path.
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("1");
  });

  it("leaves with the account that reported it", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("empty")};`);

    db.sql(`delete from auth.users where id = '${REPORTER}'`);
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("0");
  });

  it("keeps an out-of-window row for the forecast rather than deleting it", () => {
    const db = requireSession();
    db.sql(
      `set role service_role; ${insertReport("full", { reportedAt: "now() - interval '3 hours'" })};`,
    );
    db.sql(`set role service_role; ${insertReport("empty")};`);

    // The 90-minute rule is derived on READ, so the table holds both rows and
    // the now query is the thing that narrows.
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("2");
    expect(
      db.sql(
        `set role service_role;
         select level from public.venue_occupancy_reports
         where reported_at >= now() - interval '90 minutes'
         order by reported_at desc limit 1`,
      ),
    ).toBe("empty");
  });

  it("rolls back to a database with no occupancy table, and re-applies", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("some_seats")};`);

    db.applyFile(ROLLBACK_PATH);
    expect(db.sql("select to_regclass('public.venue_occupancy_reports') is null")).toBe(
      "t",
    );

    db.applyFile(MIGRATION_PATH);
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("0");
  });
});
