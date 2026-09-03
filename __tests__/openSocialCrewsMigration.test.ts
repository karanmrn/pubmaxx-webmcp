// Effective proof for 0110 and 0114, the open Social Crew lane and host queue.
// It applies the prerequisite migration chain to a real PostgreSQL 16 and
// exercises join, queue authority, request lifecycle, ACL, and rollback rules
// through the RPCs themselves. These claims need database proof.
//
// Same host contract as the other effective migration proofs
// (socialCrewMigration, occupancyMigration0109): a host with no PostgreSQL
// binaries skips loudly rather than passing quietly.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260816220000_0110_open_social_crews.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const QUEUE_FORWARD = join(
  MIGRATIONS,
  "20260823100000_0114_social_crew_join_request_queue.sql",
);
const PUBLIC_PREVIEW_FORWARD = join(
  MIGRATIONS,
  "20260823120000_0115_social_crew_public_preview.sql",
);
const ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260816220000_0110_open_social_crews_rollback.sql",
);
const QUEUE_ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260823100000_0114_social_crew_join_request_queue_rollback.sql",
);
const PUBLIC_PREVIEW_ROLLBACK = join(
  ROOT,
  "supabase/migrations/rollback/20260823120000_0115_social_crew_public_preview_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

type Database = {
  sql(statement: string): string;
  expectRefusal(statement: string): string;
  apply(path: string): void;
  stop(): Promise<void>;
};

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const path of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
  ]) {
    try {
      if (existsSync(path)) return path;
    } catch {
      // Try the next known PostgreSQL installation path.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_OPEN_CREW_MIGRATION_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_OPEN_CREW_MIGRATION_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => binary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run the open Social Crew proofs.`
    : null;
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolve(typeof address === "object" && address ? address.port : 0),
      );
    });
    server.on("error", reject);
  });
}

async function startDatabase(): Promise<Database> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL is unavailable.");
  }
  const directory = mkdtempSync(join(tmpdir(), "pubmax-open-crews-"));
  const port = await freePort();
  execFileSync(
    initdb,
    [
      "-D", directory, "--auth=trust", "--username=postgres", "--locale=C", "-E", "UTF8",
      "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
    ],
    { stdio: "pipe" },
  );
  writeFileSync(
    join(directory, "postgresql.auto.conf"),
    `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\nfull_page_writes=off\nsynchronous_commit=off\n`,
  );
  const server: ChildProcess = spawn(
    postgres,
    ["-D", directory, "-k", directory, "-h", "127.0.0.1", "-p", String(port)],
    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, LC_ALL: "C" } },
  );
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
        throw new Error(
          `PostgreSQL exited with code ${server.exitCode} before accepting connections.\n${serverLog.trim()}`,
        );
      }
      if (attempt === BOOT_ATTEMPTS - 1) {
        throw new Error(`PostgreSQL did not start within 60s.\n${serverLog.trim()}`);
      }
      await sleep(100);
    }
  }
  const run = (args: string[]): string =>
    execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .filter((line) => line.trim() !== "SET")
      .join("\n")
      .trim();

  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    expectRefusal: (statement) => {
      try {
        run(["-q", "-t", "-A", "-c", statement]);
      } catch (error) {
        const shell = error as { stderr?: Buffer | string };
        return String(shell.stderr ?? "");
      }
      throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
    },
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => server.once("exit", () => resolve())),
          sleep(1_000),
        ]);
      }
      if (server.exitCode === null) server.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const HOST_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const HOST_PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const HOST_ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const STRANGER_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const STRANGER_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const STRANGER_ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03";
const BLOCKED_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccc01";
const BLOCKED_PROFILE = "cccccccc-cccc-4ccc-8ccc-cccccccccc02";
const BLOCKED_ACCOUNT = "cccccccc-cccc-4ccc-8ccc-cccccccccc03";
const MATE_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const MATE_PROFILE = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const MATE_ACCOUNT = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
const ALLY_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const ALLY_PROFILE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const ALLY_ACCOUNT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";

