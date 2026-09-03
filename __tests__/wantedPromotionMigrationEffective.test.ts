// Effective proof for migration 0122. This test applies the SQL to a small,
// temporary PostgreSQL cluster because the bug is the RPC outcome produced by
// ON CONFLICT DO NOTHING, not the migration's source-text shape.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION_0121_PATH = join(
  process.cwd(),
  "supabase/migrations/20260827110000_0121_wanted_public_list_promotion.sql",
);
const MIGRATION_0122_PATH = join(
  process.cwd(),
  "supabase/migrations/20260827120000_0122_wanted_promotion_already_saved_fix.sql",
);
const ROLLBACK_0122_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260827120000_0122_wanted_promotion_already_saved_fix_rollback.sql",
);

type PostgresSession = {
  sql: (statement: string) => string;
  apply: (path: string) => void;
  stop: () => Promise<void>;
};

function postgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    name,
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === name) execFileSync("which", [name], { stdio: "pipe" });
      else if (!existsSync(candidate)) continue;
      return candidate;
    } catch {
      // Try next known installation.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (
    process.env.PUBMAX_RLS_NO_PG === "1"
    || process.env.PUBMAX_WANTED_MIGRATION_NO_PG === "1"
  ) {
    return "PostgreSQL was deliberately hidden by the migration test no-PG gate.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => postgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run Wanted promotion migration proof.`
    : null;
}

async function freePort(): Promise<number> {
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

async function startPostgres(): Promise<PostgresSession> {
  const initdb = postgresBinary("initdb");
  const postgres = postgresBinary("postgres");
  const psql = postgresBinary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL binaries unavailable.");
  }

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-wanted-0122-"));
  const port = await freePort();
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
      "max_connections = 10",
      "shared_buffers = 12MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );

  const processHandle = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: "ignore", env: { ...process.env, LC_ALL: "C" } },
  );
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];

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

  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
        ready = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!ready) throw new Error("PostgreSQL did not start.");

    const sql = (statement: string): string =>
      execFileSync(
        psql,
        [...connection, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    const apply = (path: string): void => {
      execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", "-f", path], {
        stdio: "pipe",
      });
    };

    sql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.wanteds (
        id uuid primary key,
        owner_actor text not null,
        venue_kind text not null,
        venue_id text,
        status text not null default 'open'
      );
      create table public.saved_pubs (
        profile_id uuid not null,
        venue_id text not null,
        list_type text not null,
        note text,
        unique (profile_id, venue_id, list_type)
      );
    `);
    apply(MIGRATION_0121_PATH);
    apply(MIGRATION_0122_PATH);
    return { sql, apply, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

let session: PostgresSession | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      `WANTED PROMOTION 0122 EFFECTIVE TEST SKIPPED - THIS IS NOT A PASS: ${skipReason}`,
    );
    return;
  }
  session = await startPostgres();
}, 30_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => {
  await session?.stop();
});

describe("0122 Wanted promotion outcome", () => {
  it("reports an existing save accurately and rollback restores 0121 behavior", () => {
    const profileId = "00000000-0000-4000-8000-000000000122";
    const ownerActor = `profile:${profileId}`;
    const fixedWantedId = "00000000-0000-4000-8000-000000000001";
    const rollbackWantedId = "00000000-0000-4000-8000-000000000002";

    session!.sql(`
      insert into public.wanteds (id, owner_actor, venue_kind, venue_id)
      values ('${fixedWantedId}', '${ownerActor}', 'curated', 'venue-fixed');
      insert into public.saved_pubs (profile_id, venue_id, list_type)
      values ('${profileId}', 'venue-fixed', 'favourites');
    `);

    expect(
      session!.sql(`
        select outcome || '|' || promoted_list_type || '|' || (promoted_at is not null)
        from public.promote_wanted_to_saved_list(
          '${ownerActor}', '${profileId}', '${fixedWantedId}', 'venue-fixed', 'favourites'
        )
      `),
    ).toBe("already_saved|favourites|true");
    expect(
      session!.sql(`
        select promoted_list_type || '|' || (promoted_at is not null)
        from public.wanteds where id = '${fixedWantedId}'
      `),
    ).toBe("favourites|true");

    session!.apply(ROLLBACK_0122_PATH);
    session!.sql(`
      insert into public.wanteds (id, owner_actor, venue_kind, venue_id)
      values ('${rollbackWantedId}', '${ownerActor}', 'curated', 'venue-rollback');
      insert into public.saved_pubs (profile_id, venue_id, list_type)
      values ('${profileId}', 'venue-rollback', 'favourites');
    `);

    expect(
      session!.sql(`
        select outcome || '|' || promoted_list_type || '|' || (promoted_at is not null)
        from public.promote_wanted_to_saved_list(
          '${ownerActor}', '${profileId}', '${rollbackWantedId}', 'venue-rollback', 'favourites'
        )
      `),
    ).toBe("saved|favourites|true");
    expect(
      session!.sql(`
        select promoted_list_type || '|' || (promoted_at is not null)
        from public.wanteds where id = '${rollbackWantedId}'
      `),
    ).toBe("favourites|true");
  });
});
