import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260806235944_0075_social_crews.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(ROOT, "supabase/migrations/rollback/20260806235944_0075_social_crews_rollback.sql");
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

const execFileAsync = promisify(execFile);
type Database = {
  sql(statement: string): string;
  apply(path: string): void;
  concurrentResults(statements: readonly string[]): Promise<string[]>;
  snapshotDuringWrite(mutation: string, snapshotExpression: string): Promise<unknown>;
  stop(): Promise<void>;
};

function authenticatedSql(db: Database, userId: string, statement: string): string {
  return db.sql(`begin;
    set local role authenticated;
    set local "request.jwt.claim.sub"='${userId}';
    ${statement};
    rollback`);
}

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
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-crews-"));
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
  const concurrentResults = (statements: readonly string[]) => Promise.all(
    statements.map(async (statement) => {
      const { stdout } = await execFileAsync(psql, [
        ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement,
      ], { encoding: "utf8" });
      return stdout.trim();
    }),
  );
  const snapshotDuringWrite = async (mutation: string, snapshotExpression: string): Promise<unknown> => {
    const barrierKey = "7531001";
    const readyMarker = "SOCIAL_CREW_MUTATION_READY";
    const writer = spawn(psql, [
      ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    writer.stdout!.setEncoding("utf8");
    writer.stderr!.setEncoding("utf8");
    let writerOutput = "";
    let writerError = "";
    writer.stderr!.on("data", (chunk: string) => { writerError += chunk; });
    const ready = new Promise<void>((resolve, reject) => {
      writer.stdout!.on("data", (chunk: string) => {
        writerOutput += chunk;
        if (writerOutput.includes(readyMarker)) resolve();
      });
      writer.once("error", reject);
      writer.once("exit", (code) => {
        if (!writerOutput.includes(readyMarker)) {
          reject(new Error(`Race writer exited before barrier (${code}): ${writerError}`));
        }
      });
    });
    writer.stdin!.write(`begin;
      select pg_catalog.pg_advisory_xact_lock(${barrierKey}::bigint);
      ${mutation};
      select '${readyMarker}';
    `);
    let readerCompleted = false;
    try {
      await Promise.race([
        ready,
        sleep(10_000).then(() => { throw new Error("Race writer did not reach barrier."); }),
      ]);
      const { stdout } = await execFileAsync(psql, [
        ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c",
        `select case
          when pg_catalog.pg_try_advisory_lock(${barrierKey}::bigint) then '"barrier_missing"'
          else coalesce((${snapshotExpression}),'null'::jsonb)::text
        end`,
      ], { encoding: "utf8" });
      const snapshot = jsonValue(stdout.trim());
      readerCompleted = true;
      return snapshot;
    } finally {
      const exited = new Promise<number | null>((resolve) => writer.once("exit", resolve));
      if (writer.exitCode === null) {
        writer.stdin!.end(`${readerCompleted ? "commit" : "rollback"};\n\\q\n`);
        await Promise.race([
          exited,
          sleep(10_000).then(() => {
            writer.kill("SIGTERM");
            throw new Error("Race writer did not commit.");
          }),
        ]);
      }
      if (writer.exitCode !== 0) {
        throw new Error(`Race writer failed (${writer.exitCode}): ${writerError}`);
      }
    }
  };
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    apply: (path) => run(["-f", path]),
    concurrentResults,
    snapshotDuringWrite,
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", resolve)), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const ALICE_PROFILE = "11111111-1111-4111-8111-111111111111";
const BOB_PROFILE = "22222222-2222-4222-8222-222222222222";
const CAROL_PROFILE = "33333333-3333-4333-8333-333333333333";
const DAVE_PROFILE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ALICE_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAROL_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DAVE_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const ALICE_ACCOUNT = "a1111111-1111-4111-8111-111111111111";
const BOB_ACCOUNT = "b2222222-2222-4222-8222-222222222222";
const CAROL_ACCOUNT = "c3333333-3333-4333-8333-333333333333";
const DAVE_ACCOUNT = "d4444444-4444-4444-8444-444444444444";
const EVE_PROFILE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const EVE_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const EVE_ACCOUNT = "e5555555-5555-4555-8555-555555555555";
const FRANK_PROFILE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const FRANK_USER = "ffffffff-ffff-4fff-8fff-ffffffffff01";
const FRANK_ACCOUNT = "f6666666-6666-4666-8666-666666666666";
const PLAN = "44444444-4444-4444-8444-444444444444";
const OTHER_PLAN = "01010101-aaaa-4aaa-8aaa-010101010101";
const OTHER_CREW = "02020202-aaaa-4aaa-8aaa-020202020202";
const OTHER_PLAN_MEMBER = "03030303-aaaa-4aaa-8aaa-030303030303";
const OTHER_CREW_MEMBER = "04040404-aaaa-4aaa-8aaa-040404040404";
const READ_PLAN = "10101010-bbbb-4bbb-8bbb-101010101010";
const READ_CREW = "20202020-bbbb-4bbb-8bbb-202020202020";
const READ_OWNER_PLAN_MEMBER = "30303030-bbbb-4bbb-8bbb-303030303030";
const READ_MEMBER_PLAN_MEMBER = "40404040-bbbb-4bbb-8bbb-404040404040";
const READ_OWNER_MEMBER = "50505050-bbbb-4bbb-8bbb-505050505050";
const READ_MEMBER = "60606060-bbbb-4bbb-8bbb-606060606060";
const READ_ROGUE_PLAN = "90909090-bbbb-4bbb-8bbb-909090909091";
const READ_ROGUE_PLAN_MEMBER = "90909090-bbbb-4bbb-8bbb-909090909092";
const HOST_MEMBER = "55555555-5555-4555-8555-555555555555";
const HOST_TOKEN_HASH = "1".repeat(64);
const LEGACY_GUEST = "66666666-6666-4666-8666-666666666666";
const LEGACY_GUEST_HASH = "2".repeat(64);
const LEGACY_INVITE = "77777777-7777-4777-8777-777777777777";
const LEGACY_INVITE_HASH = "3".repeat(64);
const LEGACY_CONSTRAINT = "81818181-8181-4181-8181-818181818181";
const LEGACY_PROPOSAL = "82828282-8282-4282-8282-828282828282";
const LEGACY_VOTE = "83838383-8383-4383-8383-838383838383";
const LEGACY_VIBE_VOTE = "84848484-8484-4484-8484-848484848484";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function json(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function jsonValue(value: string): unknown {
  return JSON.parse(value);
}

function readSnapshot(
  db: Database,
  accountId: string,
  profileId: string,
  targetCrewId = READ_CREW,
): unknown {
  return jsonValue(db.sql(`select coalesce(public.read_social_crew_snapshot(
    '${accountId}','${profileId}','${targetCrewId}'
  ),'null'::jsonb)`));
}

function readMemberPage(
  db: Database,
  accountId: string,
  profileId: string,
  limit: number,
  cursor: { joinedAt: string; memberId: string } | null = null,
): unknown {
  const joinedAt = cursor ? `'${cursor.joinedAt}'::timestamptz` : "null";
  const memberId = cursor ? `'${cursor.memberId}'::uuid` : "null";
  return jsonValue(db.sql(`select coalesce(public.read_social_crew_member_page(
    '${accountId}','${profileId}',${joinedAt},${memberId},${limit}
  ),'null'::jsonb)`));
}

function snapshotExpression(accountId: string, profileId: string): string {
  return `public.read_social_crew_snapshot('${accountId}','${profileId}','${READ_CREW}')`;
}

function expectedReadMemberSnapshot({
  ownerRelationship,
  ownerAccountId = ALICE_ACCOUNT,
  ownerProfileId = ALICE_PROFILE,
  authorityRevision = 9,
  aliceRole = "owner",
  bobRole = "cohost",
}: {
  ownerRelationship: "self" | "mutual";
  ownerAccountId?: string;
  ownerProfileId?: string;
  authorityRevision?: number;
  aliceRole?: "owner" | "cohost";
  bobRole?: "owner" | "cohost";
}): unknown {
  return {
    kind: "member",
    ownerRelationship,
    crew: {
      crewId: READ_CREW,
      planId: READ_PLAN,
      ownerAccountId,
      ownerProfileId,
      visibility: "friends",
      authorityRevision,
      joinRequestState: "none",
      members: [
        {
          memberId: READ_OWNER_MEMBER,
          accountId: ALICE_ACCOUNT,
          profileId: ALICE_PROFILE,
          planMemberId: READ_OWNER_PLAN_MEMBER,
          handle: "alice",
          role: aliceRole,
          state: "active",
          joinedAt: "2026-08-05T10:00:00.123456Z",
        },
        {
          memberId: READ_MEMBER,
          accountId: BOB_ACCOUNT,
          profileId: BOB_PROFILE,
          planMemberId: READ_MEMBER_PLAN_MEMBER,
          handle: "bob",
          role: bobRole,
          state: "active",
          joinedAt: "2026-08-05T11:00:00.654321Z",
        },
      ],
    },
    plan: {
      plan: {
        id: READ_PLAN,
        title: "Projected night",
        startTime: "2026-08-10T19:00:00.654321Z",
        createdAt: "2026-08-05T10:00:00.123456Z",
        routeRevision: 7,
        status: "ending",
        anchorVenueId: "venue-one",
        anchorSource: "tonight",
        outcome: "route",
        routeReadyAt: "2026-08-05T10:30:00.111222Z",
      },
      stops: [
        { venueId: "venue-one", venueName: "Venue One", position: 0 },
        { venueId: "venue-two", venueName: "Venue Two", position: 1 },
      ],
      context: {
        nightArea: "camden",
        daypart: "evening",
        partyType: "friends",
        groupSize: 4,
        budget: "standard",
        budgetLimitPence: 2500,
        zeroProof: false,
        // 0075's SQL allowlist predates wetherspoonsPreferred; this harness
        // applies ONLY up to 0075, so the key is absent here by design.
        // Migration 0084 adds it for the live function (TS parity).
        atmosphere: ["lively"],
        foodNeeds: ["vegan"],
        accessibility: ["step-free"],
        transportConstraints: ["tube"],
      },
      actions: [
        {
          id: "71717171-bbbb-4bbb-8bbb-717171717171",
          type: "arrived",
          stopPosition: 0,
          ending: null,
          createdAt: "2026-08-05T11:30:00.111111Z",
        },
        {
          id: "81818181-bbbb-4bbb-8bbb-818181818181",
          type: "ending",
          stopPosition: null,
          ending: "get_home",
          createdAt: "2026-08-05T12:00:00.999999Z",
        },
      ],
      ending: "get_home",
    },
  };
}

function seedReadFixture(db: Database): void {
  db.sql(`
    delete from public.social_blocks
      where blocker_profile_id in ('${ALICE_PROFILE}','${BOB_PROFILE}','${CAROL_PROFILE}')
        and blocked_profile_id in ('${ALICE_PROFILE}','${BOB_PROFILE}','${CAROL_PROFILE}');
    delete from public.social_crews where id='${READ_CREW}';
    delete from public.plans where id in ('${READ_PLAN}','${READ_ROGUE_PLAN}');

    insert into auth.users(id) values('${EVE_USER}'),('${FRANK_USER}')
      on conflict(id) do nothing;
    insert into public.profiles(id,user_id,handle) values
      ('${EVE_PROFILE}','${EVE_USER}','eve'),
      ('${FRANK_PROFILE}','${FRANK_USER}','frank')
      on conflict(id) do update set user_id=excluded.user_id,handle=excluded.handle;
    insert into public.private_social_accounts(
      id,clerk_user_id,supabase_user_id,profile_id,ownership_state
    ) values
      ('${EVE_ACCOUNT}','clerk-eve','${EVE_USER}','${EVE_PROFILE}','active'),
      ('${FRANK_ACCOUNT}','clerk-frank','${FRANK_USER}','${FRANK_PROFILE}','active')
      on conflict(id) do update set
        clerk_user_id=excluded.clerk_user_id,
        supabase_user_id=excluded.supabase_user_id,
        profile_id=excluded.profile_id,
        ownership_state='active';
    update public.private_social_accounts set ownership_state='active'
      where id in ('${ALICE_ACCOUNT}','${BOB_ACCOUNT}','${CAROL_ACCOUNT}');
    insert into public.follows(follower_id,followee_id) values
      ('${ALICE_PROFILE}','${BOB_PROFILE}'),('${BOB_PROFILE}','${ALICE_PROFILE}'),
      ('${ALICE_PROFILE}','${CAROL_PROFILE}'),('${CAROL_PROFILE}','${ALICE_PROFILE}')
      on conflict do nothing;

    insert into public.plans(id,title,start_time,owner_user_id,status)
      values('${READ_ROGUE_PLAN}','Rogue binding','2026-08-11 19:00:00+00','${BOB_USER}','ready');
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      '${READ_ROGUE_PLAN_MEMBER}','${READ_ROGUE_PLAN}','Bob',
      md5('read-rogue-bob')||md5('read-rogue-bob-2'),'in','${BOB_USER}',now(),now(),true,'${BOB_ACCOUNT}'
    );

    insert into public.plans(
      id,title,start_time,owner_user_id,created_at,status,night_context,ending,
      route_revision,anchor_venue_id,anchor_source,plan_outcome,route_ready_at,social_owner_account_id
    ) values(
      '${READ_PLAN}','Projected night','2026-08-10 19:00:00.654321+00','${ALICE_USER}',
      '2026-08-05 10:00:00.123456+00','ending',
      '{
        "nightArea":"camden","daypart":"evening","partyType":"friends",
        "groupSize":4,"budget":"standard","budgetLimitPence":2500,"zeroProof":false,
        "atmosphere":["lively"],"foodNeeds":["vegan"],"accessibility":["step-free"],
        "transportConstraints":["tube"],"poisonContextSecret":"must-not-escape"
      }'::jsonb,'get_home',7,'venue-one','tonight','route','2026-08-05 10:30:00.111222+00','${ALICE_ACCOUNT}'
    );
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ('${READ_PLAN}','venue-two','Venue Two',1),
      ('${READ_PLAN}','venue-one','Venue One',0);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values
      ('${READ_MEMBER_PLAN_MEMBER}','${READ_PLAN}','Bob',md5('read-bob')||md5('read-bob-2'),'in','${BOB_USER}',
        '2026-08-05 11:00:00.654321+00','2026-08-05 11:00:00.654321+00',true,'${BOB_ACCOUNT}'),
      ('${READ_OWNER_PLAN_MEMBER}','${READ_PLAN}','Alice',md5('read-alice')||md5('read-alice-2'),'in','${ALICE_USER}',
        '2026-08-05 10:00:00.123456+00','2026-08-05 10:00:00.123456+00',true,'${ALICE_ACCOUNT}');
    insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,ending,created_at) values
      ('81818181-bbbb-4bbb-8bbb-818181818181','${READ_PLAN}','${READ_MEMBER_PLAN_MEMBER}','ending',null,'get_home','2026-08-05 12:00:00.999999+00'),
      ('71717171-bbbb-4bbb-8bbb-717171717171','${READ_PLAN}','${READ_OWNER_PLAN_MEMBER}','arrived',0,null,'2026-08-05 11:30:00.111111+00');
    insert into public.social_crews(id,plan_id,owner_account_id,visibility,authority_revision,created_at,updated_at)
      values('${READ_CREW}','${READ_PLAN}','${ALICE_ACCOUNT}','friends',9,
        '2026-08-05 10:00:00.123456+00','2026-08-05 12:00:00.999999+00');
    insert into public.social_crew_members(
      id,crew_id,social_account_id,plan_member_id,role,state,joined_at,updated_at
    ) values
      ('${READ_MEMBER}','${READ_CREW}','${BOB_ACCOUNT}','${READ_MEMBER_PLAN_MEMBER}','cohost','active',
        '2026-08-05 11:00:00.654321+00','2026-08-05 11:00:00.654321+00'),
      ('${READ_OWNER_MEMBER}','${READ_CREW}','${ALICE_ACCOUNT}','${READ_OWNER_PLAN_MEMBER}','owner','active',
        '2026-08-05 10:00:00.123456+00','2026-08-05 10:00:00.123456+00');
  `);
}

function seedMemberPageIdentities(db: Database): void {
  seedReadFixture(db);
  db.sql(`
    insert into auth.users(id) values('${DAVE_USER}') on conflict(id) do nothing;
    insert into public.profiles(id,user_id,handle)
      values('${DAVE_PROFILE}','${DAVE_USER}','dave')
      on conflict(id) do update set user_id=excluded.user_id,handle=excluded.handle;
    insert into public.private_social_accounts(
      id,clerk_user_id,supabase_user_id,profile_id,ownership_state
    ) values('${DAVE_ACCOUNT}','clerk-dave','${DAVE_USER}','${DAVE_PROFILE}','active')
      on conflict(id) do update set
        clerk_user_id=excluded.clerk_user_id,
        supabase_user_id=excluded.supabase_user_id,
        profile_id=excluded.profile_id,
        ownership_state='active';
    delete from public.social_blocks
      where (blocker_profile_id='${DAVE_PROFILE}' and blocked_profile_id='${EVE_PROFILE}')
         or (blocker_profile_id='${EVE_PROFILE}' and blocked_profile_id='${DAVE_PROFILE}');
  `);
}

type MemberPageResult = {
  items: Array<{ crewId: string; memberId: string; joinedAt: string }>;
  hasMore: boolean;
  cursorPosition: { joinedAt: string; memberId: string } | null;
};

type MemberPageCrewFixture = {
  planId: string;
  crewId: string;
  viewerMemberId: string;
};

function memberPageFixtureUuid(scope: number, ordinal: number, entity: number): string {
  const tail = [scope, ordinal, entity]
    .map((value) => value.toString(16).padStart(4, "0"))
    .join("");
  return `70000000-0000-4000-8000-${tail}`;
}

function insertMemberPageCrew(
  db: Database,
  input: {
    scope: number;
    ordinal: number;
    owner: "eve" | "alice";
    joinedAt: string;
    title: string;
  },
): MemberPageCrewFixture {
  const planId = memberPageFixtureUuid(input.scope, input.ordinal, 1);
  const crewId = memberPageFixtureUuid(input.scope, input.ordinal, 2);
  const ownerPlanMemberId = memberPageFixtureUuid(input.scope, input.ordinal, 3);
  const viewerPlanMemberId = input.owner === "eve"
    ? ownerPlanMemberId
    : memberPageFixtureUuid(input.scope, input.ordinal, 4);
  const ownerMemberId = memberPageFixtureUuid(input.scope, input.ordinal, 5);
  const viewerMemberId = input.owner === "eve"
    ? ownerMemberId
    : memberPageFixtureUuid(input.scope, input.ordinal, 6);
  const owner = input.owner === "eve"
    ? { accountId: EVE_ACCOUNT, userId: EVE_USER, name: "Eve" }
    : { accountId: ALICE_ACCOUNT, userId: ALICE_USER, name: "Alice" };

  db.sql(`
    insert into public.plans(
      id,title,start_time,owner_user_id,status,night_context,social_owner_account_id
    ) values(
      '${planId}','${input.title}','2031-08-20 19:00:00.123456+00','${owner.userId}',
      'ready','{"nightArea":"camden"}'::jsonb,'${owner.accountId}'
    );
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      '${ownerPlanMemberId}','${planId}','${owner.name}',md5('${planId}')||md5('${crewId}'),
      'in','${owner.userId}',now(),now(),true,'${owner.accountId}'
    );
    ${input.owner === "eve" ? "" : `insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      '${viewerPlanMemberId}','${planId}','Eve',md5('${viewerPlanMemberId}')||md5('${viewerMemberId}'),
      'in','${EVE_USER}',now(),now(),true,'${EVE_ACCOUNT}'
    );`}
    insert into public.social_crews(id,plan_id,owner_account_id,visibility)
      values('${crewId}','${planId}','${owner.accountId}','${input.owner === "eve" ? "private" : "friends"}');
    insert into public.social_crew_members(
      id,crew_id,social_account_id,plan_member_id,role,state,joined_at,updated_at
    ) values(
      '${ownerMemberId}','${crewId}','${owner.accountId}','${ownerPlanMemberId}','owner','active',
      '${input.owner === "eve" ? input.joinedAt : "2031-08-01 10:00:00.000001+00"}',now()
    );
    ${input.owner === "eve" ? "" : `insert into public.social_crew_members(
      id,crew_id,social_account_id,plan_member_id,role,state,joined_at,updated_at
    ) values(
      '${viewerMemberId}','${crewId}','${EVE_ACCOUNT}','${viewerPlanMemberId}','member','active',
      '${input.joinedAt}',now()
    );`}
  `);
  return { planId, crewId, viewerMemberId };
}

function beginMemberPageFixture(db: Database): void {
  seedMemberPageIdentities(db);
  db.sql(`
    delete from public.social_blocks
      where (blocker_profile_id='${ALICE_PROFILE}' and blocked_profile_id='${EVE_PROFILE}')
         or (blocker_profile_id='${EVE_PROFILE}' and blocked_profile_id='${ALICE_PROFILE}');
    insert into public.follows(follower_id,followee_id) values
      ('${EVE_PROFILE}','${ALICE_PROFILE}'),('${ALICE_PROFILE}','${EVE_PROFILE}')
      on conflict do nothing;
  `);
}

function cleanMemberPageFixture(db: Database, fixtures: readonly MemberPageCrewFixture[]): void {
  db.sql(`
    delete from public.social_blocks
      where (blocker_profile_id='${ALICE_PROFILE}' and blocked_profile_id='${EVE_PROFILE}')
         or (blocker_profile_id='${EVE_PROFILE}' and blocked_profile_id='${ALICE_PROFILE}');
    insert into public.follows(follower_id,followee_id) values
      ('${EVE_PROFILE}','${ALICE_PROFILE}'),('${ALICE_PROFILE}','${EVE_PROFILE}')
      on conflict do nothing;
    delete from public.social_crews where id in (${fixtures.map(({ crewId }) => `'${crewId}'`).join(",")});
    delete from public.plans where id in (${fixtures.map(({ planId }) => `'${planId}'`).join(",")});
  `);
}

function catalog(db: Database): string {
  return db.sql(`
    with catalog_item(item) as (
      select 'table|' || c.relname || '|' || c.relkind::text || '|' || c.relrowsecurity::text || '|' || coalesce(c.relacl::text,'')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','S')
      union all
      select 'column|' || c.relname || '|' || a.attnum::text || '|' || a.attname || '|' ||
             pg_catalog.format_type(a.atttypid,a.atttypmod) || '|' || a.attnotnull::text || '|' ||
             coalesce(pg_get_expr(d.adbin,d.adrelid),'') || '|' || coalesce(a.attacl::text,'')
      from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname='public' and a.attnum>0 and not a.attisdropped and c.relkind in ('r','p')
      union all
      select 'constraint|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid,true)
      from pg_constraint where connamespace='public'::regnamespace
      union all
      select 'index|' || indexname || '|' || indexdef from pg_indexes where schemaname='public'
      union all
      select 'function|' || p.oid::regprocedure::text || '|' || coalesce(p.proacl::text,'') || '|' || pg_get_functiondef(p.oid)
      from pg_proc p where p.pronamespace='public'::regnamespace
      union all
      select 'trigger|' || tgrelid::regclass::text || '|' || tgname || '|' || pg_get_triggerdef(oid,true)
      from pg_trigger where tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) and not tgisinternal
      union all
      select 'policy|' || tablename || '|' || policyname || '|' || roles::text || '|' || cmd || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'')
      from pg_policies where schemaname='public'
    ) select coalesce(string_agg(item,E'\\n' order by item),'') from catalog_item
  `);
}

function callCreate(digest = DIGEST_A, key = "create-crew-key-0001"): string {
  return `select public.create_social_crew_atomic(
    '${ALICE_ACCOUNT}','${PLAN}','${HOST_TOKEN_HASH}','friends','${key}','${digest}'
  )`;
}

let database: Database | null = null;
let beforeCatalog = "";
let crewId = "";
let invitationId = "";
let carolInvitationId = "";

beforeAll(async () => {
  if (!existsSync(FORWARD)) throw new Error(`Missing migration: ${FORWARD}`);
  database = await startDatabase();
  database.apply(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.apply(migration);
  database.sql(`
    insert into auth.users(id) values ('${ALICE_USER}'),('${BOB_USER}'),('${CAROL_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${ALICE_PROFILE}','${ALICE_USER}','alice'),
      ('${BOB_PROFILE}','${BOB_USER}','bob'),
      ('${CAROL_PROFILE}','${CAROL_USER}','carol');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values
      ('${ALICE_ACCOUNT}','clerk-alice','${ALICE_USER}','${ALICE_PROFILE}'),
      ('${BOB_ACCOUNT}','clerk-bob','${BOB_USER}','${BOB_PROFILE}'),
      ('${CAROL_ACCOUNT}','clerk-carol','${CAROL_USER}','${CAROL_PROFILE}');
    insert into public.follows(follower_id,followee_id) values
      ('${ALICE_PROFILE}','${BOB_PROFILE}'),('${BOB_PROFILE}','${ALICE_PROFILE}');
    insert into public.plans(id,title,start_time,status,owner_user_id) values
      ('${PLAN}','Social night',now()+interval '1 day','ready','${ALICE_USER}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${PLAN}','venue-one','Venue One',0);
    insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,user_id)
      values
      ('${HOST_MEMBER}','${PLAN}','Alice','${HOST_TOKEN_HASH}','in',now()-interval '2 minutes',now(),true,'${ALICE_USER}'),
      ('${LEGACY_GUEST}','${PLAN}','Legacy guest','${LEGACY_GUEST_HASH}','in',now()-interval '1 minute',now(),true,null);
    insert into public.plan_invites(id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at)
      values('${LEGACY_INVITE}','${PLAN}','${HOST_MEMBER}','${LEGACY_INVITE_HASH}','legacy-invite',now(),now()+interval '1 day');
    insert into public.plan_constraints(id,plan_id,member_id,kind,value,priority,idempotency_key,created_at)
      values('${LEGACY_CONSTRAINT}','${PLAN}','${HOST_MEMBER}','budget','Under twenty pounds','required','legacy-constraint',now());
    insert into public.plan_route_proposals(
      id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,
      resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,created_at
    ) values(
      '${LEGACY_PROPOSAL}','${PLAN}','${HOST_MEMBER}',1,
      '[{"venueId":"venue-one","venueName":"Venue One","position":0}]'::jsonb,
      'Legacy proposal','[]'::jsonb,'["${LEGACY_CONSTRAINT}"]'::jsonb,'pending','legacy-proposal',now()
    );
    insert into public.plan_votes(id,plan_id,proposal_id,member_id,value,idempotency_key,created_at)
      values('${LEGACY_VOTE}','${PLAN}','${LEGACY_PROPOSAL}','${HOST_MEMBER}','approve','legacy-vote',now());
    insert into public.plan_vote_requests(plan_id,member_id,idempotency_key,vote_id,value,created_at)
      values('${PLAN}','${HOST_MEMBER}','legacy-vote','${LEGACY_VOTE}','approve',now());
    insert into public.plan_vibe_votes(id,plan_id,member_id,vibe,idempotency_key,created_at,updated_at)
      values('${LEGACY_VIBE_VOTE}','${PLAN}','${HOST_MEMBER}','quiet','legacy-vibe',now(),now());
    insert into public.plan_vibe_vote_requests(plan_id,member_id,idempotency_key,vibe,created_at)
      values('${PLAN}','${HOST_MEMBER}','legacy-vibe','quiet',now());
  `);
  beforeCatalog = catalog(database);
  database.apply(FORWARD);
}, 120_000);

afterAll(async () => database?.stop());

describe("Social Crew migration foundation", () => {
  it("runs the actual prerequisite catalog on PostgreSQL 16", () => {
    const db = database!;
    expect(db.sql("select current_setting('server_version_num')::int / 10000")).toBe("16");
    expect(PREREQUISITES.map((path) => path.split("/").at(-1))).toEqual(expect.arrayContaining([
      "20260803200000_0065_rls_wave2_helpers.sql",
      "20260803201000_0066_rls_wave2_priority_policies.sql",
      "20260803202000_0067_rls_wave2_owner_policies.sql",
      "20260803203000_0068_rls_wave2_service_role_only.sql",
      "20260803204000_0069_rls_wave2_rpc_hardening.sql",
      "20260806035204_0070_v1_release_security.sql",
      "20260806145644_0070_rate_limit_expiry.sql",
      "20260806145754_0071_social_identity_assurance.sql",
      "20260806145914_0072_social_posts.sql",
      "20260806150000_0073_social_interactions.sql",
      "20260806151000_0074_social_composer.sql",
      "20260806160000_0076_plan_member_group_prefs.sql",
      "20260806162000_0077_pending_plan_recaps.sql",
    ]));
  });

  it("creates service-only RLS tables, bindings, constraints, and revoked RPCs", () => {
    const db = database!;
    expect(db.sql(`select string_agg(relname,',' order by relname) from pg_class
      where relnamespace='public'::regnamespace and relname in (
        'social_crews','social_crew_members','social_crew_invitations',
        'social_crew_join_requests','private_social_crew_write_receipts')`))
      .toBe("private_social_crew_write_receipts,social_crew_invitations,social_crew_join_requests,social_crew_members,social_crews");
    expect(db.sql("select social_owner_account_id is null from public.plans where id='" + PLAN + "'"))
      .toBe("t");
    expect(db.sql("select bool_and(relrowsecurity) from pg_class where relname like '%social_crew%' and relkind='r'"))
      .toBe("t");
    expect(db.sql("select has_table_privilege('authenticated','public.social_crews','select')"))
      .toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.social_crews','select')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.create_social_crew_atomic(uuid,uuid,text,text,text,text)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('authenticated','public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.update_legacy_plan_status_context_atomic(uuid,text,text,jsonb)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.accept_social_crew_invitation_atomic(uuid,uuid,uuid,text,text,text)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.accept_social_crew_invitation_atomic(uuid,uuid,uuid,text,text,text)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.revoke_social_crew_invitation_atomic(uuid,uuid,uuid,text,text)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.revoke_social_crew_invitation_atomic(uuid,uuid,uuid,text,text)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.decide_social_crew_join_request_atomic(uuid,uuid,uuid,text,text,text)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.read_social_crew_snapshot(uuid,uuid,uuid)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.read_social_crew_snapshot(uuid,uuid,uuid)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('authenticated','public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer)','execute')"))
      .toBe("t");
    expect(db.sql("select to_regprocedure('public.accept_social_crew_invitation_atomic(uuid,uuid,text,text,text)') is null"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('service_role','public._0075_join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)','execute')"))
      .toBe("f");
    expect(db.sql("select proconfig::text from pg_proc where oid='public.create_social_crew_atomic(uuid,uuid,text,text,text,text)'::regprocedure"))
      .toContain("search_path=");
    expect(db.sql(`select string_agg(l.lanname || '|' || p.provolatile::text || '|' || p.prosecdef::text || '|' ||
        (p.proconfig @> array['search_path=""'])::text, E'\\n' order by p.proname)
      from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid in (
        'public.read_social_crew_snapshot(uuid,uuid,uuid)'::regprocedure,
        'public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer)'::regprocedure
      )`)).toBe("sql|s|true|true\nsql|s|true|true");
    expect(db.sql(`select bool_and(
        prosrc ~ '^\\s*with\\s'
        and regexp_count(prosrc,';')=1
        and prosrc !~* '(to_jsonb|row_to_json)'
      ) from pg_proc where oid in (
        'public.read_social_crew_snapshot(uuid,uuid,uuid)'::regprocedure,
        'public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer)'::regprocedure
      )`)).toBe("t");
    expect(db.sql(`select position(
        'read_social_crew_snapshot' in pg_get_functiondef(
          'public.read_social_crew_member_page(uuid,uuid,timestamptz,uuid,integer)'::regprocedure
        )
      )`)).toBe("0");
  });

  it("replaces only private legacy Plan participant fence", () => {
    const db = database!;
    expect(db.sql(`select count(*) from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where p.proname='rls_is_plan_participant'`)).toBe("1");
    expect(db.sql(`select n.nspname || '|' ||
        (position('social_owner_account_id' in p.prosrc)>0)::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname='rls_is_plan_participant'`))
      .toBe("pubmax_private|true");
  });

  it("preserves PostgREST argument names on every fenced legacy RPC", () => {
    const db = database!;
    expect(db.sql(`with pairs(wrapper_name,backup_name) as (values
        ('join_plan_atomic','_0075_join_plan_atomic'),
        ('join_plan_idempotent_atomic','_0075_join_plan_idempotent_atomic'),
        ('redeem_plan_invite_atomic','_0075_redeem_plan_invite_atomic'),
        ('redeem_plan_invite_idempotent_atomic','_0075_redeem_plan_invite_idempotent_atomic'),
        ('upgrade_plan_member_invite_atomic','_0075_upgrade_plan_member_invite_atomic'),
        ('replace_plan_route_atomic','_0075_replace_plan_route_atomic'),
        ('add_plan_action_idempotent_atomic','_0075_add_plan_action_idempotent_atomic'),
        ('complete_plan_atomic','_0075_complete_plan_atomic_8'),
        ('complete_plan_atomic','_0075_complete_plan_atomic_9'),
        ('record_plan_vote_atomic','_0075_record_plan_vote_atomic'),
        ('record_plan_vibe_vote_atomic','_0075_record_plan_vibe_vote_atomic'),
        ('decide_plan_route_proposal_atomic','_0075_decide_plan_route_proposal_atomic'),
        ('create_plan_recap_atomic','_0075_create_plan_recap_atomic')
      )
      select count(*)
      from pairs
      join pg_proc backup on backup.proname=pairs.backup_name
      join pg_namespace backup_namespace on backup_namespace.oid=backup.pronamespace
        and backup_namespace.nspname='public'
      join pg_proc wrapper on wrapper.proname=pairs.wrapper_name
        and wrapper.proargtypes=backup.proargtypes
      join pg_namespace wrapper_namespace on wrapper_namespace.oid=wrapper.pronamespace
        and wrapper_namespace.nspname='public'
      where wrapper.proargnames is distinct from backup.proargnames`)).toBe("0");
  });

  it("resolves reciprocal follows and lets either-direction blocks override them", () => {
    const db = database!;
    expect(db.sql(`select public.social_relationship_between_profiles('${ALICE_PROFILE}','${BOB_PROFILE}')`)).toBe("mutual");
    expect(db.sql(`select public.social_relationship_between_profiles('${ALICE_PROFILE}','${CAROL_PROFILE}')`)).toBe("not_mutual");
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${BOB_PROFILE}','${ALICE_PROFILE}')`);
    expect(db.sql(`select public.social_relationship_between_profiles('${ALICE_PROFILE}','${BOB_PROFILE}')`)).toBe("blocked");
    db.sql(`delete from public.social_blocks where blocker_profile_id='${BOB_PROFILE}' and blocked_profile_id='${ALICE_PROFILE}'`);
  });

  it("preserves authenticated participant reads for an unbound Plan", () => {
    const db = database!;
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plans where id='${PLAN}'`)).toBe("1");
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plan_stops where plan_id='${PLAN}'`)).toBe("1");
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plan_crew_members where plan_id='${PLAN}'`)).toBe("2");
    expect(db.sql("select has_column_privilege('authenticated','public.plans','social_owner_account_id','select')")).toBe("f");
  });

  it("updates legacy Plan metadata atomically for the host token", () => {
    const db = database!;
    const plan = "42424242-4242-4242-8242-424242424242";
    const host = "43434343-4343-4343-8343-434343434343";
    const guest = "45454545-4545-4545-8545-454545454545";
    const hostToken = "4".repeat(64);
    const guestToken = "5".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values('${plan}','Metadata update',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
      values
        ('${host}','${plan}','Host','${hostToken}','in',now()-interval '1 minute',now(),true),
        ('${guest}','${plan}','Guest','${guestToken}','in',now(),now(),true)
    `);

    expect(db.sql(`select public.update_legacy_plan_status_context_atomic(
      '${plan}',null,'active',null
    )`)).toBe("forbidden");
    expect(db.sql(`select public.update_legacy_plan_status_context_atomic(
      '${plan}','${guestToken}','active','{"nightArea":"Camden"}'::jsonb
    )`)).toBe("forbidden");
    expect(db.sql(`select status || '|' || coalesce(night_context::text,'null') from public.plans where id='${plan}'`))
      .toBe("ready|null");
    expect(db.sql(`select public.update_legacy_plan_status_context_atomic(
      '${plan}','${hostToken}','active','{"nightArea":"Camden"}'::jsonb
    )`)).toBe("ok");
    expect(db.sql(`select status || '|' || (night_context->>'nightArea') from public.plans where id='${plan}'`))
      .toBe("active|Camden");
    expect(db.sql(`select public.update_legacy_plan_status_context_atomic(
      '${plan}','${hostToken}','draft',null
    )`)).toBe("invalid");
    expect(db.sql(`select status || '|' || (night_context->>'nightArea') from public.plans where id='${plan}'`))
      .toBe("active|Camden");
  });

  it("linearizes legacy metadata updates and Social Crew conversion in both Plan-lock schedules", async () => {
    const db = database!;
    const conversionFirstPlan = "46464646-4646-4646-8646-464646464646";
    const conversionFirstHost = "47474747-4747-4747-8747-474747474747";
    const metadataFirstPlan = "48484848-4848-4848-8848-484848484848";
    const metadataFirstHost = "49494949-4949-4949-8949-494949494949";
    const conversionFirstToken = "6".repeat(64);
    const metadataFirstToken = "7".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values
        ('${conversionFirstPlan}','Conversion first',now()+interval '1 day','ready'),
        ('${metadataFirstPlan}','Metadata first',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate) values
        ('${conversionFirstHost}','${conversionFirstPlan}','Host','${conversionFirstToken}','in',now(),now(),true),
        ('${metadataFirstHost}','${metadataFirstPlan}','Host','${metadataFirstToken}','in',now(),now(),true)
    `);

    const conversionFirst = await db.concurrentResults([
      `begin;
       set local deadlock_timeout='50ms'; set local statement_timeout='10s';
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${conversionFirstPlan}','${conversionFirstToken}','private','metadata-race-key-01','${DIGEST_A}');
       select pg_sleep(0.5); commit;`,
      `begin;
       set local deadlock_timeout='50ms'; set local statement_timeout='10s';
       select pg_sleep(0.2);
       select public.update_legacy_plan_status_context_atomic('${conversionFirstPlan}','${conversionFirstToken}','active','{"nightArea":"Soho"}'::jsonb);
       commit;`,
    ]);
    expect(conversionFirst[0]).toContain('"code": "created"');
    expect(conversionFirst[1]).toContain("not_found");
    expect(db.sql(`select status || '|' || coalesce(night_context::text,'null') from public.plans where id='${conversionFirstPlan}'`))
      .toBe("ready|null");

    const metadataFirst = await db.concurrentResults([
      `begin;
       set local deadlock_timeout='50ms'; set local statement_timeout='10s';
       select public.update_legacy_plan_status_context_atomic('${metadataFirstPlan}','${metadataFirstToken}','active','{"nightArea":"Soho"}'::jsonb);
       select pg_sleep(0.5); commit;`,
      `begin;
       set local deadlock_timeout='50ms'; set local statement_timeout='10s';
       select pg_sleep(0.2);
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${metadataFirstPlan}','${metadataFirstToken}','private','metadata-race-key-02','${DIGEST_A}');
       commit;`,
    ]);
    expect(metadataFirst[0]).toContain("ok");
    expect(metadataFirst[1]).toContain('"code": "created"');
    expect(db.sql(`select status || '|' || (night_context->>'nightArea') from public.plans where id='${metadataFirstPlan}'`))
      .toBe("active|Soho");
  });

  it("binds a host once, revokes legacy invites, rotates every capability, and replays exactly", () => {
    const db = database!;
    const created = json(db.sql(callCreate()));
    const replayed = json(db.sql(callCreate()));
    crewId = String(created.crew_id);

    expect(created).toMatchObject({ ok: true, code: "created" });
    expect(replayed).toEqual({ ...created, code: "replayed" });
    expect(db.sql(`select social_owner_account_id from public.plans where id='${PLAN}'`)).toBe(ALICE_ACCOUNT);
    expect(db.sql(`select count(*) from public.social_crew_members where crew_id='${crewId}' and state='active' and role='owner'`)).toBe("1");
    expect(db.sql(`select revoked_at is not null from public.plan_invites where id='${LEGACY_INVITE}'`)).toBe("t");
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${PLAN}' and token_hash in ('${HOST_TOKEN_HASH}','${LEGACY_GUEST_HASH}')`)).toBe("0");
    expect(db.sql("select count(*) from public.follows")).toBe("2");
    expect(json(db.sql(callCreate(DIGEST_B)))).toEqual({ ok: false, code: "idempotency_conflict" });
  });

  it("makes Crew-bound Plans absent to authenticated Plan RLS reads", () => {
    const db = database!;
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plans where id='${PLAN}'`)).toBe("0");
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plan_stops where plan_id='${PLAN}'`)).toBe("0");
    expect(authenticatedSql(db, ALICE_USER, `select count(id) from public.plan_crew_members where plan_id='${PLAN}'`)).toBe("0");
    expect(db.sql("select has_column_privilege('authenticated','public.plans','id','select')")).toBe("t");
    expect(db.sql("select has_column_privilege('authenticated','public.plans','social_owner_account_id','select')")).toBe("f");
  });

  it("binds nested invitation and Join Request mutations to the named parent Crew", () => {
    const db = database!;
    const acceptInvitation = "05050505-aaaa-4aaa-8aaa-050505050505";
    const declineInvitation = "06060606-aaaa-4aaa-8aaa-060606060606";
    const revokeInvitation = "07070707-aaaa-4aaa-8aaa-070707070707";
    const joinRequest = "08080808-aaaa-4aaa-8aaa-080808080808";
    db.sql(`
      insert into public.follows(follower_id,followee_id) values
        ('${ALICE_PROFILE}','${CAROL_PROFILE}'),('${CAROL_PROFILE}','${ALICE_PROFILE}')
        on conflict do nothing;
      insert into public.plans(id,title,start_time,status,social_owner_account_id)
        values('${OTHER_PLAN}','Other Crew',now()+interval '1 day','ready','${ALICE_ACCOUNT}');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,social_account_id
      ) values(
        '${OTHER_PLAN_MEMBER}','${OTHER_PLAN}','Alice','${"0123456789abcdef".repeat(4)}','in',now(),now(),true,'${ALICE_ACCOUNT}'
      );
      insert into public.social_crews(id,plan_id,owner_account_id,visibility)
        values('${OTHER_CREW}','${OTHER_PLAN}','${ALICE_ACCOUNT}','private');
      insert into public.social_crew_members(
        id,crew_id,social_account_id,plan_member_id,role,state
      ) values(
        '${OTHER_CREW_MEMBER}','${OTHER_CREW}','${ALICE_ACCOUNT}','${OTHER_PLAN_MEMBER}','owner','active'
      );
      insert into public.social_crew_invitations(
        id,crew_id,target_account_id,invited_by_member_id,expires_at
      ) values(
        '${acceptInvitation}','${OTHER_CREW}','${CAROL_ACCOUNT}','${OTHER_CREW_MEMBER}',now()+interval '1 day'
      );
    `);

    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${acceptInvitation}','accepted','parent-accept-bad1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(db.sql(`select state from public.social_crew_invitations where id='${acceptInvitation}'`))
      .toBe("pending");
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${OTHER_CREW}','${acceptInvitation}','accepted','parent-accept-good','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "accepted" });
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${acceptInvitation}','accepted','parent-accept-good','${DIGEST_B}'
    )`))).toEqual({ ok: false, code: "not_found" });

    db.sql(`insert into public.social_crew_invitations(
      id,crew_id,target_account_id,invited_by_member_id,expires_at
    ) values('${declineInvitation}','${OTHER_CREW}','${BOB_ACCOUNT}','${OTHER_CREW_MEMBER}',now()+interval '1 day')`);
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${BOB_ACCOUNT}','${crewId}','${declineInvitation}','declined','parent-decline-bad','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${BOB_ACCOUNT}','${OTHER_CREW}','${declineInvitation}','declined','parent-decline-ok1','${DIGEST_A}'
    )`))).toEqual({ ok: true, code: "declined" });

    db.sql(`insert into public.social_crew_invitations(
      id,crew_id,target_account_id,invited_by_member_id,expires_at
    ) values('${revokeInvitation}','${OTHER_CREW}','${BOB_ACCOUNT}','${OTHER_CREW_MEMBER}',now()+interval '1 day')`);
    expect(json(db.sql(`select public.revoke_social_crew_invitation_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${revokeInvitation}','parent-revoke-bad1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.revoke_social_crew_invitation_atomic(
      '${ALICE_ACCOUNT}','${OTHER_CREW}','${revokeInvitation}','parent-revoke-good','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "revoked" });

    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,expires_at
    ) values('${joinRequest}','${OTHER_CREW}','${BOB_ACCOUNT}',now()+interval '1 day')`);
    expect(json(db.sql(`select public.decide_social_crew_join_request_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${joinRequest}','declined','parent-join-bad01','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.decide_social_crew_join_request_atomic(
      '${ALICE_ACCOUNT}','${OTHER_CREW}','${joinRequest}','declined','parent-join-good1','${DIGEST_A}'
    )`))).toEqual({ ok: true, code: "declined" });
  });

  it("rejects every direct legacy collaboration table mutation after conversion", () => {
    const db = database!;
    const inserts = new Map<string, string>([
      ["plan_invites", `insert into public.plan_invites(id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at)
        values(gen_random_uuid(),'${PLAN}','${HOST_MEMBER}','${"9".repeat(64)}','blocked-invite',now(),now()+interval '1 hour')`],
      ["plan_constraints", `insert into public.plan_constraints(id,plan_id,member_id,kind,value,priority,idempotency_key,created_at)
        values(gen_random_uuid(),'${PLAN}','${HOST_MEMBER}','budget','Blocked','required','blocked-constraint',now())`],
      ["plan_route_proposals", `insert into public.plan_route_proposals(id,plan_id,proposed_by_member_id,expected_route_revision,stops,reason,resolved_constraint_ids,unresolved_constraint_ids,status,idempotency_key,created_at)
        values(gen_random_uuid(),'${PLAN}','${HOST_MEMBER}',1,'[]'::jsonb,'Blocked','[]'::jsonb,'[]'::jsonb,'pending','blocked-proposal',now())`],
      ["plan_votes", `insert into public.plan_votes(id,plan_id,proposal_id,member_id,value,idempotency_key,created_at)
        values(gen_random_uuid(),'${PLAN}','${LEGACY_PROPOSAL}','${HOST_MEMBER}','reject','blocked-vote',now())`],
      ["plan_vote_requests", `insert into public.plan_vote_requests(plan_id,member_id,idempotency_key,vote_id,value,created_at)
        values('${PLAN}','${HOST_MEMBER}','blocked-vote-request','${LEGACY_VOTE}','approve',now())`],
      ["plan_vibe_votes", `insert into public.plan_vibe_votes(id,plan_id,member_id,vibe,idempotency_key,created_at,updated_at)
        values(gen_random_uuid(),'${PLAN}','${LEGACY_GUEST}','quiet','blocked-vibe',now(),now())`],
      ["plan_vibe_vote_requests", `insert into public.plan_vibe_vote_requests(plan_id,member_id,idempotency_key,vibe,created_at)
        values('${PLAN}','${LEGACY_GUEST}','blocked-vibe-request','quiet',now())`],
    ]);

    for (const [table, insert] of inserts) {
      expect(() => db.sql(`begin; set local role service_role; ${insert}; commit`), `${table} INSERT`)
        .toThrow(/permission denied/);
      expect(() => db.sql(`begin; set local role service_role; update public.${table} set plan_id=plan_id where plan_id='${PLAN}'; commit`), `${table} UPDATE`)
        .toThrow(/permission denied/);
      expect(() => db.sql(`begin; set local role service_role; delete from public.${table} where plan_id='${PLAN}'; commit`), `${table} DELETE`)
        .toThrow(/permission denied/);
    }
  });

  it("linearizes conversion before a racing atomic legacy collaboration create", async () => {
    const db = database!;
    const plan = "85858585-8585-4585-8585-858585858585";
    const host = "86868686-8686-4686-8686-868686868686";
    const token = "8".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values('${plan}','Trigger race',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
        values('${host}','${plan}','Alice','${token}','in',now(),now(),true)
    `);

    const results = await db.concurrentResults([
      `begin;
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${plan}','${token}','private','trigger-race-key-01','${DIGEST_A}');
       select pg_sleep(0.5);
       commit;`,
      `begin;
       select pg_sleep(0.2);
       select public.create_plan_invite_atomic(
         '${plan}',gen_random_uuid(),'${host}','${"7".repeat(64)}','racing-invite',now(),now()+interval '1 hour'
       );
       commit;`,
    ]);

    expect(results[0]).toContain('"code": "created"');
    expect(results[1]).toContain('"code": "not_found"');
    expect(db.sql(`select count(*) from public.plan_invites where plan_id='${plan}'`)).toBe("0");
  });

  it("linearizes an atomic legacy revoke before conversion without an inverted lock order", async () => {
    const db = database!;
    const plan = "86868686-8686-4686-8686-868686868680";
    const host = "86868686-8686-4686-8686-868686868681";
    const invite = "86868686-8686-4686-8686-868686868682";
    const token = "3".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values('${plan}','RPC race',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
        values('${host}','${plan}','Alice','${token}','in',now(),now(),true);
      insert into public.plan_invites(id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at)
        values('${invite}','${plan}','${host}','${"2".repeat(64)}','rpc-race-invite',now(),now()+interval '1 hour')
    `);

    const results = await db.concurrentResults([
      `begin;
       set local deadlock_timeout='50ms';
       set local statement_timeout='10s';
       select public.revoke_plan_invite_atomic('${plan}','${invite}',now());
       select pg_sleep(0.5);
       commit;`,
      `begin;
       set local deadlock_timeout='50ms';
       set local statement_timeout='10s';
       select pg_sleep(0.2);
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${plan}','${token}','private','rpc-race-key-0001','${DIGEST_A}');
       commit;`,
    ]);

    expect(results[0]).toContain('"code": "revoked"');
    expect(results[1]).toContain('"code": "created"');
    expect(db.sql(`select revoked_at is not null from public.plan_invites where id='${invite}'`)).toBe("t");
  });

  it("denies a legacy invitation update before it can invert conversion lock order", async () => {
    const db = database!;
    const plan = "87878787-8787-4787-8787-878787878787";
    const host = "89898989-8989-4989-8989-898989898989";
    const invite = "90909090-9090-4090-8090-909090909090";
    const token = "6".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values('${plan}','Update race',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
        values('${host}','${plan}','Alice','${token}','in',now(),now(),true);
      insert into public.plan_invites(id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at)
        values('${invite}','${plan}','${host}','${"5".repeat(64)}','update-race-invite',now(),now()+interval '1 hour')
    `);

    const results = await db.concurrentResults([
      `begin;
       set local deadlock_timeout='50ms';
       set local statement_timeout='10s';
       set local role service_role;
       do $block$
       begin
         perform id from public.plan_invites where id='${invite}' for update;
         perform pg_sleep(0.5);
         update public.plan_invites set revoked_at=now() where id='${invite}';
         raise exception 'legacy collaboration direct update escaped';
       exception when insufficient_privilege then
         null;
       end
       $block$;
       reset role;
       select 'direct-denied';
       commit;`,
      `begin;
       set local deadlock_timeout='50ms';
       set local statement_timeout='10s';
       select pg_sleep(0.2);
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${plan}','${token}','private','update-race-key-01','${DIGEST_A}');
       commit;`,
    ]);

    expect(results[0]).toContain("direct-denied");
    expect(results[1]).toContain('"code": "created"');
    expect(db.sql(`select revoked_at is not null from public.plan_invites where id='${invite}'`)).toBe("t");
  });

  it("makes all old Plan mutation families absent after conversion", () => {
    const db = database!;
    const unboundPlan = "88888888-8888-4888-8888-888888888888";
    db.sql(`insert into public.plans(id,title,start_time,status) values('${unboundPlan}','Legacy night',now()+interval '1 day','ready')`);
    db.sql(`insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
      values(gen_random_uuid(),'${unboundPlan}','Host','${"7".repeat(64)}','in',now(),now(),true)`);
    const unboundHost = db.sql(`select id from public.plan_crew_members where plan_id='${unboundPlan}' order by joined_at,id limit 1`);
    const unboundInvite = "91919191-9191-4191-8191-919191919191";
    const consumedInvite = "92929292-9292-4292-8292-929292929292";
    const unboundConstraint = "93939393-9393-4393-8393-939393939393";
    const unboundProposal = "94949494-9494-4494-8494-949494949494";
    const unboundVote = "95959595-9595-4595-8595-959595959595";
    expect(json(db.sql(`select public.create_plan_invite_atomic(
      '${unboundPlan}','${unboundInvite}','${unboundHost}','invite-hash-one','invite-create-key',now(),now()+interval '1 hour'
    )`))).toMatchObject({ code: "created", row: { id: unboundInvite } });
    expect(json(db.sql(`select public.revoke_plan_invite_atomic('${unboundPlan}','${unboundInvite}',now())`)))
      .toMatchObject({ code: "revoked", row: { id: unboundInvite } });
    expect(json(db.sql(`select public.create_plan_invite_atomic(
      '${unboundPlan}','${consumedInvite}','${unboundHost}','invite-hash-two','invite-consume-key',now(),now()+interval '1 hour'
    )`))).toMatchObject({ code: "created", row: { id: consumedInvite } });
    expect(json(db.sql(`select public.consume_plan_invite_atomic('${unboundPlan}','invite-hash-two',now())`)))
      .toMatchObject({ code: "consumed", row: { id: consumedInvite } });
    expect(json(db.sql(`select public.add_plan_constraint_atomic(
      '${unboundPlan}','${unboundConstraint}','${unboundHost}','budget','Under twenty pounds','required','constraint-create-key',now()
    )`))).toMatchObject({ code: "created", row: { id: unboundConstraint } });
    expect(json(db.sql(`select public.create_plan_route_proposal_atomic(
      '${unboundPlan}','${unboundProposal}','${unboundHost}',1,'[]'::jsonb,'Keep it close','[]'::jsonb,
      '["${unboundConstraint}"]'::jsonb,'proposal-create-key',now()
    )`))).toMatchObject({ code: "created", row: { id: unboundProposal } });
    expect(json(db.sql(`select public.record_plan_vote_atomic(
      '${unboundPlan}','${unboundProposal}','${unboundHost}','approve','proposal-vote-key','${unboundVote}',now()
    )`))).toMatchObject({
      id: unboundVote,
      plan_id: unboundPlan,
      proposal_id: unboundProposal,
      member_id: unboundHost,
      value: "approve",
    });
    expect(json(db.sql(`select public.resolve_plan_constraint_atomic(
      '${unboundPlan}','${unboundConstraint}','${unboundHost}',
      '{"proposalId":"${unboundProposal}","routeRevision":1,"sources":[]}'::jsonb,'constraint-resolve-key',now()
    )`))).toMatchObject({ code: "resolved", row: { id: unboundConstraint } });
    expect(db.sql(`select public.decide_plan_route_proposal_atomic(
      '${unboundPlan}','${unboundProposal}','${"7".repeat(64)}','rejected','proposal-decision-key',now()
    )`)).toBe("decided");
    expect(db.sql(`select public.join_plan_idempotent_atomic('${unboundPlan}',gen_random_uuid(),'Guest','${"8".repeat(64)}',now(),false,'${"9".repeat(64)}','${"0".repeat(64)}')`)).toBe("joined");
    expect(json(db.sql(`select public.create_plan_invite_atomic(
      '${PLAN}',gen_random_uuid(),'${HOST_MEMBER}','blocked-hash','blocked-create-key',now(),now()+interval '1 hour'
    )`))).toEqual({ code: "not_found" });
    expect(json(db.sql(`select public.revoke_plan_invite_atomic('${PLAN}','${LEGACY_INVITE}',now())`))).toEqual({ code: "not_found" });
    expect(json(db.sql(`select public.consume_plan_invite_atomic('${PLAN}','${LEGACY_INVITE_HASH}',now())`))).toEqual({ code: "not_found" });
    expect(json(db.sql(`select public.add_plan_constraint_atomic(
      '${PLAN}',gen_random_uuid(),'${HOST_MEMBER}','budget','Blocked','required','blocked-constraint-key',now()
    )`))).toEqual({ code: "not_found" });
    expect(json(db.sql(`select public.resolve_plan_constraint_atomic(
      '${PLAN}','${LEGACY_CONSTRAINT}','${HOST_MEMBER}','{}'::jsonb,'blocked-resolve-key',now()
    )`))).toEqual({ code: "not_found" });
    expect(json(db.sql(`select public.create_plan_route_proposal_atomic(
      '${PLAN}',gen_random_uuid(),'${HOST_MEMBER}',1,'[]'::jsonb,'Blocked','[]'::jsonb,'[]'::jsonb,'blocked-proposal-key',now()
    )`))).toEqual({ code: "not_found" });
    expect(db.sql(`select public.join_plan_atomic('${PLAN}',gen_random_uuid(),'Mallory','${"4".repeat(64)}',now(),false)`)).toBe("f");
    expect(db.sql(`select public.join_plan_idempotent_atomic('${PLAN}',gen_random_uuid(),'Mallory','${"4".repeat(64)}',now(),false,'${"5".repeat(64)}','${"6".repeat(64)}')`)).toBe("not_found");
    expect(db.sql(`select public.redeem_plan_invite_atomic('${PLAN}','${LEGACY_INVITE_HASH}',gen_random_uuid(),'Mallory','${"4".repeat(64)}',now())`)).toBe("not_found");
    expect(db.sql(`select public.redeem_plan_invite_idempotent_atomic('${PLAN}','${LEGACY_INVITE_HASH}',gen_random_uuid(),'Mallory','${"4".repeat(64)}',now(),'${"5".repeat(64)}','${"6".repeat(64)}')`)).toBe("not_found");
    expect(db.sql(`select public.upgrade_plan_member_invite_atomic('${PLAN}','${LEGACY_INVITE_HASH}','${HOST_TOKEN_HASH}',now())`)).toBe("not_found");
    expect(db.sql(`select public.replace_plan_route_atomic('${PLAN}','${HOST_TOKEN_HASH}',1,'[]'::jsonb,null,false)`)).toBe("not_found");
    expect(db.sql(`select public.update_legacy_plan_status_context_atomic('${PLAN}','${HOST_TOKEN_HASH}','active',null)`)).toBe("not_found");
    expect(db.sql(`select public.add_plan_action_idempotent_atomic('${PLAN}','${HOST_TOKEN_HASH}',gen_random_uuid(),'arrived',0,'${"5".repeat(64)}','${"6".repeat(64)}',now())`)).toBe("not_found");
    expect(db.sql(`select public.complete_plan_atomic('${PLAN}','${HOST_TOKEN_HASH}',1,gen_random_uuid(),gen_random_uuid(),'get_home',null,now())`)).toBe("not_found");
    expect(db.sql(`select public.complete_plan_atomic('${PLAN}','${HOST_TOKEN_HASH}',1,gen_random_uuid(),gen_random_uuid(),'get_home',null,'{"kind":"get_home","optionId":"tube","evidenceSnapshot":{}}'::jsonb,now())`)).toBe("not_found");
    expect(db.sql(`select public.record_plan_vote_atomic('${PLAN}',gen_random_uuid(),'${HOST_MEMBER}','approve','vote-key',gen_random_uuid(),now())`)).toBe('{"code": "not_found"}');
    expect(db.sql(`select public.record_plan_vibe_vote_atomic('${PLAN}','${HOST_MEMBER}','quiet','vibe-key',gen_random_uuid(),now())`)).toBe('{"code": "not_found"}');
    expect(db.sql(`select public.decide_plan_route_proposal_atomic('${PLAN}',gen_random_uuid(),'${HOST_TOKEN_HASH}','rejected','decision-key',now())`)).toBe("not_found");
    const completion = "18181818-1818-4181-8181-181818181818";
    db.sql(`insert into public.plan_completions(id,plan_id,ending,actor_member_id,route_revision,route_snapshot,completed_at)
      values('${completion}','${PLAN}','get_home','${HOST_MEMBER}',1,'[{"venueId":"venue-one","venueName":"Venue One","position":0}]'::jsonb,now())`);
    expect(db.sql(`select public.create_plan_recap_atomic(
      '${ALICE_USER}','${completion}','Bound recap',(select completed_at from public.plan_completions where id='${completion}'),
      '[{"venueId":"venue-one","caption":"Done","position":0}]'::jsonb
    )`)).toBe("");
  });

  it("lets an owner revoke a pending targeted invitation", () => {
    const db = database!;
    db.sql(`insert into public.follows(follower_id,followee_id) values
      ('${ALICE_PROFILE}','${CAROL_PROFILE}'),('${CAROL_PROFILE}','${ALICE_PROFILE}')
      on conflict do nothing`);
    const invited = json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${CAROL_PROFILE}','invite-carol-key-01','${DIGEST_A}'
    )`));
    const invitation = String(invited.invitation_id);

    expect(json(db.sql(`select public.revoke_social_crew_invitation_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${invitation}','revoke-carol-key-1','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "revoked" });
    expect(db.sql(`select state from public.social_crew_invitations where id='${invitation}'`)).toBe("revoked");
  });

  it("expires stale targeted rows before issuing a later invitation", () => {
    const db = database!;
    const inviter = db.sql(`select id from public.social_crew_members where crew_id='${crewId}' and role='owner'`);
    const stale = "15151515-1515-4151-8151-151515151515";
    db.sql(`insert into public.social_crew_invitations(
      id,crew_id,target_account_id,invited_by_member_id,state,created_at,expires_at
    ) values('${stale}','${crewId}','${CAROL_ACCOUNT}','${inviter}','pending',now()-interval '8 days',now()-interval '1 day')`);

    const invited = json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${CAROL_PROFILE}','invite-carol-key-02','${DIGEST_A}'
    )`));
    carolInvitationId = String(invited.invitation_id);
    expect(invited).toMatchObject({ ok: true, code: "invited" });
    expect(db.sql(`select state from public.social_crew_invitations where id='${stale}'`)).toBe("expired");
    expect(json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${CAROL_PROFILE}','invite-carol-key-03','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "already_pending" });
    expect(db.sql(`select count(*) from public.social_crew_invitations
      where crew_id='${crewId}' and target_account_id='${CAROL_ACCOUNT}' and state='pending'`)).toBe("1");
  });

  it("replays the original denial and binds changed payload conflicts", () => {
    const db = database!;
    const missing = "16161616-1616-4161-8161-161616161616";
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${missing}','accepted','denied-replay-key-1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${missing}','accepted','denied-replay-key-1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${missing}','accepted','denied-replay-key-1','${DIGEST_B}'
    )`))).toEqual({ ok: false, code: "idempotency_conflict" });
  });

  it("serializes double invitation acceptance into one retained membership", async () => {
    const db = database!;
    const revisionBefore = Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`));
    const invited = json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${BOB_PROFILE}','invite-bob-key-0001','${DIGEST_A}'
    )`));
    invitationId = String(invited.invitation_id);
    const start = new Date(Date.now() + 2_000).toISOString();
    const transaction = (key: string) => `begin; set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      select public.accept_social_crew_invitation_atomic('${BOB_ACCOUNT}','${crewId}','${invitationId}','accepted','${key}','${DIGEST_A}'); commit;`;
    const results = await db.concurrentResults([
      transaction("accept-bob-key-0001"),
      transaction("accept-bob-key-0002"),
    ]);

    expect(results.join("\n").match(/"code": "accepted"/g)).toHaveLength(1);
    expect(db.sql(`select count(*) from public.social_crew_members where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`)).toBe("1");
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${PLAN}' and social_account_id='${BOB_ACCOUNT}'`)).toBe("1");
    expect(db.sql("select count(*) from public.follows")).toBe("4");
    expect(Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`)))
      .toBe(revisionBefore + 1);
  });

  it("does not let an active member create a Join Request", () => {
    const db = database!;
    expect(json(db.sql(`select public.request_social_crew_join_atomic(
      '${BOB_ACCOUNT}','${crewId}','pending','active-request-key1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "already_member" });
    expect(db.sql(`select count(*) from public.social_crew_join_requests
      where crew_id='${crewId}' and requester_account_id='${BOB_ACCOUNT}'`)).toBe("0");
  });

  it("enforces the 20-active-member capacity on activation", () => {
    const db = database!;
    db.sql(`
      with ids as (select n,md5('user-'||n)::uuid user_id,md5('profile-'||n)::uuid profile_id,
        md5('account-'||n)::uuid account_id,md5('plan-member-'||n)::uuid plan_member_id,
        md5('crew-member-'||n)::uuid crew_member_id from generate_series(1,18) n)
      insert into auth.users(id) select user_id from ids;
      with ids as (select n,md5('user-'||n)::uuid user_id,md5('profile-'||n)::uuid profile_id from generate_series(1,18) n)
      insert into public.profiles(id,user_id,handle) select profile_id,user_id,'capacity_'||n from ids;
      with ids as (select n,md5('user-'||n)::uuid user_id,md5('profile-'||n)::uuid profile_id,md5('account-'||n)::uuid account_id from generate_series(1,18) n)
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
        select account_id,'capacity-'||n,user_id,profile_id from ids;
      with ids as (select n,md5('account-'||n)::uuid account_id,md5('plan-member-'||n)::uuid plan_member_id from generate_series(1,18) n)
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,social_account_id)
        select plan_member_id,'${PLAN}','Capacity '||n,md5('cap-'||n)||md5('cap2-'||n),'in',now(),now(),true,account_id from ids;
      with ids as (select n,md5('account-'||n)::uuid account_id,md5('plan-member-'||n)::uuid plan_member_id,md5('crew-member-'||n)::uuid crew_member_id from generate_series(1,18) n)
      insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state)
        select crew_member_id,'${crewId}',account_id,plan_member_id,'member','active' from ids;
    `);
    expect(db.sql(`select count(*) from public.social_crew_members where crew_id='${crewId}' and state='active'`)).toBe("20");
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${carolInvitationId}','accepted','accept-carol-full-1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "full" });
    db.sql(`delete from public.social_crew_members where crew_id='${crewId}' and social_account_id in (
      select md5('account-'||n)::uuid from generate_series(1,18) n
    )`);
  });

  it("increments authority once when a racing Join Request acceptance activates a member", async () => {
    const db = database!;
    db.sql(`
      insert into auth.users(id) values('${DAVE_USER}');
      insert into public.profiles(id,user_id,handle) values('${DAVE_PROFILE}','${DAVE_USER}','dave');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
        values('${DAVE_ACCOUNT}','clerk-dave','${DAVE_USER}','${DAVE_PROFILE}');
      insert into public.follows(follower_id,followee_id) values
        ('${ALICE_PROFILE}','${DAVE_PROFILE}'),('${DAVE_PROFILE}','${ALICE_PROFILE}')
    `);
    const requested = json(db.sql(`select public.request_social_crew_join_atomic(
      '${DAVE_ACCOUNT}','${crewId}','pending','request-dave-key-01','${DIGEST_A}'
    )`));
    const requestId = String(requested.request_id);
    const revisionBefore = Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`));
    const start = new Date(Date.now() + 2_000).toISOString();
    const transaction = (key: string) => `begin; set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      select public.decide_social_crew_join_request_atomic('${ALICE_ACCOUNT}','${crewId}','${requestId}','accepted','${key}','${DIGEST_A}'); commit;`;
    const results = await db.concurrentResults([
      transaction("accept-dave-key-001"),
      transaction("accept-dave-key-002"),
    ]);

    expect(results.join("\n").match(/"code": "accepted"/g)).toHaveLength(1);
    expect(db.sql(`select count(*) from public.social_crew_members
      where crew_id='${crewId}' and social_account_id='${DAVE_ACCOUNT}' and state='active'`)).toBe("1");
    expect(Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`)))
      .toBe(revisionBefore + 1);
    expect(json(db.sql(`select public.decide_social_crew_join_request_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${requestId}','accepted','accept-dave-again-1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "already_decided" });
    expect(Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`)))
      .toBe(revisionBefore + 1);
  });

  it("serializes Join Request cancellation and decision without losing provenance", async () => {
    const db = database!;
    const stale = "17171717-1717-4171-8171-171717171717";
    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,state,created_at,expires_at
    ) values('${stale}','${crewId}','${CAROL_ACCOUNT}','pending',now()-interval '8 days',now()-interval '1 day')`);
    const requested = json(db.sql(`select public.request_social_crew_join_atomic(
      '${CAROL_ACCOUNT}','${crewId}','pending','request-carol-key-1','${DIGEST_A}'
    )`));
    const requestId = String(requested.request_id);
    expect(db.sql(`select state from public.social_crew_join_requests where id='${stale}'`)).toBe("expired");
    expect(json(db.sql(`select public.request_social_crew_join_atomic(
      '${CAROL_ACCOUNT}','${crewId}','pending','request-carol-key-2','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "already_pending" });
    expect(db.sql(`select count(*) from public.social_crew_join_requests
      where crew_id='${crewId}' and requester_account_id='${CAROL_ACCOUNT}' and state='pending'`)).toBe("1");
    const start = new Date(Date.now() + 2_000).toISOString();
    const synchronized = (statement: string) => `begin; set local deadlock_timeout='50ms'; set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      ${statement}; commit;`;
    await expect(db.concurrentResults([
      synchronized(`select public.request_social_crew_join_atomic('${CAROL_ACCOUNT}','${crewId}','cancelled','cancel-carol-key-1','${DIGEST_A}')`),
      synchronized(`select public.decide_social_crew_join_request_atomic('${ALICE_ACCOUNT}','${crewId}','${requestId}','declined','decline-carol-key1','${DIGEST_A}')`),
    ])).resolves.toHaveLength(2);
    expect(db.sql(`select state from public.social_crew_join_requests where id='${requestId}'`))
      .toMatch(/cancelled|declined/);
    expect(db.sql(`select count(*) from public.social_crew_join_requests where id='${requestId}'`)).toBe("1");
  });

  it("races reactivation paths once and reuses the retained Plan member", async () => {
    const db = database!;
    const before = db.sql(`select plan_member_id from public.social_crew_members where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`);
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${ALICE_PROFILE}','${BOB_PROFILE}')`);
    expect(json(db.sql(`select public.leave_social_crew_atomic(
      '${BOB_ACCOUNT}','${crewId}','blocked-leave-key1','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "left" });
    const revisionAfterLeave = Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`));
    db.sql(`delete from public.social_blocks where blocker_profile_id='${ALICE_PROFILE}' and blocked_profile_id='${BOB_PROFILE}'`);
    const invited = json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${BOB_PROFILE}','reinvite-bob-key01','${DIGEST_A}'
    )`));
    const requested = json(db.sql(`select public.request_social_crew_join_atomic(
      '${BOB_ACCOUNT}','${crewId}','pending','reactivate-request1','${DIGEST_A}'
    )`));
    const start = new Date(Date.now() + 2_000).toISOString();
    const synchronized = (statement: string) => `begin; set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      ${statement}; commit;`;
    const results = await db.concurrentResults([
      synchronized(`select public.accept_social_crew_invitation_atomic(
        '${BOB_ACCOUNT}','${crewId}','${String(invited.invitation_id)}','accepted','reactivate-bob-key1','${DIGEST_A}')`),
      synchronized(`select public.decide_social_crew_join_request_atomic(
        '${ALICE_ACCOUNT}','${crewId}','${String(requested.request_id)}','accepted','reactivate-decision1','${DIGEST_A}')`),
    ]);
    expect(results.join("\n").match(/"code": "accepted"/g)).toHaveLength(2);
    expect(Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`)))
      .toBe(revisionAfterLeave + 1);
    expect(json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${BOB_ACCOUNT}','${crewId}','${String(invited.invitation_id)}','accepted','reactivate-bob-key1','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "replayed" });
    expect(Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`)))
      .toBe(revisionAfterLeave + 1);
    expect(db.sql(`select count(*) from public.social_crew_members
      where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`)).toBe("1");
    expect(db.sql(`select count(*) from public.plan_crew_members
      where plan_id='${PLAN}' and social_account_id='${BOB_ACCOUNT}'`)).toBe("1");
    expect(db.sql(`select plan_member_id from public.social_crew_members where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`)).toBe(before);
  });

  it("returns exact owner and Mutual-member snapshots from one allowlisted shape", () => {
    const db = database!;
    seedReadFixture(db);
    expect(readSnapshot(db, ALICE_ACCOUNT, ALICE_PROFILE)).toEqual(
      expectedReadMemberSnapshot({ ownerRelationship: "self" }),
    );
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toEqual(
      expectedReadMemberSnapshot({ ownerRelationship: "mutual" }),
    );
  });

  it("returns the exact friends preview and omits every protected field", () => {
    const db = database!;
    seedReadFixture(db);
    const expected = {
      kind: "preview",
      preview: {
        title: "Projected night",
        status: "ending",
        nightArea: "camden",
        startsAt: "2026-08-10T19:00:00.654321Z",
        joinRequestState: "none",
      },
    };
    const preview = readSnapshot(db, CAROL_ACCOUNT, CAROL_PROFILE);
    expect(preview).toEqual(expected);
    expect(JSON.stringify(preview)).not.toMatch(/crewId|planId|authorityRevision|members|stops|actions|ownerAccountId|profileId/);
  });

  it("denies private, stranger, blocked, stale-member, suspended, mismatched, and absent dependencies", () => {
    const db = database!;
    seedReadFixture(db);
    expect(readSnapshot(db, EVE_ACCOUNT, EVE_PROFILE)).toBeNull();
    expect(readSnapshot(db, ALICE_ACCOUNT, BOB_PROFILE)).toBeNull();
    expect(readSnapshot(db, ALICE_ACCOUNT, ALICE_PROFILE, "90909090-bbbb-4bbb-8bbb-909090909090")).toBeNull();

    db.sql(`update public.social_crews set visibility='private' where id='${READ_CREW}'`);
    expect(readSnapshot(db, CAROL_ACCOUNT, CAROL_PROFILE)).toBeNull();
    db.sql(`update public.social_crews set visibility='friends' where id='${READ_CREW}'`);

    for (const [blocker, blocked] of [[CAROL_PROFILE, ALICE_PROFILE], [ALICE_PROFILE, CAROL_PROFILE]]) {
      db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id) values('${blocker}','${blocked}')`);
      expect(readSnapshot(db, CAROL_ACCOUNT, CAROL_PROFILE)).toBeNull();
      db.sql(`delete from public.social_blocks where blocker_profile_id='${blocker}' and blocked_profile_id='${blocked}'`);
    }

    db.sql(`delete from public.follows where follower_id='${BOB_PROFILE}' and followee_id='${ALICE_PROFILE}'`);
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toBeNull();
    db.sql(`insert into public.follows(follower_id,followee_id) values('${BOB_PROFILE}','${ALICE_PROFILE}')`);

    db.sql(`update public.social_crew_members set state='removed',ended_at=now() where id='${READ_MEMBER}'`);
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toBeNull();
    db.sql(`update public.social_crew_members set state='active',ended_at=null where id='${READ_MEMBER}'`);

    db.sql(`update public.social_crew_members set plan_member_id='${READ_ROGUE_PLAN_MEMBER}'
      where id='${READ_MEMBER}'`);
    try {
      expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toBeNull();
    } finally {
      db.sql(`update public.social_crew_members set plan_member_id='${READ_MEMBER_PLAN_MEMBER}'
        where id='${READ_MEMBER}'`);
    }

    db.sql(`update public.private_social_accounts set ownership_state='suspended' where id='${BOB_ACCOUNT}'`);
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toBeNull();
    db.sql(`update public.private_social_accounts set ownership_state='active' where id='${BOB_ACCOUNT}'`);

    db.sql(`update public.plans set social_owner_account_id=null where id='${READ_PLAN}'`);
    expect(readSnapshot(db, ALICE_ACCOUNT, ALICE_PROFILE)).toBeNull();
    db.sql(`update public.plans set social_owner_account_id='${ALICE_ACCOUNT}' where id='${READ_PLAN}'`);
  });

  it("projects only the latest current Join Request in deterministic order", () => {
    const db = database!;
    seedReadFixture(db);
    const state = () => (readSnapshot(db, CAROL_ACCOUNT, CAROL_PROFILE) as {
      preview: { joinRequestState: string };
    }).preview.joinRequestState;
    const clear = () => db.sql(`delete from public.social_crew_join_requests
      where crew_id='${READ_CREW}' and requester_account_id='${CAROL_ACCOUNT}'`);

    clear();
    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,state,created_at,expires_at,decided_at
    ) values
      ('11111111-bbbb-4bbb-8bbb-111111111111','${READ_CREW}','${CAROL_ACCOUNT}','accepted',
        '2026-08-06 09:00:00+00','2026-08-07 09:00:00+00','2026-08-06 09:01:00+00'),
      ('99999999-bbbb-4bbb-8bbb-999999999999','${READ_CREW}','${CAROL_ACCOUNT}','declined',
        '2026-08-06 09:00:00+00','2026-08-07 09:00:00+00','2026-08-06 09:02:00+00')`);
    expect(state()).toBe("declined");

    clear();
    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,state,created_at,expires_at
    ) values('22222222-bbbb-4bbb-8bbb-222222222222','${READ_CREW}','${CAROL_ACCOUNT}','pending',
      statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 day')`);
    expect(state()).toBe("pending");

    clear();
    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,state,created_at,expires_at
    ) values('33333333-bbbb-4bbb-8bbb-333333333333','${READ_CREW}','${CAROL_ACCOUNT}','pending',
      statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day')`);
    expect(state()).toBe("none");

    for (const requestState of ["accepted", "cancelled", "expired"] as const) {
      clear();
      db.sql(`insert into public.social_crew_join_requests(
        id,crew_id,requester_account_id,state,created_at,expires_at,decided_at
      ) values(gen_random_uuid(),'${READ_CREW}','${CAROL_ACCOUNT}','${requestState}',
        statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 day',statement_timestamp())`);
      expect(state()).toBe("none");
    }

    clear();
    db.sql(`insert into public.social_crew_join_requests(
      id,crew_id,requester_account_id,state,created_at,expires_at,decided_at
    ) values
      ('44444444-bbbb-4bbb-8bbb-444444444444','${READ_CREW}','${CAROL_ACCOUNT}','pending',
        statement_timestamp()-interval '2 minutes',statement_timestamp()+interval '1 day',null),
      ('55555555-bbbb-4bbb-8bbb-555555555555','${READ_CREW}','${CAROL_ACCOUNT}','declined',
        statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 day',statement_timestamp())`);
    expect(state()).toBe("declined");
    clear();
  });

  it("linearises block, friendship, transfer, removal, and suspension races", async () => {
    const db = database!;
    const expectedBefore = expectedReadMemberSnapshot({ ownerRelationship: "mutual" });
    const deniedAfterCommit = async (mutation: string) => {
      seedReadFixture(db);
      expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toEqual(expectedBefore);
      expect(await db.snapshotDuringWrite(
        mutation,
        snapshotExpression(BOB_ACCOUNT, BOB_PROFILE),
      )).toEqual(expectedBefore);
      expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toBeNull();
    };

    await deniedAfterCommit(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
      values('${ALICE_PROFILE}','${BOB_PROFILE}')`);

    await deniedAfterCommit(`delete from public.follows
      where follower_id='${BOB_PROFILE}' and followee_id='${ALICE_PROFILE}'`);

    seedReadFixture(db);
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toEqual(expectedBefore);
    expect(await db.snapshotDuringWrite(
      `select public.transfer_social_crew_owner_atomic(
        '${ALICE_ACCOUNT}','${READ_CREW}','${READ_MEMBER}','race-transfer-key-01','${DIGEST_A}'
      )`,
      snapshotExpression(BOB_ACCOUNT, BOB_PROFILE),
    )).toEqual(expectedBefore);
    expect(readSnapshot(db, BOB_ACCOUNT, BOB_PROFILE)).toEqual(expectedReadMemberSnapshot({
      ownerRelationship: "self",
      ownerAccountId: BOB_ACCOUNT,
      ownerProfileId: BOB_PROFILE,
      authorityRevision: 10,
      aliceRole: "cohost",
      bobRole: "owner",
    }));

    await deniedAfterCommit(`select public.remove_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${READ_CREW}','${READ_MEMBER}','race-removal-key-001','${DIGEST_A}'
    )`);

    await deniedAfterCommit(`update public.private_social_accounts
      set ownership_state='suspended',ownership_changed_at=statement_timestamp() where id='${BOB_ACCOUNT}'`);
  });

  it("continues from the exact member position after cursor-row deletion and excludes a newer insert", () => {
    const db = database!;
    beginMemberPageFixture(db);
    const fixtures = [
      insertMemberPageCrew(db, {
        scope: 1,
        ordinal: 1,
        owner: "eve",
        joinedAt: "2031-08-05 15:00:00.000015+00",
        title: "First page newest",
      }),
      insertMemberPageCrew(db, {
        scope: 1,
        ordinal: 2,
        owner: "eve",
        joinedAt: "2031-08-05 14:00:00.000014+00",
        title: "First page cursor",
      }),
      insertMemberPageCrew(db, {
        scope: 1,
        ordinal: 3,
        owner: "eve",
        joinedAt: "2031-08-05 13:00:00.000013+00",
        title: "Second page first",
      }),
      insertMemberPageCrew(db, {
        scope: 1,
        ordinal: 4,
        owner: "eve",
        joinedAt: "2031-08-05 12:00:00.000012+00",
        title: "Second page last",
      }),
    ];
    try {
      const first = readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 2) as MemberPageResult;
      expect(first.items.map(({ crewId }) => crewId)).toEqual([
        fixtures[0]!.crewId,
        fixtures[1]!.crewId,
      ]);
      expect(first).toMatchObject({
        hasMore: true,
        cursorPosition: {
          joinedAt: "2031-08-05T14:00:00.000014Z",
          memberId: fixtures[1]!.viewerMemberId,
        },
      });
      const cursor = first.cursorPosition!;

      db.sql(`delete from public.social_crew_members where id='${cursor.memberId}'`);
      const newer = insertMemberPageCrew(db, {
        scope: 1,
        ordinal: 5,
        owner: "eve",
        joinedAt: "2031-08-05 16:00:00.000016+00",
        title: "Inserted after page one",
      });
      fixtures.push(newer);

      const second = readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 2, cursor) as MemberPageResult;
      expect(second.items.map(({ crewId }) => crewId)).toEqual([
        fixtures[2]!.crewId,
        fixtures[3]!.crewId,
      ]);
      expect(second).toMatchObject({ hasMore: false, cursorPosition: null });
      expect([...first.items, ...second.items].map(({ crewId }) => crewId)).toEqual([
        fixtures[0]!.crewId,
        fixtures[1]!.crewId,
        fixtures[2]!.crewId,
        fixtures[3]!.crewId,
      ]);
      expect(second.items.map(({ crewId }) => crewId)).not.toContain(newer.crewId);
    } finally {
      cleanMemberPageFixture(db, fixtures);
    }
  });

  it.each([
    {
      label: "a block",
      scope: 2,
      mutate: (db: Database) => db.sql(`
        insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
          values('${ALICE_PROFILE}','${EVE_PROFILE}')
      `),
    },
    {
      label: "an unfriend",
      scope: 3,
      mutate: (db: Database) => db.sql(`
        delete from public.follows
          where follower_id='${EVE_PROFILE}' and followee_id='${ALICE_PROFILE}'
      `),
    },
    {
      label: "active membership removal",
      scope: 4,
      mutate: (db: Database, target: MemberPageCrewFixture) => db.sql(`
        update public.social_crew_members
          set state='removed',ended_at=statement_timestamp(),updated_at=statement_timestamp()
          where id='${target.viewerMemberId}'
      `),
    },
  ])("filters current authority before page limit after $label", ({ scope, mutate }) => {
    const db = database!;
    beginMemberPageFixture(db);
    const fixtures = [
      insertMemberPageCrew(db, {
        scope,
        ordinal: 1,
        owner: "eve",
        joinedAt: "2031-08-05 15:00:00.000015+00",
        title: "Cursor crew",
      }),
      insertMemberPageCrew(db, {
        scope,
        ordinal: 2,
        owner: "alice",
        joinedAt: "2031-08-05 14:00:00.000014+00",
        title: "Authority revoked crew",
      }),
      insertMemberPageCrew(db, {
        scope,
        ordinal: 3,
        owner: "eve",
        joinedAt: "2031-08-05 13:00:00.000013+00",
        title: "Authorised fallback",
      }),
      insertMemberPageCrew(db, {
        scope,
        ordinal: 4,
        owner: "eve",
        joinedAt: "2031-08-05 12:00:00.000012+00",
        title: "Trailing authorised crew",
      }),
    ];
    try {
      const first = readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 1) as MemberPageResult;
      expect(first.items.map(({ crewId }) => crewId)).toEqual([fixtures[0]!.crewId]);
      expect(first.cursorPosition).toEqual({
        joinedAt: "2031-08-05T15:00:00.000015Z",
        memberId: fixtures[0]!.viewerMemberId,
      });

      mutate(db, fixtures[1]!);

      const second = readMemberPage(
        db,
        EVE_ACCOUNT,
        EVE_PROFILE,
        1,
        first.cursorPosition!,
      ) as MemberPageResult;
      expect(second.items.map(({ crewId }) => crewId)).toEqual([fixtures[2]!.crewId]);
      expect(second.items.map(({ crewId }) => crewId)).not.toContain(fixtures[1]!.crewId);
      expect(second).toMatchObject({
        hasMore: true,
        cursorPosition: {
          joinedAt: "2031-08-05T13:00:00.000013Z",
          memberId: fixtures[2]!.viewerMemberId,
        },
      });
    } finally {
      cleanMemberPageFixture(db, fixtures);
    }
  });

  it("filters member-page authority before keyset cursor and limit plus one", () => {
    const db = database!;
    seedMemberPageIdentities(db);
    const selfPlan = "11112222-0000-4000-8000-000000000001";
    const selfCrew = "11112222-0000-4000-8000-000000000002";
    const selfPlanMember = "11112222-0000-4000-8000-000000000003";
    const selfMember = "11112222-0000-4000-8000-000000000004";
    const carolPlan = "22223333-0000-4000-8000-000000000001";
    const carolCrew = "22223333-0000-4000-8000-000000000002";
    const carolOwnerPlanMember = "22223333-0000-4000-8000-000000000003";
    const carolViewerPlanMember = "22223333-0000-4000-8000-000000000004";
    const carolOwnerMember = "22223333-0000-4000-8000-000000000005";
    const carolViewerMember = "22223333-0000-4000-8000-000000000006";
    const davePlan = "33334444-0000-4000-8000-000000000001";
    const daveCrew = "33334444-0000-4000-8000-000000000002";
    const daveOwnerPlanMember = "33334444-0000-4000-8000-000000000003";
    const daveViewerPlanMember = "33334444-0000-4000-8000-000000000004";
    const daveOwnerMember = "33334444-0000-4000-8000-000000000005";
    const daveViewerMember = "33334444-0000-4000-8000-000000000006";
    const alicePlan = "44445555-0000-4000-8000-000000000001";
    const aliceCrew = "44445555-0000-4000-8000-000000000002";
    const aliceOwnerPlanMember = "44445555-0000-4000-8000-000000000003";
    const aliceViewerPlanMember = "44445555-0000-4000-8000-000000000004";
    const aliceOwnerMember = "44445555-0000-4000-8000-000000000005";
    const aliceViewerMember = "44445555-0000-4000-8000-000000000006";

    db.sql(`
      insert into public.follows(follower_id,followee_id) values
        ('${EVE_PROFILE}','${ALICE_PROFILE}'),('${ALICE_PROFILE}','${EVE_PROFILE}'),
        ('${EVE_PROFILE}','${DAVE_PROFILE}'),('${DAVE_PROFILE}','${EVE_PROFILE}'),
        ('${EVE_PROFILE}','${CAROL_PROFILE}'),('${CAROL_PROFILE}','${EVE_PROFILE}')
      on conflict do nothing;
      insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
        values('${DAVE_PROFILE}','${EVE_PROFILE}');
      update public.private_social_accounts set ownership_state='suspended'
        where id='${CAROL_ACCOUNT}';
      insert into public.plans(id,title,start_time,owner_user_id,created_at,status,night_context,social_owner_account_id) values
        ('${selfPlan}','Self night','2026-08-20 18:00:00.000001+00','${EVE_USER}','2026-08-05 09:00:00+00','ready','{"nightArea":"camden"}','${EVE_ACCOUNT}'),
        ('${carolPlan}','Inactive owner night','2026-08-20 19:00:00.000002+00','${CAROL_USER}','2026-08-05 09:00:00+00','ready','{"nightArea":"soho"}','${CAROL_ACCOUNT}'),
        ('${davePlan}','Blocked night','2026-08-20 20:00:00.000003+00','${DAVE_USER}','2026-08-05 09:00:00+00','ready','{"nightArea":"shoreditch"}','${DAVE_ACCOUNT}'),
        ('${alicePlan}','Mutual night','2026-08-20 21:00:00.000004+00','${ALICE_USER}','2026-08-05 09:00:00+00','ready','{"nightArea":"camden"}','${ALICE_ACCOUNT}');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
      ) values
        ('${selfPlanMember}','${selfPlan}','Eve',md5('list-self')||md5('list-self-2'),'in','${EVE_USER}',now(),now(),true,'${EVE_ACCOUNT}'),
        ('${carolOwnerPlanMember}','${carolPlan}','Carol',md5('list-carol-owner')||md5('list-carol-owner-2'),'in','${CAROL_USER}',now(),now(),true,'${CAROL_ACCOUNT}'),
        ('${carolViewerPlanMember}','${carolPlan}','Eve',md5('list-carol-eve')||md5('list-carol-eve-2'),'in','${EVE_USER}',now(),now(),true,'${EVE_ACCOUNT}'),
        ('${daveOwnerPlanMember}','${davePlan}','Dave',md5('list-dave-owner')||md5('list-dave-owner-2'),'in','${DAVE_USER}',now(),now(),true,'${DAVE_ACCOUNT}'),
        ('${daveViewerPlanMember}','${davePlan}','Eve',md5('list-dave-eve')||md5('list-dave-eve-2'),'in','${EVE_USER}',now(),now(),true,'${EVE_ACCOUNT}'),
        ('${aliceOwnerPlanMember}','${alicePlan}','Alice',md5('list-alice-owner')||md5('list-alice-owner-2'),'in','${ALICE_USER}',now(),now(),true,'${ALICE_ACCOUNT}'),
        ('${aliceViewerPlanMember}','${alicePlan}','Eve',md5('list-alice-eve')||md5('list-alice-eve-2'),'in','${EVE_USER}',now(),now(),true,'${EVE_ACCOUNT}');
      insert into public.social_crews(id,plan_id,owner_account_id,visibility) values
        ('${selfCrew}','${selfPlan}','${EVE_ACCOUNT}','private'),
        ('${carolCrew}','${carolPlan}','${CAROL_ACCOUNT}','friends'),
        ('${daveCrew}','${davePlan}','${DAVE_ACCOUNT}','friends'),
        ('${aliceCrew}','${alicePlan}','${ALICE_ACCOUNT}','friends');
      insert into public.social_crew_members(
        id,crew_id,social_account_id,plan_member_id,role,state,joined_at,updated_at
      ) values
        ('${selfMember}','${selfCrew}','${EVE_ACCOUNT}','${selfPlanMember}','owner','active','2030-08-05 15:00:00.123456+00',now()),
        ('${carolOwnerMember}','${carolCrew}','${CAROL_ACCOUNT}','${carolOwnerPlanMember}','owner','active','2030-08-05 10:00:00+00',now()),
        ('${carolViewerMember}','${carolCrew}','${EVE_ACCOUNT}','${carolViewerPlanMember}','member','active','2030-08-05 14:00:00.000014+00',now()),
        ('${daveOwnerMember}','${daveCrew}','${DAVE_ACCOUNT}','${daveOwnerPlanMember}','owner','active','2030-08-05 10:00:00+00',now()),
        ('${daveViewerMember}','${daveCrew}','${EVE_ACCOUNT}','${daveViewerPlanMember}','member','active','2030-08-05 13:00:00.000013+00',now()),
        ('${aliceOwnerMember}','${aliceCrew}','${ALICE_ACCOUNT}','${aliceOwnerPlanMember}','owner','active','2030-08-05 10:00:00+00',now()),
        ('${aliceViewerMember}','${aliceCrew}','${EVE_ACCOUNT}','${aliceViewerPlanMember}','cohost','active','2030-08-05 12:00:00.123123+00',now());
    `);

    expect(db.sql(`set enable_seqscan=off;
        explain (costs off)
        select member.id
        from public.social_crew_members member
        join public.social_crews crew on crew.id=member.crew_id
        where member.social_account_id='${EVE_ACCOUNT}' and member.state='active'
        order by member.joined_at desc,member.id desc limit 2`))
      .toContain("social_crew_members_active_page_idx");
    expect(db.sql(`set enable_seqscan=off;
        explain (costs off)
        select request.state
        from public.social_crew_join_requests request
        where request.crew_id='${READ_CREW}' and request.requester_account_id='${CAROL_ACCOUNT}'
        order by request.created_at desc,request.id desc limit 1`))
      .toContain("social_crew_join_requests_history_idx");

    try {
      expect(readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 1)).toEqual({
        items: [{
          crewId: selfCrew,
          title: "Self night",
          status: "ready",
          nightArea: "camden",
          startsAt: "2026-08-20T18:00:00.000001Z",
          memberId: selfMember,
          accountId: EVE_ACCOUNT,
          profileId: EVE_PROFILE,
          role: "owner",
          state: "active",
          joinedAt: "2030-08-05T15:00:00.123456Z",
        }],
        hasMore: true,
        cursorPosition: {
          joinedAt: "2030-08-05T15:00:00.123456Z",
          memberId: selfMember,
        },
      });
      expect(readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 1, {
        joinedAt: "2030-08-05T15:00:00.123456Z",
        memberId: selfMember,
      })).toEqual({
        items: [{
          crewId: aliceCrew,
          title: "Mutual night",
          status: "ready",
          nightArea: "camden",
          startsAt: "2026-08-20T21:00:00.000004Z",
          memberId: aliceViewerMember,
          accountId: EVE_ACCOUNT,
          profileId: EVE_PROFILE,
          role: "cohost",
          state: "active",
          joinedAt: "2030-08-05T12:00:00.123123Z",
        }],
        hasMore: false,
        cursorPosition: null,
      });
      expect(readMemberPage(db, FRANK_ACCOUNT, FRANK_PROFILE, 50)).toEqual({
        items: [],
        hasMore: false,
        cursorPosition: null,
      });
      expect(readMemberPage(db, EVE_ACCOUNT, FRANK_PROFILE, 50)).toBeNull();
      expect(jsonValue(db.sql(`select coalesce(public.read_social_crew_member_page(
        '${EVE_ACCOUNT}','${EVE_PROFILE}','2030-08-05 15:00:00.123456+00',null,1
      ),'null'::jsonb)`))).toBeNull();
      expect(readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 0)).toBeNull();
      expect(readMemberPage(db, EVE_ACCOUNT, EVE_PROFILE, 51)).toBeNull();
    } finally {
      db.sql(`update public.private_social_accounts set ownership_state='active'
        where id='${CAROL_ACCOUNT}'`);
    }
  });

  it("requires owner role and current authority revision for visibility", () => {
    const db = database!;
    const revision = Number(db.sql(`select authority_revision from public.social_crews where id='${crewId}'`));
    expect(json(db.sql(`select public.update_social_crew_visibility_atomic(
      '${BOB_ACCOUNT}','${crewId}','private',${revision},'bob-visibility-key1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.update_social_crew_visibility_atomic(
      '${ALICE_ACCOUNT}','${crewId}','private',${revision + 1},'owner-vis-conflict1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "conflict" });
    expect(json(db.sql(`select public.update_social_crew_visibility_atomic(
      '${ALICE_ACCOUNT}','${crewId}','private',null,'owner-vis-null-key1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "conflict" });
    expect(json(db.sql(`select public.update_social_crew_visibility_atomic(
      '${ALICE_ACCOUNT}','${crewId}','private',${revision},'owner-visibility-1','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "updated", authority_revision: revision + 1 });
  });

  it("allows only the owner to change a non-owner role", () => {
    const db = database!;
    const bobMember = db.sql(`select id from public.social_crew_members where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`);
    expect(json(db.sql(`select public.set_social_crew_role_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${bobMember}','cohost','carol-role-denied1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "not_found" });
    expect(json(db.sql(`select public.set_social_crew_role_atomic(
      '${ALICE_ACCOUNT}','${crewId}','${bobMember}','cohost','owner-role-key-01','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "updated", member_id: bobMember });
    expect(db.sql(`select role from public.social_crew_members where id='${bobMember}'`)).toBe("cohost");
  });

  it("lets a cohost remove a non-owner while retaining both bindings", () => {
    const db = database!;
    const activated = json(db.sql(`select public.accept_social_crew_invitation_atomic(
      '${CAROL_ACCOUNT}','${crewId}','${carolInvitationId}','accepted','accept-carol-open1','${DIGEST_A}'
    )`));
    const carolMember = String(activated.member_id);
    const planMember = db.sql(`select plan_member_id from public.social_crew_members where id='${carolMember}'`);
    expect(json(db.sql(`select public.remove_social_crew_member_atomic(
      '${BOB_ACCOUNT}','${crewId}','${carolMember}','cohost-remove-key1','${DIGEST_A}'
    )`))).toMatchObject({ ok: true, code: "removed" });
    expect(db.sql(`select state || ':' || plan_member_id from public.social_crew_members where id='${carolMember}'`))
      .toBe(`removed:${planMember}`);
    expect(db.sql(`select count(*) from public.plan_crew_members where id='${planMember}' and social_account_id='${CAROL_ACCOUNT}'`)).toBe("1");
  });

  it("linearizes conversion before a racing legacy invite redemption", async () => {
    const db = database!;
    const plan = "12121212-1212-4121-8121-121212121212";
    const host = "13131313-1313-4131-8131-131313131313";
    const invite = "14141414-1414-4141-8141-141414141414";
    const hostHash = "c".repeat(64);
    const inviteHash = "d".repeat(64);
    db.sql(`
      insert into public.plans(id,title,start_time,status) values('${plan}','Race night',now()+interval '1 day','ready');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate)
        values('${host}','${plan}','Alice','${hostHash}','in',now(),now(),true);
      insert into public.plan_invites(id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at)
        values('${invite}','${plan}','${host}','${inviteHash}','race-invite',now(),now()+interval '1 day');
    `);
    const results = await db.concurrentResults([
      `begin;
       select public.create_social_crew_atomic('${ALICE_ACCOUNT}','${plan}','${hostHash}','private','race-create-key-01','${DIGEST_A}');
       select pg_sleep(0.5);
       commit;`,
      `begin;
       select pg_sleep(0.2);
       select public.redeem_plan_invite_idempotent_atomic(
         '${plan}','${inviteHash}',gen_random_uuid(),'Mallory','${"e".repeat(64)}',now(),'${"f".repeat(64)}','${"0".repeat(64)}'
       );
       commit;`,
    ]);

    expect(results[0]).toContain('"code": "created"');
    expect(results[1]).toContain("not_found");
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}'`)).toBe("1");
  });

  it("does not mint invitation or Join Request rows for an ended Plan", () => {
    const db = database!;
    const racePlan = "12121212-1212-4121-8121-121212121212";
    const raceCrew = db.sql(`select id from public.social_crews where plan_id='${racePlan}'`);
    db.sql(`update public.plans set status='completed' where id='${racePlan}'`);
    expect(json(db.sql(`select public.invite_social_crew_member_atomic(
      '${ALICE_ACCOUNT}','${raceCrew}','${BOB_PROFILE}','ended-invite-key01','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "invalid" });
    expect(json(db.sql(`select public.request_social_crew_join_atomic(
      '${BOB_ACCOUNT}','${raceCrew}','pending','ended-request-key1','${DIGEST_A}'
    )`))).toEqual({ ok: false, code: "invalid" });
    expect(db.sql(`select count(*) from public.social_crew_invitations where crew_id='${raceCrew}'`)).toBe("0");
    expect(db.sql(`select count(*) from public.social_crew_join_requests where crew_id='${raceCrew}'`)).toBe("0");
  });

  it("keeps exactly one owner through transfer and leave races", async () => {
    const db = database!;
    const bobMember = db.sql(`select id from public.social_crew_members where crew_id='${crewId}' and social_account_id='${BOB_ACCOUNT}'`);
    const start = new Date(Date.now() + 2_000).toISOString();
    const synchronized = (statement: string) => `begin; set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      ${statement}; commit;`;
    await db.concurrentResults([
      synchronized(`select public.transfer_social_crew_owner_atomic('${ALICE_ACCOUNT}','${crewId}','${bobMember}','transfer-owner-key-1','${DIGEST_A}')`),
      synchronized(`select public.leave_social_crew_atomic('${ALICE_ACCOUNT}','${crewId}','owner-leave-key-01','${DIGEST_A}')`),
    ]);

    expect(db.sql(`select count(*) from public.social_crew_members where crew_id='${crewId}' and role='owner' and state='active'`)).toBe("1");
    expect(db.sql(`select owner_account_id from public.social_crews where id='${crewId}'`)).toBe(BOB_ACCOUNT);
    expect(db.sql(`select social_owner_account_id from public.plans where id='${PLAN}'`)).toBe(BOB_ACCOUNT);
  });

  it("restores the byte-equivalent pre-0075 catalog on rollback", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(catalog(db)).toBe(beforeCatalog);
    expect(db.sql(`select string_agg(n.nspname,',' order by n.nspname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname='rls_is_plan_participant'`)).toBe("pubmax_private");
  });
});
