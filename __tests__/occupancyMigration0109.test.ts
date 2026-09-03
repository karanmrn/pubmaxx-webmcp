// Effective proof for 0109, the occupancy moderation lane. It APPLIES 0107
// then 0109 to a real PostgreSQL 16 and exercises the flag RPC, the hide
// stamp and the rollback, because "reporting never auto-hides" and "a flag is
// not an observation" are claims only the database can answer.
//
// Same host contract as the other effective migration proofs
// (occupancyMigrationEffective, foundingMembersMigration): a host with no
// PostgreSQL binaries skips loudly rather than passing quietly.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const BASE_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260816180000_0107_venue_occupancy_reports.sql",
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260816190000_0109_venue_occupancy_moderation.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260816190000_0109_venue_occupancy_moderation_rollback.sql",
);

const REPORTER = "00000000-0000-4000-8000-000000000021";
const REPORT_ID = "00000000-0000-4000-8000-0000000000a1";

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
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run occupancy moderation proofs.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-occupancy-0109-"));
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

  const database = "pubmax_occupancy_0109";
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
    applyFile(BASE_MIGRATION);
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
        "OCCUPANCY 0109 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "No occupancy flag or hide was exercised on this host.",
        "",
      ].join("\n"),
    );
    return;
  }
  session = await startPostgresSession();
}, 90_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
  session?.sql(
    `truncate public.venue_occupancy_flags, public.venue_occupancy_reports;
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

/** A reading observed two and a half hours ago: outside the 90-minute now window. */
function insertStaleReport(): string {
  return `
    insert into public.venue_occupancy_reports
      (id, venue_id, reported_at, level, reporter_user_id, source)
    values ('${REPORT_ID}', 'venue-16pnwmm', now() - interval '150 minutes',
            'full', '${REPORTER}', 'crowd')
  `;
}

function flag(actor: string, reason = ""): string {
  return `select public.report_occupancy_report('${REPORT_ID}', '${actor}', '${reason}')`;
}

describe("0109 applied to PostgreSQL", () => {
  it("counts a flag without re-dating the observation it is about", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);
    const before = db.sql(
      `set role service_role;
       select reported_at from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
    );

    expect(db.sql(`set role service_role; ${flag("actor-a", "wrong")};`)).toBe("t");

    // The whole finding: a flag must not promote a stale reading into the now
    // window. reported_at is 0107's observation stamp and it stays put.
    expect(
      db.sql(
        `set role service_role;
         select reported_at from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe(before);
    expect(
      db.sql(
        `set role service_role;
         select reported_at < now() - interval '90 minutes'
           from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("t");
    expect(
      db.sql(
        `set role service_role;
         select report_count, report_reason, flagged_at is not null
           from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("1|wrong|t");
  });

  it("never auto-hides, however many readers flag it", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);

    for (const actor of ["actor-a", "actor-b", "actor-c", "actor-d"]) {
      expect(db.sql(`set role service_role; ${flag(actor)};`)).toBe("t");
    }

    expect(
      db.sql(
        `set role service_role;
         select report_count, hidden_at is null
           from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("4|t");
  });

  it("answers a same-actor repeat without moving the counter", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);

    expect(db.sql(`set role service_role; ${flag("actor-a")};`)).toBe("t");
    expect(db.sql(`set role service_role; ${flag("actor-a")};`)).toBe("t");

    expect(
      db.sql(
        `set role service_role;
         select report_count from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("1");
  });

  it("counts an unattributed flag once, because two of them are one reporter", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);

    // A nullable actor_hash would never conflict, so each unattributed flag
    // would insert a fresh ledger row and inflate the distinct count.
    expect(db.sql(`set role service_role; ${flag("")};`)).toBe("t");
    expect(db.sql(`set role service_role; ${flag("   ")};`)).toBe("t");

    expect(
      db.sql(
        `set role service_role;
         select report_count from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("1");
    expect(
      db.sql(
        `set role service_role;
         select count(*), max(actor_hash) from public.venue_occupancy_flags`,
      ),
    ).toBe("1|anonymous");

    // A named reporter is still their own distinct flag.
    expect(db.sql(`set role service_role; ${flag("actor-a")};`)).toBe("t");
    expect(
      db.sql(
        `set role service_role;
         select report_count from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("2");
  });

  it("refuses a flag row with no actor at all", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);

    expect(
      db.expectRefusal(
        `set role service_role;
         insert into public.venue_occupancy_flags (occupancy_report_id, actor_hash)
         values ('${REPORT_ID}', null)`,
      ),
    ).toMatch(/null value in column "actor_hash"/);
  });

  it("answers null for a reading that is not there, so the route can 404", () => {
    const db = requireSession();
    expect(
      db.sql(
        `set role service_role;
         select coalesce(public.report_occupancy_report(
           '00000000-0000-4000-8000-0000000000ff', 'actor-a', '')::text, 'null')`,
      ),
    ).toBe("null");
  });

  it("hides by stamp and never deletes the observation", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()};`);

    db.sql(
      `set role service_role;
       update public.venue_occupancy_reports set hidden_at = now() where id = '${REPORT_ID}'`,
    );
    expect(
      db.sql(
        `set role service_role;
         select count(*), max(level), max(hidden_at) is not null
           from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("1|full|t");

    db.sql(
      `set role service_role;
       update public.venue_occupancy_reports set hidden_at = null where id = '${REPORT_ID}'`,
    );
    expect(
      db.sql(
        `set role service_role;
         select hidden_at is null from public.venue_occupancy_reports where id = '${REPORT_ID}'`,
      ),
    ).toBe("t");
  });

  it("gives the browser roles neither the ledger nor the flag function", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()}; ${flag("actor-a")};`);

    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select id from public.venue_occupancy_flags`,
        ),
      ).toMatch(/permission denied for table venue_occupancy_flags/);
      expect(db.expectRefusal(`set role ${role}; ${flag("actor-b")};`)).toMatch(
        /permission denied for function report_occupancy_report/,
      );
    }
  });

  it("takes the account's flags with the account", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()}; ${flag("actor-a")};`);

    db.sql(`delete from auth.users where id = '${REPORTER}'`);
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_flags"),
    ).toBe("0");
  });

  it("rolls back its own columns and leaves 0107's observations whole", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertStaleReport()}; ${flag("actor-a")};`);

    db.applyFile(ROLLBACK_PATH);

    // The moderation lane is gone.
    expect(db.sql("select to_regclass('public.venue_occupancy_flags') is null")).toBe("t");
    expect(
      db.sql(
        "select to_regprocedure('public.report_occupancy_report(uuid, text, text)') is null",
      ),
    ).toBe("t");
    for (const column of ["hidden_at", "flagged_at", "report_count", "report_reason"]) {
      expect(
        db.sql(
          `select count(*) from information_schema.columns
            where table_schema = 'public'
              and table_name = 'venue_occupancy_reports'
              and column_name = '${column}'`,
        ),
      ).toBe("0");
    }

    // 0107 is untouched: the row, its observation stamp, and both indexes the
    // now window and the retake query are read through.
    expect(
      db.sql(
        `set role service_role;
         select count(*), max(level), max(reported_at) is not null
           from public.venue_occupancy_reports`,
      ),
    ).toBe("1|full|t");
    expect(
      db.sql(
        `select count(*) from pg_indexes
          where schemaname = 'public'
            and indexname in ('venue_occupancy_reports_now_idx',
                              'venue_occupancy_reports_retake_idx')`,
      ),
    ).toBe("2");

    // And it re-applies onto the surviving rows.
    db.applyFile(MIGRATION_PATH);
    expect(
      db.sql(
        `set role service_role;
         select count(*), max(report_count), max(hidden_at) is null
           from public.venue_occupancy_reports`,
      ),
    ).toBe("1|0|t");
  });
});
