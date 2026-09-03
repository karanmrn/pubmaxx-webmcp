import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const migration = (name: string) => join(ROOT, "supabase/migrations", name);
const ROLLBACK_PATH = join(
  ROOT,
  "supabase/migrations/rollback/20260901100000_0134_plan_join_account_transition_rollback.sql",
);

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
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

type Session = {
  sql: (statement: string) => string;
  apply: (path: string) => void;
  stop: () => Promise<void>;
};

const BOOTSTRAP = `
  create schema extensions;
  create extension if not exists pgcrypto schema extensions;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  alter role postgres set search_path = public, extensions;
  create table public.plans (
    id uuid primary key,
    owner_user_id uuid,
    social_owner_account_id uuid
  );
  create table public.plan_crew_members (
    id uuid primary key,
    plan_id uuid not null references public.plans(id),
    name text not null,
    token_hash text not null,
    status text not null,
    joined_at timestamptz not null,
    updated_at timestamptz not null,
    can_collaborate boolean not null,
    user_id uuid,
    join_key_hash text,
    join_request_hash text,
    unique (plan_id, join_key_hash),
    unique (token_hash)
  );
  create table public.plan_invite_rsvps (
    id uuid primary key default extensions.gen_random_uuid(),
    plan_id uuid not null references public.plans(id),
    submitter_hash text not null,
    display_name text not null,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (plan_id, submitter_hash)
  );
  create table public.plan_invites (
    id uuid primary key,
    plan_id uuid not null references public.plans(id),
    token_hash text not null,
    revoked_at timestamptz,
    expires_at timestamptz not null,
    redeemed_at timestamptz
  );
`;

