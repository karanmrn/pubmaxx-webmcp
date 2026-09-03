import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTS = join(process.cwd(), "supabase/migrations/20260806145914_0072_social_posts.sql");
const FORWARD = join(process.cwd(), "supabase/migrations/20260806150000_0073_social_interactions.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260806150000_0073_social_interactions_rollback.sql");

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

const execFileAsync = promisify(execFile);
type Database = { sql(statement: string): string; sqlAsync(statement: string): Promise<string>; apply(path: string): void; stop(): Promise<void> };
let database: Database | null = null;

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
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-interactions-"));
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
  const run = (args: string[]) => execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    async sqlAsync(statement) {
      const { stdout } = await execFileAsync(psql, [...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement], { encoding: "utf8" });
      return stdout.trim();
    },
    apply: (path) => run(["-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", () => resolve())), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
let postId = "";
let featureId = "";

beforeAll(async () => {
  database = await startDatabase();
  database.sql(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create table public.profiles(id uuid primary key, handle text not null unique);
    create table public.follows(
      id uuid primary key default gen_random_uuid(),
      follower_id uuid not null references public.profiles(id),
      followee_id uuid not null references public.profiles(id),
      unique(follower_id, followee_id)
    );
    insert into public.profiles(id,handle) values
      ('${ALICE}','alice'), ('${BOB}','bob'), ('${CAROL}','carol');
    insert into public.follows(follower_id,followee_id) values ('${ALICE}','${BOB}'), ('${BOB}','${ALICE}');
  `);
  database.apply(POSTS);
  database.apply(FORWARD);
  database.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role,active)
    values ('44444444-4444-4444-8444-444444444444','${CAROL}','Carol Smith','moderator',true)`);
  postId = database.sql(`insert into public.social_posts(
    author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state
  ) values ('${ALICE}','alice','standard','public','Source','open','approved') returning id`);
  featureId = database.sql(`insert into public.social_posts(
    author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state,feature_status
  ) values ('${ALICE}','alice','feature_request','public','Feature','open','approved','submitted') returning id`);
}, 60_000);

afterAll(async () => database?.stop());