const OPEN_PLAN = "11111111-0000-4000-8000-000000000001";
const OPEN_CREW = "11111111-0000-4000-8000-000000000002";
const OPEN_HOST_PLAN_MEMBER = "11111111-0000-4000-8000-000000000003";
const OPEN_HOST_MEMBER = "11111111-0000-4000-8000-000000000004";
const FRIENDS_PLAN = "22222222-0000-4000-8000-000000000001";
const FRIENDS_CREW = "22222222-0000-4000-8000-000000000002";
const FRIENDS_HOST_PLAN_MEMBER = "22222222-0000-4000-8000-000000000003";
const FRIENDS_HOST_MEMBER = "22222222-0000-4000-8000-000000000004";
const FRIENDS_ALLY_PLAN_MEMBER = "22222222-0000-4000-8000-000000000005";
const FRIENDS_ALLY_MEMBER = "22222222-0000-4000-8000-000000000006";
const FRIENDS_STRANGER_PLAN_MEMBER = "22222222-0000-4000-8000-000000000007";
const FRIENDS_STRANGER_MEMBER = "22222222-0000-4000-8000-000000000008";
const DIGEST = "a".repeat(64);

let database: Database | null = null;
let skipReason: string | null = null;
let keySequence = 0;
/** The rollback narrows the CHECK, so a reseed after it may not say `open`. */
let seedVisibility: "open" | "private" = "open";
let visibilityAfterRollback: string | null = null;
let listAfterPublicPreviewRollback: unknown = null;