async function startSession(): Promise<Session> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL is required.");

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-plan-account-transition-"));
  const port = await freePort();
  let processHandle: ChildProcess | null = null;
  const args = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];
  const stop = async (): Promise<void> => {
    if (processHandle && processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle?.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
    }
    if (processHandle && processHandle.exitCode === null) processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    execFileSync(initdb, ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"], { stdio: "pipe" });
    writeFileSync(join(dataDir, "postgresql.auto.conf"), [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "max_connections = 30",
      "shared_buffers = 16MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n");
    processHandle = spawn(postgres, ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"], { stdio: "ignore" });
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync(psql, [...args, "-c", "select 1"], { stdio: "pipe" });
        ready = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!ready) throw new Error("PostgreSQL did not start.");

    const sql = (statement: string): string => execFileSync(
      psql,
      [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    sql(BOOTSTRAP);

    const apply = (path: string): void => {
      execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", path], { stdio: "pipe" });
    };
    apply(migration("20260830170000_0124_plan_invite_canonical_membership.sql"));
    sql(`
      create function public.join_plan_idempotent_atomic(
        uuid, uuid, text, text, timestamptz, boolean, text, text
      ) returns text language sql security definer set search_path = ''
      as $$ select public._0075_join_plan_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8) $$;
      create function public.redeem_plan_invite_idempotent_atomic(
        uuid, text, uuid, text, text, timestamptz, text, text
      ) returns text language sql security definer set search_path = ''
      as $$ select public._0075_redeem_plan_invite_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8) $$;
    `);
    apply(migration("20260831140000_0127_plan_membership_account_claim.sql"));
    apply(migration("20260831140500_0128_plan_membership_account_uniqueness.sql"));
    apply(migration("20260831141000_0129_plan_join_account_atomicity.sql"));
    apply(migration("20260901090000_0133_plan_account_recovery_idempotency.sql"));
    apply(migration("20260901100000_0134_plan_join_account_transition.sql"));

    return { sql, apply, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

let session: Session | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  const missing = (["initdb", "postgres", "psql"] as const).filter((name) => !binary(name));
  if (missing.length > 0) {
    skipReason = `Missing PostgreSQL binaries: ${missing.join(", ")}.`;
    console.error(`PLAN ACCOUNT TRANSITION EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS: ${skipReason}`);
    return;
  }
  session = await startSession();
}, 60_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => {
  await session?.stop();
});

describe("Plan account transition migrations", () => {
  it("binds anonymous join and redeem retries, then recovers stale RSVP tokens", () => {
    const planJoin = "10000000-0000-4000-8000-000000000001";
    const planRedeem = "10000000-0000-4000-8000-000000000002";
    const planKeyed = "10000000-0000-4000-8000-000000000003";
    const hostJoin = "20000000-0000-4000-8000-000000000001";
    const hostRedeem = "20000000-0000-4000-8000-000000000002";
    const hostKeyed = "20000000-0000-4000-8000-000000000003";
    const memberJoin = "30000000-0000-4000-8000-000000000001";
    const memberRedeem = "30000000-0000-4000-8000-000000000002";
    const memberKeyed = "30000000-0000-4000-8000-000000000003";
    const userJoin = "40000000-0000-4000-8000-000000000001";
    const userRedeem = "40000000-0000-4000-8000-000000000002";
    const userKeyed = "40000000-0000-4000-8000-000000000003";
    const when = "2026-09-01 12:00:00+00";

    session!.sql(`
      insert into public.plans (id) values ('${planJoin}'), ('${planRedeem}'), ('${planKeyed}');
      insert into public.plan_crew_members
        (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate)
      values
        ('${hostJoin}', '${planJoin}', 'Host', repeat('1', 64), 'in', '${when}', '${when}', true),
        ('${hostRedeem}', '${planRedeem}', 'Host', repeat('2', 64), 'in', '${when}', '${when}', true),
        ('${hostKeyed}', '${planKeyed}', 'Host', repeat('7', 64), 'in', '${when}', '${when}', true);
    `);

    expect(session!.sql(`
      select public.join_plan_idempotent_atomic(
        '${planJoin}', '${memberJoin}', 'Classic guest', repeat('b', 64), '${when}', false,
        repeat('a', 64),
        encode(extensions.digest(convert_to('{"name":"Classic guest","collaborationAuthorized":false}', 'UTF8'), 'sha256'), 'hex')
      )
    `)).toBe("joined");
    expect(session!.sql(`
      select public.join_plan_account_idempotent_atomic(
        '${planJoin}', '${memberJoin}', 'Classic guest', repeat('b', 64), '${when}', false,
        repeat('a', 64), repeat('c', 64), '${userJoin}'
      )
    `)).toBe("replayed");
    expect(session!.sql(`select user_id::text from public.plan_crew_members where id = '${memberJoin}'`)).toBe(userJoin);

    session!.sql(`
      insert into public.plan_invites (id, plan_id, token_hash, expires_at)
      values ('50000000-0000-4000-8000-000000000002', '${planRedeem}', repeat('d', 64), '${when}'::timestamptz + interval '1 day');
    `);
    expect(session!.sql(`
      select public.redeem_plan_invite_idempotent_atomic(
        '${planRedeem}', repeat('d', 64), '${memberRedeem}', 'Invite guest', repeat('e', 64), '${when}', repeat('f', 64),
        encode(extensions.digest(convert_to('{"name":"Invite guest","inviteHash":"' || repeat('d', 64) || '"}', 'UTF8'), 'sha256'), 'hex')
      )
    `)).toBe("joined");
    expect(session!.sql(`
      select public.redeem_plan_invite_account_idempotent_atomic(
        '${planRedeem}', repeat('d', 64), '${memberRedeem}', 'Invite guest', repeat('e', 64), '${when}', repeat('f', 64), repeat('7', 64), '${userRedeem}'
      )
    `)).toBe("replayed");
    expect(session!.sql(`select user_id::text from public.plan_crew_members where id = '${memberRedeem}'`)).toBe(userRedeem);

    expect(session!.sql(`
      select public.join_plan_account_idempotent_atomic(
        '${planKeyed}', '${memberKeyed}', 'Keyed guest', repeat('8', 64), '${when}', false,
        repeat('a', 64), repeat('b', 64), '${userKeyed}'
      )
    `)).toBe("joined");
    expect(session!.sql(`
      select public.recover_plan_account_membership_atomic('${planKeyed}', '${userKeyed}', repeat('9', 64), repeat('c', 64), repeat('d', 64), '${when}'::timestamptz + interval '1 minute')
    `)).toBe("recovered");
    expect(session!.sql(`
      select public.join_plan_account_idempotent_atomic(
        '${planKeyed}', '${memberKeyed}', 'Keyed guest', repeat('8', 64), '${when}', false,
        repeat('a', 64), repeat('b', 64), '${userKeyed}'
      )
    `)).toBe("conflict");

    session!.sql(`
      insert into public.plan_invite_rsvps
        (id, plan_id, submitter_hash, display_name, status, member_id, created_at, updated_at)
      values
        ('60000000-0000-4000-8000-000000000001', '${planJoin}', repeat('8', 64), 'Classic guest', 'going', '${memberJoin}', '${when}', '${when}'),
        ('60000000-0000-4000-8000-000000000002', '${planRedeem}', repeat('9', 64), 'Invite guest', 'going', '${memberRedeem}', '${when}', '${when}');
    `);

    expect(session!.sql(`
      select public.recover_plan_account_membership_atomic('${planJoin}', '${userJoin}', repeat('3', 64), repeat('2', 64), repeat('3', 64), '${when}'::timestamptz + interval '1 minute')
    `)).toBe("recovered");
    expect(session!.sql(`
      select public.recover_plan_account_membership_atomic('${planRedeem}', '${userRedeem}', repeat('5', 64), repeat('5', 64), repeat('6', 64), '${when}'::timestamptz + interval '1 minute')
    `)).toBe("recovered");

    expect(session!.sql(`
      select public.upsert_plan_invite_rsvp_membership_atomic(
        '${planJoin}', repeat('8', 64), 'Classic guest', 'maybe', '${memberJoin}', null, 'Classic guest', repeat('7', 64), repeat('a', 64), repeat('b', 64), '${when}'::timestamptz + interval '2 minutes', 20
      )->>'outcome'
    `)).toBe("saved");
    expect(session!.sql(`
      select public.upsert_plan_invite_rsvp_membership_atomic(
        '${planJoin}', repeat('8', 64), 'Classic guest', 'going', '${memberJoin}', null, 'Classic guest', repeat('b', 64), repeat('a', 64), repeat('b', 64), '${when}'::timestamptz + interval '3 minutes', 20
      )->>'outcome'
    `)).toBe("saved");

    expect(session!.sql(`
      select public.upsert_plan_invite_rsvp_membership_atomic(
        '${planRedeem}', repeat('9', 64), 'Invite guest', 'maybe', '${memberRedeem}', null, 'Invite guest', repeat('8', 64), repeat('f', 64), repeat('d', 64), '${when}'::timestamptz + interval '2 minutes', 20
      )->>'outcome'
    `)).toBe("saved");
    expect(session!.sql(`
      select public.upsert_plan_invite_rsvp_membership_atomic(
        '${planRedeem}', repeat('9', 64), 'Invite guest', 'going', '${memberRedeem}', null, 'Invite guest', repeat('e', 64), repeat('f', 64), repeat('d', 64), '${when}'::timestamptz + interval '3 minutes', 20
      )->>'outcome'
    `)).toBe("saved");

    expect(session!.sql(`
      select public.recover_plan_account_membership_atomic('${planJoin}', '${userJoin}', repeat('3', 64), repeat('2', 64), repeat('3', 64), '${when}'::timestamptz + interval '4 minutes')
    `)).toBe("recovered");
    expect(session!.sql(`
      select public.recover_plan_account_membership_atomic('${planRedeem}', '${userRedeem}', repeat('5', 64), repeat('5', 64), repeat('6', 64), '${when}'::timestamptz + interval '4 minutes')
    `)).toBe("recovered");

    session!.apply(ROLLBACK_PATH);
    expect(session!.sql(`
      select count(*)::text
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname = '_reconcile_plan_account_join'
    `)).toBe("0");
  });
});