describe("Social interactions migration forward, race, and rollback", () => {
  it("keeps desired state idempotent under concurrent retries and saves private", async () => {
    const db = database!;
    const call = `select public.set_social_desired_interaction('${BOB}','${postId}','cheer',true)`;
    await Promise.all([db.sqlAsync(call), db.sqlAsync(call), db.sqlAsync(call)]);
    expect(db.sql(`select count(*) from public.social_cheers where post_id='${postId}' and actor_profile_id='${BOB}'`)).toBe("1");
    db.sql(`select public.set_social_desired_interaction('${BOB}','${postId}','save',true)`);
    expect(db.sql(`select count(*) from public.social_saves where post_id='${postId}' and actor_profile_id='${BOB}'`)).toBe("1");
    expect(db.sql(`select source_post ->> 'id' from public.read_social_saves('${BOB}',null,null,20)`)).toBe(postId);
    expect(db.sql(`select has_table_privilege('authenticated','public.social_saves','select')`)).toBe("f");
    expect(db.sql(`select has_table_privilege('anon','public.social_cheers','select')`)).toBe("f");
  });

  it("deduplicates held comments by hashed key and digest, then publishes only after moderation", () => {
    const db = database!;
    const first = db.sql(`select id from public.create_social_comment(
      '${BOB}','${postId}','bob','Held comment','${"a".repeat(64)}','${"b".repeat(64)}'
    )`);
    const retry = db.sql(`select id from public.create_social_comment(
      '${BOB}','${postId}','bob','Held comment','${"a".repeat(64)}','${"b".repeat(64)}'
    )`);
    expect(retry).toBe(first);
    expect(db.sql(`select count(*) from public.read_social_comments('${ALICE}','${postId}',null,null,20)`)).toBe("0");
    expect(() => db.sql(`select id from public.create_social_comment(
      '${BOB}','${postId}','bob','Changed payload','${"a".repeat(64)}','${"c".repeat(64)}'
    )`)).toThrow();
    expect(db.sql(`select public.complete_social_interaction_moderation('comment','${first}','approved')`)).toBe("t");
    expect(db.sql(`select count(*) from public.read_social_comments('${ALICE}','${postId}',null,null,20)`)).toBe("1");
    expect(db.sql(`select count(*) from public.read_social_notifications('${ALICE}',null,null,20)`)).toBe("2");
  });

  it("leases moderation jobs and keeps provider failures held for explicit retry", () => {
    const db = database!;
    const held = db.sql(`select id from public.create_social_comment(
      '${CAROL}','${postId}','carol','Provider held','${"6".repeat(64)}','${"7".repeat(64)}'
    )`);
    expect(db.sql(`select content_id from public.claim_social_interaction_moderation_jobs(20) where content_id='${held}'`)).toBe(held);
    expect(db.sql(`select public.complete_social_interaction_moderation_job(
      'comment','${held}',null,'provider_error',now() - interval '1 second'
    )`)).toBe("t");
    expect(db.sql(`select state from public.social_interaction_moderation_jobs where content_id='${held}'`)).toBe("pending");
    expect(db.sql(`select content_id from public.claim_social_interaction_moderation_jobs(20) where content_id='${held}'`)).toBe(held);
    expect(db.sql(`select public.complete_social_interaction_moderation_job(
      'comment','${held}',null,'bad_configuration',null
    )`)).toBe("t");
    expect(db.sql(`select state from public.social_interaction_moderation_jobs where content_id='${held}'`)).toBe("error");
    expect(db.sql(`select moderation_state from public.social_comments where id='${held}'`)).toBe("pending");
  });

  it("reclaims an expired moderation lease after a worker crash", () => {
    const db = database!;
    const held = db.sql(`select id from public.create_social_comment(
      '${CAROL}','${postId}','carol','Abandoned lease','${"8".repeat(64)}','${"9".repeat(64)}'
    )`);
    expect(db.sql(`select content_id from public.claim_social_interaction_moderation_jobs(20) where content_id='${held}'`)).toBe(held);
    db.sql(`update public.social_interaction_moderation_jobs set lease_until=now() - interval '1 second' where content_id='${held}'`);
    expect(db.sql(`select content_id from public.claim_social_interaction_moderation_jobs(20) where content_id='${held}'`)).toBe(held);
    expect(db.sql(`select attempts from public.social_interaction_moderation_jobs where content_id='${held}'`)).toBe("2");
  });

  it("serialises comment creation against an author lock", async () => {
    const db = database!;
    const locking = db.sqlAsync(`begin; select public.set_social_comment_policy('${ALICE}','${postId}','locked'); select pg_sleep(1); commit`);
    await sleep(100);
    await expect(db.sqlAsync(`select id from public.create_social_comment(
      '${CAROL}','${postId}','carol','Racing comment','${"d".repeat(64)}','${"e".repeat(64)}'
    )`)).rejects.toThrow();
    await locking;
    expect(db.sql(`select count(*) from public.social_comments where body='Racing comment'`)).toBe("0");
  });

  it("uses source visibility intersection and block reductions on reads, counts, derivatives, and notifications", () => {
    const db = database!;
    db.sql(`select public.set_social_comment_policy('${ALICE}','${postId}','open')`);
    const quote = db.sql(`select id from public.create_social_quote(
      '${BOB}','${postId}','bob','Public wrapper','public','${"f".repeat(64)}','${"1".repeat(64)}'
    )`);
    db.sql(`select public.complete_social_interaction_moderation('quote','${quote}','approved')`);
    expect(db.sql(`select count(*) from public.read_social_derivatives('${CAROL}',null,null,20)`)).toBe("1");
    expect(db.sql(`select source_post ->> 'id' from public.read_social_derivatives('${CAROL}',null,null,20)`)).toBe(postId);
    expect(db.sql(`select cheer_count from public.read_social_interaction_summary('${CAROL}','${postId}')`)).toBe("1");
    const privateQuote = db.sql(`select id from public.create_social_quote(
      '${BOB}','${postId}','bob','Private wrapper','private','${"0".repeat(64)}','${"e".repeat(64)}'
    )`);
    db.sql(`select public.complete_social_interaction_moderation('quote','${privateQuote}','approved')`);
    expect(() => db.sql(`select id from public.report_social_content('${CAROL}','quote','${privateQuote}','harassment')`)).toThrow();

    db.sql(`select public.set_social_block('${ALICE}','${BOB}',true)`);
    expect(db.sql(`select count(*) from public.read_social_derivatives('${ALICE}',null,null,20)`)).toBe("0");
    expect(db.sql(`select cheer_count from public.read_social_interaction_summary('${ALICE}','${postId}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_notifications('${ALICE}',null,null,20)`)).toBe("0");
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',false)`);

    db.sql(`update public.social_posts set visibility='private' where id='${postId}'`);
    expect(db.sql(`select count(*) from public.read_social_derivatives('${CAROL}',null,null,20)`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_notifications('${ALICE}',null,null,20)`)).toBe("4");
    expect(db.sql(`select count(*) from public.read_social_notifications('${BOB}',null,null,20)`)).toBe("0");
  });

  it("keeps reports non-hiding and staff feature history append-only with private named audit identity", () => {
    const db = database!;
    db.sql(`update public.social_posts set visibility='public' where id='${postId}'`);
    expect(db.sql(`select current_status from public.read_social_feature_status('${ALICE}','${featureId}')`)).toBe("submitted");
    expect(db.sql(`select count(*) from public.read_social_feature_status('${ALICE}','${postId}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_feature_status('${ALICE}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`)).toBe("0");
    db.sql(`update public.social_posts set visibility='private' where id='${featureId}'`);
    expect(db.sql(`select count(*) from public.read_social_feature_status('${BOB}','${featureId}')`)).toBe("0");
    db.sql(`update public.social_posts set visibility='public' where id='${featureId}'`);
    const report = db.sql(`select id from public.report_social_content('${BOB}','post','${postId}','harassment')`);
    const retry = db.sql(`select id from public.report_social_content('${BOB}','post','${postId}','harassment')`);
    expect(retry).toBe(report);
    expect(db.sql(`select status from public.social_posts where id='${postId}'`)).toBe("visible");

    const reportedComment = db.sql(`select id from public.social_comments where body='Held comment'`);
    expect(() => db.sql(`select public.moderate_social_interaction('${CAROL}','comment','${reportedComment}','hide')`)).toThrow();
    db.sql(`select id from public.report_social_content('${ALICE}','comment','${reportedComment}','harassment')`);
    expect(db.sql(`select count(*) from public.read_social_report_queue('${CAROL}',null,null,20)`)).toBe("2");
    expect(db.sql(`select public.moderate_social_interaction('${CAROL}','comment','${reportedComment}','hide')`)).toBe("t");
    expect(db.sql(`select public.moderate_social_interaction('${CAROL}','comment','${reportedComment}','restore')`)).toBe("t");
    expect(db.sql(`select public.resolve_social_report('${CAROL}','${report}')`)).toBe("t");
    expect(db.sql(`select state from public.social_content_reports where id='${report}'`)).toBe("resolved");
    db.sql(`select id from public.append_social_feature_update(
      '${CAROL}','${featureId}','planned','We are scoping this.','${"2".repeat(64)}','${"3".repeat(64)}'
    )`);
    db.sql(`select id from public.append_social_feature_update(
      '${CAROL}','${featureId}','shipped','Available now.','${"4".repeat(64)}','${"5".repeat(64)}'
    )`);
    expect(db.sql(`select string_agg(status,',' order by created_at,id) from public.read_social_feature_history('${ALICE}','${featureId}',null,null,20)`)).toBe("planned,shipped");
    expect(db.sql(`select current_status from public.read_social_feature_status('${ALICE}','${featureId}')`)).toBe("shipped");
    expect(db.sql(`select feature_status || ':' || feature_staff_response from public.social_posts where id='${featureId}'`)).toBe("shipped:Available now.");
    expect(db.sql(`select count(*) from public.read_social_feature_queue('${CAROL}',null,null,20)`)).toBe("1");
    expect(() => db.sql(`select count(*) from public.read_social_feature_queue('${ALICE}',null,null,20)`)).toThrow();
    expect(db.sql(`select has_table_privilege('authenticated','public.private_social_staff_roles','select')`)).toBe("f");
    expect(db.sql(`select count(*) from public.social_moderation_actions where content_id='${reportedComment}'`)).toBe("2");
  });

  it("serialises concurrent feature updates with the canonical post cache", async () => {
    const db = database!;
    await Promise.all([
      db.sqlAsync(`select id from public.append_social_feature_update(
        '${CAROL}','${featureId}','planned','Concurrent plan.','${"6".repeat(64)}','${"7".repeat(64)}'
      )`),
      db.sqlAsync(`select id from public.append_social_feature_update(
        '${CAROL}','${featureId}','declined','Concurrent decline.','${"8".repeat(64)}','${"9".repeat(64)}'
      )`),
    ]);
    expect(db.sql(`select feature_status = (
      select status from public.social_feature_request_updates
      where post_id='${featureId}' order by created_at desc,id desc limit 1
    ) from public.social_posts where id='${featureId}'`)).toBe("t");
  });

  it("rolls back Task 4 without touching Social posts or the profile graph", () => {
    const db = database!;
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.social_comments') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_notifications') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_posts') is not null")).toBe("t");
    expect(db.sql("select count(*) from public.profiles")).toBe("3");
    expect(db.sql("select count(*) from public.follows")).toBe("2");
  });
});