function json(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function jsonValue(value: string): unknown {
  return JSON.parse(value);
}

/** Every write RPC is idempotent per key, so each call in a test needs its own. */
function writeKey(label: string): string {
  keySequence += 1;
  return `${label}-${String(keySequence).padStart(4, "0")}`.slice(0, 128).padEnd(16, "0");
}

function requireDatabase(): Database {
  if (!database) throw new Error("PostgreSQL open-crew session did not start.");
  return database;
}

function requestJoin(actor: string, crew: string, action = "pending"): Record<string, unknown> {
  return json(
    requireDatabase().sql(
      `select public.request_social_crew_join_atomic(
        '${actor}','${crew}','${action}','${writeKey("join")}','${DIGEST}'
      )`,
    ),
  );
}

function snapshot(accountId: string, profileId: string, crew: string): unknown {
  return jsonValue(
    requireDatabase().sql(
      `select coalesce(public.read_social_crew_snapshot(
        '${accountId}','${profileId}','${crew}'
      ),'null'::jsonb)`,
    ),
  );
}

/** The crews an account sees in its own list, through read_social_crew_member_page. */
function listedCrewIds(accountId: string, profileId: string): string[] {
  const page = jsonValue(
    requireDatabase().sql(
      `select coalesce(public.read_social_crew_member_page(
        '${accountId}','${profileId}',null,null,50
      ),'null'::jsonb)`,
    ),
  ) as { items: Array<{ crewId: string }> } | null;
  return page ? page.items.map((item) => item.crewId) : [];
}

function listOpenCrews(
  fromExpr = "now() - interval '1 hour'",
  untilExpr = "now() + interval '7 days'",
  city = "london",
  limit = 50,
): unknown {
  return jsonValue(
    requireDatabase().sql(
      `set role service_role;
       select public.list_open_social_crews(${fromExpr}, ${untilExpr}, '${city}', ${limit})`,
    ),
  );
}

function joinRequestQueue(
  accountId: string,
  profileId: string,
  crewId: string,
): unknown {
  return jsonValue(
    requireDatabase().sql(
      `select coalesce(public.read_social_crew_join_requests(
        '${accountId}','${profileId}','${crewId}'
      ),'null'::jsonb)`,
    ),
  );
}

function acceptIntoOpenCrew(accountId: string): void {
  const requested = requestJoin(accountId, OPEN_CREW);
  requireDatabase().sql(`select public.decide_social_crew_join_request_atomic(
    '${HOST_ACCOUNT}','${OPEN_CREW}','${String(requested.request_id)}','accepted',
    '${writeKey("decide")}','${DIGEST}'
  )`);
}

function seed(db: Database): void {
  db.sql(`
    delete from public.social_crew_join_requests;
    delete from public.social_crew_members;
    delete from public.social_crews;
    delete from public.plan_stops;
    delete from public.plan_crew_members;
    delete from public.plans where id in ('${OPEN_PLAN}','${FRIENDS_PLAN}');
    delete from public.social_blocks;
    delete from public.follows;

    insert into public.follows(follower_id,followee_id) values
      ('${HOST_PROFILE}','${MATE_PROFILE}'),('${MATE_PROFILE}','${HOST_PROFILE}'),
      ('${HOST_PROFILE}','${ALLY_PROFILE}'),('${ALLY_PROFILE}','${HOST_PROFILE}');
    insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
      values('${HOST_PROFILE}','${BLOCKED_PROFILE}');

    insert into public.plans(id,title,start_time,owner_user_id,status,social_owner_account_id)
      values
      ('${OPEN_PLAN}','Open Friday',now()+interval '1 day','${HOST_USER}','ready','${HOST_ACCOUNT}'),
      ('${FRIENDS_PLAN}','Mates only',now()+interval '1 day','${HOST_USER}','ready','${HOST_ACCOUNT}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
      ('${OPEN_PLAN}','venue-angel-islington','The Angel',0),
      ('${FRIENDS_PLAN}','venue-camden-arms','Camden Arms',0);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values
      ('${OPEN_HOST_PLAN_MEMBER}','${OPEN_PLAN}','Host',md5('open-host')||md5('open-host-2'),'in',
        '${HOST_USER}',now(),now(),true,'${HOST_ACCOUNT}'),
      ('${FRIENDS_HOST_PLAN_MEMBER}','${FRIENDS_PLAN}','Host',md5('friends-host')||md5('friends-host-2'),'in',
        '${HOST_USER}',now(),now(),true,'${HOST_ACCOUNT}'),
      ('${FRIENDS_ALLY_PLAN_MEMBER}','${FRIENDS_PLAN}','Ally',md5('friends-ally')||md5('friends-ally-2'),'in',
        '${ALLY_USER}',now(),now(),true,'${ALLY_ACCOUNT}'),
      ('${FRIENDS_STRANGER_PLAN_MEMBER}','${FRIENDS_PLAN}','Stranger',md5('friends-str')||md5('friends-str-2'),'in',
        '${STRANGER_USER}',now(),now(),true,'${STRANGER_ACCOUNT}');
    insert into public.social_crews(id,plan_id,owner_account_id,visibility) values
      ('${OPEN_CREW}','${OPEN_PLAN}','${HOST_ACCOUNT}','${seedVisibility}'),
      ('${FRIENDS_CREW}','${FRIENDS_PLAN}','${HOST_ACCOUNT}','friends');
    insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state) values
      ('${OPEN_HOST_MEMBER}','${OPEN_CREW}','${HOST_ACCOUNT}','${OPEN_HOST_PLAN_MEMBER}','owner','active'),
      ('${FRIENDS_HOST_MEMBER}','${FRIENDS_CREW}','${HOST_ACCOUNT}','${FRIENDS_HOST_PLAN_MEMBER}','owner','active'),
      ('${FRIENDS_ALLY_MEMBER}','${FRIENDS_CREW}','${ALLY_ACCOUNT}','${FRIENDS_ALLY_PLAN_MEMBER}','member','active'),
      ('${FRIENDS_STRANGER_MEMBER}','${FRIENDS_CREW}','${STRANGER_ACCOUNT}','${FRIENDS_STRANGER_PLAN_MEMBER}','member','active');
  `);
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "OPEN SOCIAL CREW 0110 + 0114 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "No open join, queue authority, request lifecycle, ACL or rollback was exercised on this host.",
        "",
      ].join("\n"),
    );
    return;
  }
  if (!existsSync(FORWARD)) throw new Error(`Missing migration: ${FORWARD}`);
  database = await startDatabase();
  database.apply(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.apply(migration);
  database.sql(`
    insert into auth.users(id) values
      ('${HOST_USER}'),('${STRANGER_USER}'),('${BLOCKED_USER}'),('${MATE_USER}'),('${ALLY_USER}');
    insert into public.profiles(id,user_id,handle) values
      ('${HOST_PROFILE}','${HOST_USER}','host'),
      ('${STRANGER_PROFILE}','${STRANGER_USER}','stranger'),
      ('${BLOCKED_PROFILE}','${BLOCKED_USER}','blocked'),
      ('${MATE_PROFILE}','${MATE_USER}','mate'),
      ('${ALLY_PROFILE}','${ALLY_USER}','ally');
    insert into public.private_social_accounts(
      id,clerk_user_id,supabase_user_id,profile_id,ownership_state
    ) values
      ('${HOST_ACCOUNT}','clerk-host','${HOST_USER}','${HOST_PROFILE}','active'),
      ('${STRANGER_ACCOUNT}','clerk-stranger','${STRANGER_USER}','${STRANGER_PROFILE}','active'),
      ('${BLOCKED_ACCOUNT}','clerk-blocked','${BLOCKED_USER}','${BLOCKED_PROFILE}','active'),
      ('${MATE_ACCOUNT}','clerk-mate','${MATE_USER}','${MATE_PROFILE}','active'),
      ('${ALLY_ACCOUNT}','clerk-ally','${ALLY_USER}','${ALLY_PROFILE}','active');
  `);
  database.apply(FORWARD);
  database.apply(QUEUE_FORWARD);
  database.apply(PUBLIC_PREVIEW_FORWARD);
}, 300_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
  if (database) seed(database);
});

