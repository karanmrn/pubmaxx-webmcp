import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 0079 stops handle claims from inheriting pre-claim contributions.
// Its own header comment states the rule; before this test the only proof was
// a regex over the migration's SQL text. This test applies the real migration
// history through PostgreSQL 16 (same harness family as socialCrewMigration.
// test.ts) and runs public_contributor_leaderboard() for real, so the
// no-inheritance rule is proven by executing it, not by reading its source.
const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260807010000_0079_handle_claim_no_inheritance.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const path of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
  ]) {
    try {
      if (!existsSync(path)) continue;
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
  const directory = mkdtempSync(join(tmpdir(), "pubmax-handle-claim-"));
  const port = await freePort();
  execFileSync(initdb, [
    "-D", directory, "--auth=trust", "--username=postgres",
    "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
  ], { stdio: "pipe" });
  writeFileSync(join(directory, "postgresql.auto.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\n`);
  // -k puts the unix socket in the data directory. The compiled-in socket
  // directory (/var/run/postgresql) is not writable on a CI runner, so the
  // cluster refuses to boot without it. Connections still go over TCP.
  const server: ChildProcess = spawn(postgres, ["-D", directory, "-k", directory, "-h", "127.0.0.1", "-p", String(port)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Keep the server log so a boot failure names its own reason. The stream is
  // always consumed, and only the tail is retained, so a long run cannot fill
  // the pipe buffer and stall the cluster.
  let serverLog = "";
  server.stderr!.setEncoding("utf8");
  server.stderr!.on("data", (chunk: string) => {
    serverLog = (serverLog + chunk).slice(-8_000);
  });
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  const BOOT_ATTEMPTS = 600;
  for (let attempt = 0; attempt < BOOT_ATTEMPTS; attempt += 1) {
    try {
      execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
      break;
    } catch {
      if (server.exitCode !== null) {
        throw new Error(`PostgreSQL exited with code ${server.exitCode} before accepting connections.\n${serverLog.trim()}`);
      }
      if (attempt === BOOT_ATTEMPTS - 1) {
        throw new Error(`PostgreSQL did not start within 60s.\n${serverLog.trim()}`);
      }
      await sleep(100);
    }
  }
  const run = (args: string[]) => execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", resolve)), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const CLAIMANT_USER = "10101010-1010-4101-8101-101010101010";
const HANDLE = "earlybird";
const PRE_CLAIM_ROW = "20202020-2020-4202-8202-202020202020";
const POST_CLAIM_ROW = "30303030-3030-4303-8303-303030303030";
// Fixed far-past timestamp: always earlier than the real wall-clock claimed_at
// the claim RPC stamps at run time, regardless of when this test executes.
const PRE_CLAIM_SUBMITTED_AT = "2020-01-01T00:00:00Z";

function insertContribution(id: string, submittedAt: string, actor: string): string {
  return `
    insert into public.community_prices
      (id, venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at)
    values
      ('${id}', 'test-venue-handle-claim', 'beer', 450, '${actor}', '${HANDLE}', '${submittedAt}');
  `;
}

let database: Database | null = null;

beforeAll(async () => {
  if (!existsSync(FORWARD)) throw new Error(`Missing migration: ${FORWARD}`);
  database = await startDatabase();
  database.apply(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.apply(migration);
  database.sql(`insert into auth.users(id) values ('${CLAIMANT_USER}');`);
  database.apply(FORWARD);
}, 120_000);

afterAll(async () => database?.stop());

describe("handle claim no-inheritance migration", () => {
  it("runs the actual prerequisite migration history on PostgreSQL 16", () => {
    const db = database!;
    expect(db.sql("select current_setting('server_version_num')::int / 10000")).toBe("16");
    expect(existsSync(FORWARD)).toBe(true);
  });

  it("excludes a pre-claim contribution, includes a post-claim one, and never rewrites the pre-claim row's own display", () => {
    const db = database!;

    // (1) Seed a contribution recorded under HANDLE before anyone claims it.
    db.sql(insertContribution(PRE_CLAIM_ROW, PRE_CLAIM_SUBMITTED_AT, "pre-claim-device"));

    // (2) Claim HANDLE for real through the production RPC. It creates the
    // profile and the profile_handle_aliases row in one call, and claimed_at
    // defaults to now() - strictly after the fixed 2020 pre-claim timestamp.
    const claimResult = JSON.parse(db.sql(
      `select public.claim_pubmaxx_handle('${CLAIMANT_USER}', '${HANDLE}')`,
    )) as { ok: boolean; profile_id: string; handle: string };
    expect(claimResult.ok).toBe(true);
    expect(claimResult.handle).toBe(HANDLE);

    const claimedAt = db.sql(
      `select claimed_at from public.profile_handle_aliases where lower(handle) = '${HANDLE}'`,
    );
    expect(new Date(claimedAt).getTime()).toBeGreaterThan(new Date(PRE_CLAIM_SUBMITTED_AT).getTime());

    // (3) The pre-claim row must not count toward the claiming profile yet.
    const preClaimLeaderboard = db.sql(
      `select coalesce(total, 0) from public.public_contributor_leaderboard() where handle = '${HANDLE}'`,
    );
    expect(preClaimLeaderboard).toBe("");

    // (4) A contribution recorded after the claim must count.
    db.sql(insertContribution(POST_CLAIM_ROW, claimedAt, "post-claim-device"));
    const postClaimRow = db.sql(
      `select prices, total from public.public_contributor_leaderboard() where handle = '${HANDLE}'`,
    );
    expect(postClaimRow).toBe("1|1");

    // (5) Display-vs-attribution split: the pre-claim row's own surface read
    // still shows the handle it was originally recorded under, unchanged.
    const preClaimDisplay = db.sql(
      `select contributor_handle from public.community_prices where id = '${PRE_CLAIM_ROW}'`,
    );
    expect(preClaimDisplay).toBe(HANDLE);
  });
});