afterAll(async () => {
  await database?.stop();
});

describe("0110 and 0114 applied to PostgreSQL", () => {
  it("shows pending requests only to current crew managers", () => {
    requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    expect(joinRequestQueue(HOST_ACCOUNT, HOST_PROFILE, OPEN_CREW)).toEqual({
      items: [
        {
          requestId: expect.any(String),
          requesterHandle: "stranger",
        },
      ],
      hasMore: false,
    });
    expect(joinRequestQueue(STRANGER_ACCOUNT, STRANGER_PROFILE, OPEN_CREW)).toBeNull();

    const db = requireDatabase();
    db.sql(`insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
      ) values(
        '77777777-0000-4000-8000-000000000001','${OPEN_PLAN}','Ally',
        md5('open-ally')||md5('open-ally-2'),'in','${ALLY_USER}',now(),now(),true,'${ALLY_ACCOUNT}'
      );
      insert into public.social_crew_members(
        id,crew_id,social_account_id,plan_member_id,role,state
      ) values(
        '77777777-0000-4000-8000-000000000002','${OPEN_CREW}','${ALLY_ACCOUNT}',
        '77777777-0000-4000-8000-000000000001','cohost','active'
      )`);
    expect(joinRequestQueue(ALLY_ACCOUNT, ALLY_PROFILE, OPEN_CREW)).toMatchObject({
      items: [{ requesterHandle: "stranger" }],
    });
    expect(joinRequestQueue(HOST_ACCOUNT, HOST_PROFILE, FRIENDS_CREW)).toBeNull();
    db.sql(`delete from public.follows
      where follower_id='${ALLY_PROFILE}' and followee_id='${HOST_PROFILE}'`);
    expect(joinRequestQueue(ALLY_ACCOUNT, ALLY_PROFILE, OPEN_CREW)).toBeNull();
  });

  it("omits blocked, expired, terminal, and already-active requesters", () => {
    const db = requireDatabase();
    const blocked = requestJoin(MATE_ACCOUNT, OPEN_CREW);
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
      values('${HOST_PROFILE}','${MATE_PROFILE}')`);
    expect(joinRequestQueue(HOST_ACCOUNT, HOST_PROFILE, OPEN_CREW)).toEqual({
      items: [],
      hasMore: false,
    });

    db.sql(`delete from public.social_blocks;
      update public.social_crew_join_requests
      set state='expired',decided_at=now()
      where id='${String(blocked.request_id)}'`);
    db.sql(`update public.social_crew_join_requests
      set state='pending',decided_at=null,created_at=now()-interval '2 days',
        expires_at=now()-interval '1 day'
      where id='${String(blocked.request_id)}';
      select public._activate_social_crew_member('${OPEN_CREW}','${MATE_ACCOUNT}')`);
    expect(
      db.sql(`select state from public.social_crew_join_requests
        where id='${String(blocked.request_id)}'`),
    ).toBe("expired");
    const active = requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    db.sql(`select public._activate_social_crew_member(
      '${OPEN_CREW}','${STRANGER_ACCOUNT}'
    )`);
    expect(joinRequestQueue(HOST_ACCOUNT, HOST_PROFILE, OPEN_CREW)).toEqual({
      items: [],
      hasMore: false,
    });
    expect(
      db.sql(`select state from public.social_crew_join_requests
        where id='${String(active.request_id)}'`),
    ).toBe("accepted");
  });

  it("keeps the private queue RPC service-role only", () => {
    const db = requireDatabase();
    requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role};
           select public.read_social_crew_join_requests(
             '${HOST_ACCOUNT}','${HOST_PROFILE}','${OPEN_CREW}'
           )`,
        ),
      ).toMatch(/permission denied/i);
    }
    expect(
      db.sql(`set role service_role;
        select jsonb_array_length(
          public.read_social_crew_join_requests(
            '${HOST_ACCOUNT}','${HOST_PROFILE}','${OPEN_CREW}'
          )->'items'
        )`),
    ).toBe("1");
  });

  it("lets a stranger ask to join an open crew", () => {
    const db = requireDatabase();
    expect(requestJoin(STRANGER_ACCOUNT, OPEN_CREW)).toMatchObject({
      ok: true,
      code: "requested",
    });
    expect(
      db.sql(`select count(*) from public.social_crew_join_requests
        where crew_id='${OPEN_CREW}' and requester_account_id='${STRANGER_ACCOUNT}' and state='pending'`),
    ).toBe("1");
  });

  it("refuses a blocked requester on an open crew", () => {
    const db = requireDatabase();
    expect(requestJoin(BLOCKED_ACCOUNT, OPEN_CREW)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(
      db.sql(`select count(*) from public.social_crew_join_requests
        where crew_id='${OPEN_CREW}' and requester_account_id='${BLOCKED_ACCOUNT}'`),
    ).toBe("0");
  });

  it("still requires a mutual follow on a crew that is not open", () => {
    expect(requestJoin(STRANGER_ACCOUNT, FRIENDS_CREW)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(requestJoin(MATE_ACCOUNT, FRIENDS_CREW)).toMatchObject({
      ok: true,
      code: "requested",
    });
  });

  it("accepts a non-mutual requester into an open crew and refuses a blocked one", () => {
    const db = requireDatabase();
    const requested = requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    expect(
      json(
        db.sql(`select public.decide_social_crew_join_request_atomic(
          '${HOST_ACCOUNT}','${OPEN_CREW}','${String(requested.request_id)}','accepted',
          '${writeKey("decide")}','${DIGEST}'
        )`),
      ),
    ).toMatchObject({ ok: true, code: "accepted" });
    expect(
      db.sql(`select count(*) from public.social_crew_members
        where crew_id='${OPEN_CREW}' and social_account_id='${STRANGER_ACCOUNT}' and state='active'`),
    ).toBe("1");

    // A request made before a block must not be accepted after one.
    const later = requestJoin(MATE_ACCOUNT, OPEN_CREW);
    db.sql(`insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
      values('${HOST_PROFILE}','${MATE_PROFILE}')`);
    expect(
      json(
        db.sql(`select public.decide_social_crew_join_request_atomic(
          '${HOST_ACCOUNT}','${OPEN_CREW}','${String(later.request_id)}','accepted',
          '${writeKey("decide")}','${DIGEST}'
        )`),
      ),
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      db.sql(`select count(*) from public.social_crew_members
        where crew_id='${OPEN_CREW}' and social_account_id='${MATE_ACCOUNT}' and state='active'`),
    ).toBe("0");
  });

  it("previews an open crew to a stranger without the member list", () => {
    const preview = snapshot(STRANGER_ACCOUNT, STRANGER_PROFILE, OPEN_CREW) as {
      kind: string;
      preview: Record<string, unknown>;
    };
    expect(preview.kind).toBe("preview");
    expect(preview.preview).toMatchObject({
      title: "Open Friday",
      hostHandle: "host",
      stopVenueId: "venue-angel-islington",
      stopVenueName: "The Angel",
      memberCount: 1,
    });
    expect(JSON.stringify(preview)).not.toContain("members");

    // A blocked reader is told nothing at all.
    expect(snapshot(BLOCKED_ACCOUNT, BLOCKED_PROFILE, OPEN_CREW)).toBeNull();
    // A friends crew still says nothing to a stranger.
    expect(snapshot(STRANGER_ACCOUNT, STRANGER_PROFILE, FRIENDS_CREW)).toBeNull();
  });

  it("gives an accepted non-mutual member the member snapshot", () => {
    const db = requireDatabase();
    const requested = requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    db.sql(`select public.decide_social_crew_join_request_atomic(
      '${HOST_ACCOUNT}','${OPEN_CREW}','${String(requested.request_id)}','accepted',
      '${writeKey("decide")}','${DIGEST}'
    )`);
    const read = snapshot(STRANGER_ACCOUNT, STRANGER_PROFILE, OPEN_CREW) as {
      kind: string;
      crew: { members: unknown[] };
    };
    expect(read.kind).toBe("member");
    expect(read.crew.members).toHaveLength(2);
  });

  it("shows an accepted stranger the open crew in their own list", () => {
    const db = requireDatabase();
    // A pending requester is not a member and sees nothing.
    requestJoin(STRANGER_ACCOUNT, OPEN_CREW);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).not.toContain(OPEN_CREW);

    db.sql(`delete from public.social_crew_join_requests
      where crew_id='${OPEN_CREW}' and requester_account_id='${STRANGER_ACCOUNT}'`);
    acceptIntoOpenCrew(STRANGER_ACCOUNT);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).toContain(OPEN_CREW);

    // A member who left keeps nothing.
    db.sql(`update public.social_crew_members set state='left',ended_at=now()
      where crew_id='${OPEN_CREW}' and social_account_id='${STRANGER_ACCOUNT}'`);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).not.toContain(OPEN_CREW);

    // A block takes the listing away from an active member too.
    db.sql(`update public.social_crew_members set state='active',ended_at=null
      where crew_id='${OPEN_CREW}' and social_account_id='${STRANGER_ACCOUNT}';
      insert into public.social_blocks(blocker_profile_id,blocked_profile_id)
        values('${HOST_PROFILE}','${STRANGER_PROFILE}')`);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).not.toContain(OPEN_CREW);
  });

  it("keeps a crew that is not open on the mutual rule in the same list", () => {
    expect(listedCrewIds(ALLY_ACCOUNT, ALLY_PROFILE)).toContain(FRIENDS_CREW);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).not.toContain(FRIENDS_CREW);
    expect(listedCrewIds(HOST_ACCOUNT, HOST_PROFILE)).toEqual(
      expect.arrayContaining([OPEN_CREW, FRIENDS_CREW]),
    );
  });

  it("lets the host close an open crew back to private", () => {
    const db = requireDatabase();
    const revision = Number(
      db.sql(`select authority_revision from public.social_crews where id='${OPEN_CREW}'`),
    );
    expect(
      json(
        db.sql(`select public.update_social_crew_visibility_atomic(
          '${HOST_ACCOUNT}','${OPEN_CREW}','private',${revision},'${writeKey("close")}','${DIGEST}'
        )`),
      ),
    ).toMatchObject({ ok: true, code: "updated" });
    expect(
      db.sql(`select visibility from public.social_crews where id='${OPEN_CREW}'`),
    ).toBe("private");
    // A closed plan is a private one again: the stranger loses both the ask
    // and the preview.
    expect(requestJoin(STRANGER_ACCOUNT, OPEN_CREW)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(snapshot(STRANGER_ACCOUNT, STRANGER_PROFILE, OPEN_CREW)).toBeNull();
  });

  it("lets an accepted member keep reading after the host closes to private", () => {
    const db = requireDatabase();
    acceptIntoOpenCrew(STRANGER_ACCOUNT);
    const revision = Number(
      db.sql(`select authority_revision from public.social_crews where id='${OPEN_CREW}'`),
    );
    expect(
      json(
        db.sql(`select public.update_social_crew_visibility_atomic(
          '${HOST_ACCOUNT}','${OPEN_CREW}','private',${revision},'${writeKey("close-member")}','${DIGEST}'
        )`),
      ),
    ).toMatchObject({ ok: true, code: "updated" });
    expect(snapshot(STRANGER_ACCOUNT, STRANGER_PROFILE, OPEN_CREW)).not.toBeNull();
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).toContain(OPEN_CREW);
    expect(requestJoin(STRANGER_ACCOUNT, OPEN_CREW)).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("lists open crews for the service role only", () => {
    const db = requireDatabase();
    const listed = listOpenCrews() as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      crewId: OPEN_CREW,
      title: "Open Friday",
      hostHandle: "host",
      stopVenueId: "venue-angel-islington",
      memberCount: 1,
    });

    // The friends crew is not a market listing, and a closed one leaves it.
    expect(JSON.stringify(listed)).not.toContain(FRIENDS_CREW);
    db.sql(`update public.social_crews set visibility='private' where id='${OPEN_CREW}'`);
    expect(listOpenCrews()).toEqual([]);

    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role};
           select public.list_open_social_crews(now() - interval '1 hour', now() + interval '7 days', 'london', 50)`,
        ),
      ).toMatch(/permission denied/i);
    }
  });

  it("lists a plan inside its window and honours the limit", () => {
    expect(listOpenCrews("now() + interval '2 days'", "now() + interval '3 days'")).toEqual([]);
    expect((listOpenCrews("now() - interval '1 hour'", "now() + interval '7 days'", "london", 1) as unknown[]).length).toBe(1);
  });

  it("does not promote Stop 2 when Stop 1 is blank", () => {
    const db = requireDatabase();
    db.sql(`delete from public.plan_stops where plan_id='${OPEN_PLAN}';
      insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
        ('${OPEN_PLAN}','   ','   ',0),
        ('${OPEN_PLAN}','venue-angel-islington','The Angel',1)`);

    expect(
      db.sql(`set role service_role;
        select public.read_social_crew_public_preview('${OPEN_CREW}')`),
    ).toBe("");
    expect(listOpenCrews()).toEqual([]);
  });

  it("rejects a blank Stop 1 before considering a valid Stop 2", () => {
    const db = requireDatabase();
    db.sql(`delete from public.plan_stops where plan_id='${OPEN_PLAN}';
      insert into public.plan_stops(plan_id,venue_id,venue_name,position) values
        ('${OPEN_PLAN}','   ','First row',0),
        ('${OPEN_PLAN}','venue-angel-islington','The Angel',1)`);

    expect(
      db.sql(`set role service_role;
        select public.read_social_crew_public_preview('${OPEN_CREW}')`),
    ).toBe("");
    expect(listOpenCrews()).toEqual([]);
  });

  it("keeps /out lifecycle aligned with the public preview expiry", () => {
    const db = requireDatabase();
    db.sql(`update public.plans set start_time=now() - interval '9 hours' where id='${OPEN_PLAN}'`);

    expect(
      db.sql(`set role service_role;
        select public.read_social_crew_public_preview('${OPEN_CREW}')`),
    ).toBe("");
    expect(listOpenCrews("now() - interval '10 hours'", "now() + interval '7 days'")).toEqual([]);
  });

  it("returns only one strict public preview for an open active crew", () => {
    const db = requireDatabase();
    const preview = jsonValue(
      db.sql(`set role service_role;
        select public.read_social_crew_public_preview('${OPEN_CREW}')`),
    ) as Record<string, unknown>;
    expect(preview).toEqual({
      crewId: OPEN_CREW,
      title: "Open Friday",
      hostHandle: "host",
      startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      stopVenueId: "venue-angel-islington",
      stopVenueName: "The Angel",
    });
    expect(JSON.stringify(preview)).not.toContain(HOST_ACCOUNT);
    expect(JSON.stringify(preview)).not.toContain("member");
    expect(JSON.stringify(preview)).not.toContain("request");
    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role};
           select public.read_social_crew_public_preview('${OPEN_CREW}')`,
        ),
      ).toMatch(/permission denied/i);
    }
  });

  it("returns no public preview after closure or expiry", () => {
    const db = requireDatabase();
    db.sql(`update public.social_crews set visibility='private' where id='${OPEN_CREW}'`);
    expect(db.sql(`set role service_role; select public.read_social_crew_public_preview('${OPEN_CREW}')`)).toBe("");
    db.sql(`update public.social_crews set visibility='open' where id='${OPEN_CREW}'`);
    db.sql(`update public.plans set start_time=now() - interval '9 hours' where id='${OPEN_PLAN}'`);
    expect(db.sql(`set role service_role; select public.read_social_crew_public_preview('${OPEN_CREW}')`)).toBe("");
  });
});

describe("0114 and 0110 rolled back", () => {
  beforeAll(() => {
    if (skipReason || !database) return;
    seed(database);
    database.apply(PUBLIC_PREVIEW_ROLLBACK);
    database.sql(`update public.plans set start_time=now() - interval '9 hours' where id='${OPEN_PLAN}'`);
    listAfterPublicPreviewRollback = jsonValue(
      database.sql(
        `set role service_role;
         select public.list_open_social_crews(
           now() - interval '10 hours', now() + interval '7 days', 'london', 50
         )`,
      ),
    );
    database.apply(QUEUE_ROLLBACK);
    database.apply(ROLLBACK);
    visibilityAfterRollback = database.sql(
      `select visibility from public.social_crews where id='${OPEN_CREW}'`,
    );
    seedVisibility = "private";
  });

  it("removes the host queue function and index", () => {
    const db = requireDatabase();
    expect(
      db.sql(
        "select to_regprocedure('public.read_social_crew_join_requests(uuid,uuid,uuid)') is null",
      ),
    ).toBe("t");
    expect(
      db.sql(
        "select to_regclass('public.social_crew_pending_join_request_queue_idx') is null",
      ),
    ).toBe("t");
    expect(
      db.sql(
        "select to_regprocedure('public._terminalize_social_crew_join_request_on_membership()') is null",
      ),
    ).toBe("t");
    expect(
      db.sql(`select count(*) from pg_trigger
        where tgname='social_crew_members_terminalize_join_request'`),
    ).toBe("0");
  });

  it("returns every open crew to private and refuses the widened visibility", () => {
    const db = requireDatabase();
    expect(visibilityAfterRollback).toBe("private");
    expect(
      db.sql(`select count(*) from public.social_crews where visibility='open'`),
    ).toBe("0");
    expect(
      db.expectRefusal(
        `update public.social_crews set visibility='open' where id='${OPEN_CREW}'`,
      ),
    ).toMatch(/social_crews_visibility_check/);
  });

  it("restores the exact 0110 list lifecycle before 0110 rollback", () => {
    expect(listAfterPublicPreviewRollback).toEqual([
      expect.objectContaining({ crewId: OPEN_CREW }),
    ]);
  });

  it("refuses a non-mutual join request again and drops the listing function", () => {
    const db = requireDatabase();
    expect(requestJoin(STRANGER_ACCOUNT, OPEN_CREW)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(requestJoin(MATE_ACCOUNT, OPEN_CREW)).toMatchObject({
      ok: true,
      code: "requested",
    });
    expect(
      db.expectRefusal(
        `set role service_role;
         select public.list_open_social_crews(now() - interval '1 hour', now() + interval '7 days', 'london', 50)`,
      ),
    ).toMatch(/does not exist/i);
  });

  it("drops the public preview RPC on rollback", () => {
    const db = requireDatabase();
    expect(
      db.expectRefusal(
        `set role service_role;
         select public.read_social_crew_public_preview('${OPEN_CREW}')`,
      ),
    ).toMatch(/does not exist/i);
  });

  it("returns the crew list to owner-or-mutual authority", () => {
    const db = requireDatabase();
    db.sql(`insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
      ) values('33333333-0000-4000-8000-000000000001','${OPEN_PLAN}','Stranger',
        md5('rb-str')||md5('rb-str-2'),'in','${STRANGER_USER}',now(),now(),true,'${STRANGER_ACCOUNT}');
      insert into public.social_crew_members(id,crew_id,social_account_id,plan_member_id,role,state)
        values('33333333-0000-4000-8000-000000000002','${OPEN_CREW}','${STRANGER_ACCOUNT}',
          '33333333-0000-4000-8000-000000000001','member','active')`);
    expect(listedCrewIds(STRANGER_ACCOUNT, STRANGER_PROFILE)).not.toContain(OPEN_CREW);
    expect(listedCrewIds(ALLY_ACCOUNT, ALLY_PROFILE)).toContain(FRIENDS_CREW);
  });
});
