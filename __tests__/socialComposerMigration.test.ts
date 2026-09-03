import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const POSTS = join(process.cwd(), "supabase/migrations/20260806145914_0072_social_posts.sql");
const INTERACTIONS = join(process.cwd(), "supabase/migrations/20260806150000_0073_social_interactions.sql");
const FORWARD = join(process.cwd(), "supabase/migrations/20260806151000_0074_social_composer.sql");
const ADMIN_MODERATION = join(process.cwd(), "supabase/migrations/20260829120000_0123_social_admin_moderation.sql");
const ADMIN_REVISION_GUARD = join(process.cwd(), "supabase/migrations/20260830120000_0124_social_admin_revision_guard.sql");
const ADMIN_MODERATION_ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260829120000_0123_social_admin_moderation_rollback.sql");
const ADMIN_REVISION_GUARD_ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260830120000_0124_social_admin_revision_guard_rollback.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260806151000_0074_social_composer_rollback.sql");

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
type Database = {
  sql(statement: string): string;
  sqlAsync(statement: string): Promise<string>;
  apply(path: string): void;
  applyTransactional(path: string): void;
  stop(): Promise<void>;
};
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
  const directory = mkdtempSync(join(tmpdir(), "pubmax-social-composer-"));
  const port = await freePort();
  execFileSync(initdb, [
    "-D", directory, "--auth=trust", "--username=postgres",
    "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
  ], { stdio: "pipe" });
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
  const run = (args: string[]) => execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    async sqlAsync(statement) {
      const { stdout } = await execFileAsync(psql, [
        ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement,
      ], { encoding: "utf8" });
      return stdout.trim();
    },
    apply: (path) => run(["-f", path]),
    applyTransactional: (path) => run(["-1", "-f", path]),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([new Promise<void>((resolve) => server.once("exit", resolve)), sleep(1_000)]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";
const MEDIA_REPLAY = "55555555-5555-4555-8555-555555555555";
const MEDIA_TWO = "66666666-6666-4666-8666-666666666666";
const MEDIA_REPLACED = "77777777-7777-4777-8777-777777777777";
const MEDIA_CLEANUP = "99999999-9999-4999-8999-999999999999";
const MEDIA_STALE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let postId = "";
let retryPostId = "";
let mediaObjectKey = "";
let staleAdminPostId = "";

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
      unique(follower_id,followee_id)
    );
    insert into public.profiles(id,handle) values
      ('${ALICE}','alice'), ('${BOB}','bob'), ('${CAROL}','carol');
    insert into public.follows(follower_id,followee_id) values
      ('${ALICE}','${BOB}'), ('${BOB}','${ALICE}');
  `);
  database.apply(POSTS);
  database.apply(INTERACTIONS);
}, 60_000);

afterAll(async () => database?.stop());

describe("Social composer migration forward, concurrency, and rollback", () => {
  it("applies atomic private media, audit, tags, moderation, and service-only authority", () => {
    const db = database!;
    const legacy = db.sql(`insert into public.social_posts(author_profile_id,author_handle,kind,visibility,body,comment_policy,photo_media_id,photo_alt_text)
      values('${ALICE}','alice','standard','friends','Legacy photo','open','77777777-7777-4777-8777-777777777777','Legacy') returning id`);
    expect(() => db.applyTransactional(FORWARD)).toThrow(/requires Task 3 photo_media_id rows to be null/i);
    db.sql(`delete from public.social_posts where id='${legacy}'`);
    db.apply(FORWARD);
    db.apply(ADMIN_MODERATION);
    db.apply(ADMIN_REVISION_GUARD);
    mediaObjectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA}','${"a".repeat(64)}',1200,800,12345
    )`);
    postId = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','public','Photo night','camden','venue-canonical',
      array['night'],'friends','${MEDIA}','${mediaObjectKey}',
      '${"a".repeat(64)}',1200,800,12345,'Alice and Bob outside the Venue',array['bob']
    )`);
    expect(db.sql(`select photo_media_id from public.social_posts where id='${postId}'`)).toBe(MEDIA);
    expect(db.sql(`select owner_profile_id || ':' || moderation_state from public.social_post_media where id='${MEDIA}'`))
      .toBe(`${ALICE}:pending`);
    expect(db.sql(`select count(*) from public.social_post_media_uploads where media_id='${MEDIA}'`)).toBe("0");
    expect(db.sql(`select coalesce((select object_key from public.claim_social_post_media_upload_cleanup(
      '${ALICE}','${MEDIA}',(select generation from public.social_post_media where id='${MEDIA}'))),'committed')`))
      .toBe("committed");
    expect(db.sql(`select media_id || ':' || moderation_claim from public.social_post_moderation_jobs where post_id='${postId}'`))
      .toBe(`${MEDIA}:Photo night\n\n#night\n\nPhoto: Alice and Bob outside the Venue`);
    expect(db.sql(`select state from public.social_post_tag_proposals where post_id='${postId}' and target_profile_id='${BOB}'`))
      .toBe("proposed");
    expect(db.sql(`select body from public.read_social_post_outbox_item('${postId}','${ALICE}')`)).toBe("Photo night");
    expect(db.sql(`select count(*) from public.read_social_post('${postId}','${BOB}')`)).toBe("0");
    expect(db.sql("select has_table_privilege('authenticated','public.social_post_media','select')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated','public.create_social_post(uuid,text,text,text,text,text,text,text[],text,uuid,text,text,integer,integer,integer,text,text[])','execute')")).toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.set_social_comment_policy(uuid,uuid,text)','execute')")).toBe("f");
  });

  it("projects exact public Venue only to author or current mutual friends and inherits blocks", () => {
    const db = database!;
    db.sql(`update public.social_posts set moderation_state='approved' where id='${postId}'`);
    expect(db.sql(`select venue_id from public.read_social_post('${postId}','${ALICE}')`)).toBe("venue-canonical");
    expect(db.sql(`select venue_id from public.read_social_post('${postId}','${BOB}')`)).toBe("venue-canonical");
    expect(db.sql(`select coalesce(venue_id,'hidden') from public.read_social_post('${postId}','${CAROL}')`)).toBe("hidden");
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',true)`);
    expect(db.sql(`select count(*) from public.read_social_post('${postId}','${BOB}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_feed('${BOB}','discover',null,null,null,20)`)).toBe("0");
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',false)`);
  });

  it("deduplicates lost-response create retries and rejects changed payloads", () => {
    const db = database!;
    const call = (digest: string) => `select id from public.create_social_post_idempotent(
      '${ALICE}','alice','standard','friends','Retry-safe',null,null,array[]::text[],'open',
      null,null,null,null,null,null,null,array[]::text[],'retry-key-1234567890','${digest}'
    )`;
    retryPostId = db.sql(call("b".repeat(64)));
    expect(db.sql(call("b".repeat(64)))).toBe(retryPostId);
    expect(db.sql(`select count(*) from public.social_posts where id='${retryPostId}'`)).toBe("1");
    expect(() => db.sql(call("c".repeat(64)))).toThrow(/idempotency conflict/i);
  });

  it("returns a committed photo replay before validating absent upload metadata", () => {
    const db = database!;
    const digest = "9".repeat(64);
    const objectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA_REPLAY}','${"5".repeat(64)}',640,480,900
    )`);
    const created = db.sql(`select id from public.create_social_post_idempotent(
      '${ALICE}','alice','standard','friends','Photo replay',null,null,array[]::text[],'open',
      '${MEDIA_REPLAY}','${objectKey}','${"5".repeat(64)}',640,480,900,'Same photo',array[]::text[],
      'photo-replay-key-1234','${digest}'
    )`);

    expect(db.sql(`select id from public.create_social_post_idempotent(
      '${ALICE}','alice','standard','friends','Photo replay',null,null,array[]::text[],'open',
      null,null,null,null,null,null,'Same photo',array[]::text[],
      'photo-replay-key-1234','${digest}'
    )`)).toBe(created);
    expect(db.sql(`select count(*) from public.social_posts where id='${created}'`)).toBe("1");
    expect(db.sql(`select count(*) from public.social_post_media where id='${MEDIA_REPLAY}'`)).toBe("1");
    db.sql(`update public.social_post_moderation_jobs set state='done' where post_id='${created}'`);
  });

  it("atomically assigns abandoned upload cleanup against a concurrent create", () => {
    const db = database!;
    const objectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA_CLEANUP}','${"8".repeat(64)}',300,200,500
    )`);
    db.sql(`update public.social_post_media_uploads set created_at=now()-interval '2 days' where media_id='${MEDIA_CLEANUP}'`);
    const generation = db.sql(`select generation from public.social_post_media_uploads where media_id='${MEDIA_CLEANUP}'`);
    expect(db.sql(`select object_key from public.claim_social_post_media_upload_cleanup('${ALICE}','${MEDIA_CLEANUP}','${generation}')`))
      .toBe(objectKey);
    expect(db.sql(`select state from public.social_post_media_uploads where media_id='${MEDIA_CLEANUP}'`)).toBe("cleanup");
    expect(() => db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','private','Too late',null,null,array[]::text[],'locked',
      '${MEDIA_CLEANUP}','${objectKey}','${"8".repeat(64)}',300,200,500,'Too late',array[]::text[]
    )`)).toThrow(/invalid Social photo reservation/i);
    db.sql(`update public.social_post_media_uploads set cleanup_lease_until=now()-interval '1 second' where media_id='${MEDIA_CLEANUP}'`);
    expect(db.sql(`select media_id from public.claim_social_post_media_upload_cleanup_batch(10,now()-interval '1 day')
      where media_id='${MEDIA_CLEANUP}'`)).toBe(MEDIA_CLEANUP);
    db.sql(`select public.finalize_social_post_media_upload_cleanup(
      '${MEDIA_CLEANUP}','${generation}',(select cleanup_token from public.social_post_media_uploads where media_id='${MEDIA_CLEANUP}')
    )`);
  });

  it("fences upload cleanup by generation and lease across an exact retry", () => {
    const db = database!;
    const media = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = db.sql(`select generation::text || '|' || object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${media}','${"7".repeat(64)}',320,240,700
    )`);
    const [generationA, objectA] = first.split("|");
    const claimA = db.sql(`select generation::text || '|' || object_key || '|' || cleanup_token::text
      from public.claim_social_post_media_upload_cleanup('${ALICE}','${media}','${generationA}')`);
    const [, claimedObjectA, tokenA] = claimA.split("|");
    expect(claimedObjectA).toBe(objectA);
    db.sql(`update public.social_post_media_uploads set cleanup_lease_until=now()-interval '1 second'
      where media_id='${media}' and generation='${generationA}'`);
    const claimB = db.sql(`select generation::text || '|' || object_key || '|' || cleanup_token::text
      from public.claim_social_post_media_upload_cleanup_batch(10,now()-interval '1 day') where media_id='${media}'`);
    const [, claimedObjectB, tokenB] = claimB.split("|");
    expect(claimedObjectB).toBe(objectA);
    expect(tokenB).not.toBe(tokenA);
    expect(db.sql(`select public.finalize_social_post_media_upload_cleanup('${media}','${generationA}','${tokenB}')`)).toBe("t");

    const retry = db.sql(`select generation::text || '|' || object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${media}','${"7".repeat(64)}',320,240,700
    )`);
    const [generationB, objectB] = retry.split("|");
    expect(generationB).not.toBe(generationA);
    expect(objectB).not.toBe(objectA);
    const retriedPost = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','private','Retry after cleanup',null,null,array[]::text[],'locked',
      '${media}','${objectB}','${"7".repeat(64)}',320,240,700,'A pub table',array[]::text[]
    )`);
    expect(db.sql(`select object_key from public.social_post_media where id='${media}'`)).toBe(objectB);
    expect(db.sql(`select public.finalize_social_post_media_upload_cleanup('${media}','${generationA}','${tokenA}')`)).toBe("f");
    expect(db.sql(`select object_key from public.social_post_media where id='${media}'`)).toBe(objectB);
    db.sql(`delete from public.social_post_moderation_jobs where post_id='${retriedPost}';
      update public.social_posts set photo_media_id=null,photo_alt_text=null where id='${retriedPost}';
      delete from public.social_post_media where id='${media}'`);
  });

  it("races comment-policy edits through one CAS and immutable digest audit", async () => {
    const db = database!;
    const edit = (commentPolicy: string) => `select count(*) from public.edit_social_post(
      '${postId}','${ALICE}',0,'standard','public','Photo night','camden','venue-canonical',
      array['night'],'${commentPolicy}','${MEDIA}','Alice and Bob outside the Venue',false
    )`;
    const first = db.sqlAsync(`begin; ${edit("open")}; select pg_sleep(1); commit`);
    const second = db.sqlAsync(edit("locked"));
    const outcomes = (await Promise.all([first, second]))
      .flatMap((output) => output.split("\n").filter((line) => line === "0" || line === "1"))
      .sort();
    expect(outcomes).toEqual(["0", "1"]);
    expect(db.sql(`select revision || ':' || mutation_version || ':' || moderation_state from public.social_posts where id='${postId}'`))
      .toBe("0:1:approved");
    expect(db.sql(`select from_mutation_version || ':' || to_mutation_version || ':' || array_to_string(changed_fields,',') || ':' || length(previous_digest) || ':' || length(next_digest)
      from public.social_post_edit_audit where post_id='${postId}'`))
      .toMatch(/^0:1:commentPolicy:64:64$/);
    expect(() => db.sql(`delete from public.social_post_edit_audit where post_id='${postId}'`)).toThrow();
    expect(() => db.sql(`update public.social_post_edit_audit set changed_fields=array['body'] where post_id='${postId}'`)).toThrow();
  });

  it("removes a post once with mutation_version CAS and an idempotent retry", () => {
    const db = database!;
    const call = `select public.remove_social_post_idempotent('${retryPostId}','${ALICE}',0,'remove-key-1234567890')`;
    expect(db.sql(call)).toBe("t");
    expect(db.sql(call)).toBe("t");
    expect(db.sql(`select status || ':' || revision || ':' || mutation_version || ':' || (photo_media_id is null) from public.social_posts where id='${retryPostId}'`)).toBe("removed:0:1:true");
    expect(db.sql(`select count(*) || ':' || min(from_mutation_version) || ':' || max(to_mutation_version) from public.social_post_edit_audit where post_id='${retryPostId}'`)).toBe("1:0:1");
    expect(() => db.sql(`select public.remove_social_post_idempotent('${postId}','${ALICE}',1,'remove-key-1234567890')`))
      .toThrow(/idempotency conflict/i);
  });

  it("fences moderation completion by lease, then keeps tag identity consent reversible", () => {
    const db = database!;
    // Pin content revision to the job claim: non-content edits only bump mutation_version.
    db.sql(`update public.social_posts set moderation_state='pending',revision=1 where id='${postId}'`);
    db.sql(`update public.social_post_moderation_jobs set state='pending',revision=1,next_attempt_at=now() where post_id='${postId}'`);
    const firstLease = db.sql(`select lease_token from public.claim_social_post_moderation_jobs(1) where post_id='${postId}'`);
    db.sql(`update public.social_post_moderation_jobs set lease_until=now()-interval '1 second' where post_id='${postId}'`);
    const secondLease = db.sql(`select lease_token from public.claim_social_post_moderation_jobs(1) where post_id='${postId}'`);
    expect(secondLease).not.toBe(firstLease);
    expect(db.sql(`select public.complete_social_post_moderation_job('${postId}',1,'${MEDIA}','${firstLease}','approved',null,null)`)).toBe("f");
    expect(db.sql(`select moderation_state from public.social_posts where id='${postId}'`)).toBe("pending");
    expect(db.sql(`select state from public.social_post_moderation_jobs where post_id='${postId}'`)).toBe("processing");
    expect(db.sql(`select public.complete_social_post_moderation_job('${postId}',1,'${MEDIA}','${secondLease}','approved',null,null)`)).toBe("t");
    db.sql(`update public.social_posts set visibility='friends' where id='${postId}'`);
    const proposal = db.sql(`select id from public.social_post_tag_proposals where post_id='${postId}' and target_profile_id='${BOB}'`);
    const reviewedRevision = db.sql(`select review_revision from public.read_social_tag_inbox('${BOB}','proposed',null,null,20) where proposal_id='${proposal}'`);
    db.sql(`update public.social_posts set revision=revision+1 where id='${postId}'`);
    expect(() => db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve',${reviewedRevision})`))
      .toThrow(/audience changed/i);
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve',${Number(reviewedRevision) + 1})`)).toBe("t");
    expect(db.sql(`select audience_visibility || ':' || audience_revision || ':' || (audience_shown_at is not null)
      from public.social_post_tag_proposals where id='${proposal}'`)).toBe("friends:2:true");
    expect(db.sql(`select handle from public.read_social_post_tags('${BOB}','${postId}')`)).toBe("bob");
    db.sql(`update public.social_posts set visibility='public' where id='${postId}'`);
    expect(db.sql(`select count(*) from public.read_social_post_tags('${CAROL}','${postId}')`)).toBe("0");
    db.sql(`update public.social_posts set visibility='friends' where id='${postId}'`);
    expect(db.sql(`select handle from public.read_social_post_tags('${BOB}','${postId}')`)).toBe("bob");
    db.sql(`select public.set_social_block('${BOB}','${ALICE}',true)`);
    expect(db.sql(`select count(*) from public.read_social_post_tags('${BOB}','${postId}')`)).toBe("0");
    db.sql(`select public.set_social_block('${BOB}','${ALICE}',false)`);
    expect(() => db.sql(`select public.act_social_post_tag('${CAROL}','${proposal}','approve')`)).toThrow();
    const blockedProposal = db.sql(`insert into public.social_post_tag_proposals(post_id,media_id,author_profile_id,target_profile_id)
      values('${postId}','${MEDIA}','${ALICE}','${CAROL}') returning id`);
    db.sql(`select public.set_social_block('${ALICE}','${CAROL}',true)`);
    expect(() => db.sql(`select public.act_social_post_tag('${CAROL}','${blockedProposal}','approve',2)`)).toThrow(/tag action not allowed/i);
    expect(db.sql(`select state from public.social_post_tag_proposals where id='${blockedProposal}'`)).toBe("proposed");
    db.sql(`select public.set_social_block('${ALICE}','${CAROL}',false)`);
    db.sql(`select public.act_social_post_tag('${ALICE}','${blockedProposal}','cancel')`);
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','withdraw')`)).toBe("t");
    expect(db.sql(`select count(*) from public.read_social_post_tags('${CAROL}','${postId}')`)).toBe("0");
    expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_tag_events where proposal_id='${proposal}'`))
      .toBe("propose,approve,withdraw");
  });

  it("pages approved tag consent and allows target-only review of exact moderated media", () => {
    const db = database!;
    db.sql(`update public.social_post_tag_proposals set state='approved',decided_at=now(),audience_visibility='private',audience_revision=1,audience_shown_at=now()
      where post_id='${postId}' and target_profile_id='${BOB}'`);
    db.sql(`update public.social_posts set visibility='private',status='visible',moderation_state='approved' where id='${postId}'`);
    db.sql(`update public.social_post_media set moderation_state='approved',attachment_state='active' where id='${MEDIA}'`);
    expect(db.sql(`select count(*) from public.read_social_post('${postId}','${BOB}')`)).toBe("0");
    expect(db.sql(`select object_key from public.read_social_post_media('${BOB}','${MEDIA}')`))
      .toBe(mediaObjectKey);
    expect(db.sql(`select author_handle || ':' || visibility || ':' || photo_alt_text
      from public.read_social_tag_inbox('${BOB}','approved',null,null,1)`))
      .toBe("alice:private:Alice and Bob outside the Venue");
    expect(db.sql(`select (to_jsonb(inbox) ? 'body')::text from
      public.read_social_tag_inbox('${BOB}','approved',null,null,1) inbox`)).toBe("false");
  });

  it("requires fresh tag consent after every audience change", () => {
    const db = database!;
    const media = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const reservation = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${media}','${"6".repeat(64)}',500,400,900
    )`);
    const taggedPost = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','friends','Audience change',null,null,array[]::text[],'friends',
      '${media}','${reservation}','${"6".repeat(64)}',500,400,900,'Alice and Bob',array['bob']
    )`);
    db.sql(`update public.social_posts set moderation_state='approved' where id='${taggedPost}';
      update public.social_post_media set moderation_state='approved' where id='${media}'`);
    const proposal = db.sql(`select id from public.social_post_tag_proposals where post_id='${taggedPost}'`);
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve',0)`)).toBe("t");
    expect(db.sql(`select count(*) from public.edit_social_post(
      '${taggedPost}','${ALICE}',0,'standard','public','Audience change',null,null,array[]::text[],'friends',
      '${media}','Alice and Bob',false
    )`)).toBe("1");
    expect(db.sql(`select state || ':' || (audience_visibility is null) || ':' || (audience_revision is null)
      from public.social_post_tag_proposals where id='${proposal}'`)).toBe("proposed:true:true");
    expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_tag_events where proposal_id='${proposal}'`))
      .toBe("propose,approve,audience_change");
    expect(db.sql(`select count(*) from public.read_social_tag_inbox('${BOB}','proposed',null,null,20) where proposal_id='${proposal}'`)).toBe("1");
    // Content revision stays 0 on visibility-only mutation; audience gate still tracks content revision.
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve',0)`)).toBe("t");
    expect(db.sql(`select count(*) from public.edit_social_post(
      '${taggedPost}','${ALICE}',1,'standard','private','Audience change',null,null,array[]::text[],'friends',
      '${media}','Alice and Bob',false
    )`)).toBe("1");
    expect(db.sql(`select state || ':' || coalesce(audience_visibility,'cleared')
      from public.social_post_tag_proposals where id='${proposal}'`)).toBe("proposed:cleared");
  });

  it("keeps approved withdrawal management through moderation, hiding, detachment, and purge", () => {
    const db = database!;
    const media = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const reservation = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${media}','${"5".repeat(64)}',500,400,900
    )`);
    const taggedPost = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','friends','Withdrawal history',null,null,array[]::text[],'friends',
      '${media}','${reservation}','${"5".repeat(64)}',500,400,900,'Alice and Bob',array['bob']
    )`);
    db.sql(`update public.social_posts set moderation_state='approved' where id='${taggedPost}';
      update public.social_post_media set moderation_state='approved' where id='${media}'`);
    const proposal = db.sql(`select id from public.social_post_tag_proposals where post_id='${taggedPost}'`);
    db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','approve',0)`);
    for (const moderation of ["pending", "needs_review"] as const) {
      db.sql(`update public.social_posts set moderation_state='${moderation}' where id='${taggedPost}'`);
      expect(db.sql(`select count(*) || ':' || bool_and(media_id is null)::text
        from public.read_social_tag_inbox('${BOB}','approved',null,null,20)
        where proposal_id='${proposal}'`)).toBe("1:true");
      expect(db.sql(`select count(*) from public.read_social_post_media('${BOB}','${media}')`)).toBe("0");
    }
    db.sql(`select public.set_social_block('${BOB}','${ALICE}',true)`);
    expect(db.sql(`select count(*) || ':' || bool_and(media_id is null)::text
      from public.read_social_tag_inbox('${BOB}','approved',null,null,20)
      where proposal_id='${proposal}'`)).toBe("1:true");
    db.sql(`select public.set_social_block('${BOB}','${ALICE}',false)`);
    db.sql(`update public.social_posts set status='hidden' where id='${taggedPost}'`);
    expect(db.sql(`select count(*) from public.read_social_tag_inbox('${BOB}','approved',null,null,20)
      where proposal_id='${proposal}'`)).toBe("1");
    db.sql(`delete from public.social_post_moderation_jobs where post_id='${taggedPost}';
      update public.social_posts set photo_media_id=null,photo_alt_text=null where id='${taggedPost}';
      update public.social_post_media set attachment_state='detached',retention_expires_at=now()-interval '1 second' where id='${media}'`);
    expect(db.sql(`select count(*) from public.read_social_tag_inbox('${BOB}','approved',null,null,20)
      where proposal_id='${proposal}'`)).toBe("1");
    db.sql(`delete from public.social_post_media where id='${media}'`);
    expect(db.sql(`select count(*) || ':' || bool_and(media_id is null)::text from
      public.read_social_tag_inbox('${BOB}','approved',null,null,20) where proposal_id='${proposal}'`)).toBe("1:true");
    expect(db.sql(`select public.act_social_post_tag('${BOB}','${proposal}','withdraw')`)).toBe("t");
  });

  it("reaches approved consent older than the first page", () => {
    const db = database!;
    db.sql(`do $$
      declare i integer; v_media uuid; v_generation uuid; v_post uuid;
      begin
        for i in 1..55 loop
          v_media := gen_random_uuid();
          v_generation := gen_random_uuid();
          insert into public.social_post_media(id,generation,owner_profile_id,object_key,sha256,width,height,byte_size,moderation_state)
          values(v_media,v_generation,'${ALICE}','social/' || v_media::text || '/' || v_generation::text || '/image.jpg','${"9".repeat(64)}',200,200,400,'approved');
          insert into public.social_posts(author_profile_id,author_handle,kind,visibility,body,comment_policy,
            photo_media_id,photo_alt_text,moderation_state,created_at,updated_at)
          values('${ALICE}','alice','standard','private','Approved history ' || i,'locked',v_media,'History photo','approved',
            now()-make_interval(secs=>i),now()-make_interval(secs=>i)) returning id into v_post;
          insert into public.social_post_tag_proposals(post_id,media_id,author_profile_id,target_profile_id,state,
            audience_visibility,audience_revision,audience_shown_at,created_at,decided_at)
          values(v_post,v_media,'${ALICE}','${BOB}','approved','private',0,now()-make_interval(secs=>i),
            now()-make_interval(secs=>i),now()-make_interval(secs=>i));
        end loop;
      end $$`);
    const boundary = db.sql(`select created_at::text || '|' || proposal_id::text from
      public.read_social_tag_inbox('${BOB}','approved',null,null,51) offset 49 limit 1`);
    const [createdAt, id] = boundary.split("|");
    expect(db.sql(`select count(*) from public.read_social_tag_inbox('${BOB}','approved','${createdAt}','${id}',51)`))
      .not.toBe("0");
    const ownerBoundary = db.sql(`select created_at::text || '|' || id::text from
      public.read_social_post_outbox('${ALICE}',null,null,3) offset 1 limit 1`);
    const [ownerCreatedAt, ownerId] = ownerBoundary.split("|");
    expect(db.sql(`select count(*) from public.read_social_post_outbox('${ALICE}','${ownerCreatedAt}','${ownerId}',3)`))
      .not.toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_outbox('${ALICE}',null,null,51)
      where visibility='private' and moderation_state='approved'`)).not.toBe("0");
  });

  it("removes pending, held, and approved photos without leaving blocking jobs", () => {
    const db = database!;
    const states = ["pending", "needs_review", "approved"] as const;
    for (let index = 0; index < states.length; index += 1) {
      const media = `88888888-8888-4888-8${index}88-88888888888${index}`;
      const objectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
        '${ALICE}','${media}','${String(index + 1).repeat(64)}',400,300,800
      )`);
      const created = db.sql(`select id from public.create_social_post(
        '${ALICE}','alice','standard','private','Remove ${states[index]}',null,null,array[]::text[],'locked',
        '${media}','${objectKey}','${String(index + 1).repeat(64)}',400,300,800,'Remove me',array[]::text[]
      )`);
      db.sql(`update public.social_posts set moderation_state='${states[index]}' where id='${created}';
        update public.social_post_media set moderation_state='${states[index]}' where id='${media}'`);
      expect(db.sql(`select public.remove_social_post_idempotent('${created}','${ALICE}',0,'remove-state-${states[index]}-key')`)).toBe("t");
      expect(db.sql(`select count(*) from public.social_post_moderation_jobs where post_id='${created}'`)).toBe("0");
      expect(db.sql(`select array_to_string(changed_fields,',') from public.social_post_edit_audit where post_id='${created}'`))
        .toBe("status,photo,photoAltText");
      expect(db.sql(`select media_id || ':' || post_id || ':' || actor_profile_id || ':' || action || ':' || (retention_expires_at is not null)
        from public.social_post_media_lifecycle_events where media_id='${media}'`))
        .toBe(`${media}:${created}:${ALICE}:detached:true`);
      db.sql(`update public.social_post_media set retention_expires_at=now()-interval '1 second' where id='${media}'`);
      const cleanup = db.sql(`select generation::text || '|' || cleanup_token::text
        from public.claim_social_post_media_cleanup_batch(10) where media_id='${media}'`);
      const [generation, cleanupToken] = cleanup.split("|");
      expect(db.sql(`select public.finalize_social_post_media_cleanup('${media}','${generation}','${cleanupToken}')`)).toBe("t");
      expect(db.sql(`select count(*) from public.social_post_media where id='${media}'`)).toBe("0");
      expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_media_lifecycle_events where media_id='${media}'`))
        .toBe("detached,purged");
    }
    expect(() => db.sql(`delete from public.social_post_media_lifecycle_events where action='detached'`)).toThrow(/append-only/i);
  });

  it("does not claim moderation work for a non-visible post", () => {
    const db = database!;
    const hidden = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','private','Hidden pending',null,null,array[]::text[],'locked',
      null,null,null,null,null,null,null,array[]::text[]
    )`);
    db.sql(`update public.social_posts set status='hidden' where id='${hidden}';
      update public.social_post_moderation_jobs set state='pending',next_attempt_at=now() where post_id='${hidden}'`);
    expect(db.sql(`select count(*) from public.claim_social_post_moderation_jobs(50) where post_id='${hidden}'`)).toBe("0");
  });

  it("gives named staff a held post and media workflow", () => {
    const db = database!;
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role,active)
      values ('55555555-5555-4555-8555-555555555555','${CAROL}','Carol Smith','moderator',true)`);
    db.sql(`update public.social_post_moderation_jobs set state='done' where post_id='${postId}';
      update public.social_posts set moderation_state='needs_review' where id='${postId}'`);
    db.sql(`update public.social_post_media set moderation_state='needs_review' where id='${MEDIA}'`);
    expect(db.sql(`select staff_display_name || ':' || post_id || ':' || media_id from public.read_social_post_moderation_queue('${CAROL}',20)`))
      .toBe(`Carol Smith:${postId}:${MEDIA}`);
    expect(db.sql(`select public.moderate_social_post('${CAROL}','${postId}','${MEDIA}','approve')`)).toBe("t");
    expect(db.sql(`select moderation_state from public.social_posts where id='${postId}'`)).toBe("approved");
    expect(db.sql(`select staff_role_id from public.social_post_moderation_actions where post_id='${postId}'`))
      .toBe("55555555-5555-4555-8555-555555555555");

    const staleObjectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA_STALE}','${"a".repeat(64)}',400,300,800
    )`);
    const stalePostId = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','private','Needs another review',null,null,array[]::text[],'locked',
      '${MEDIA_STALE}','${staleObjectKey}','${"a".repeat(64)}',400,300,800,'Stale photo',array[]::text[]
    )`);
    db.sql(`update public.social_posts set moderation_state='approved' where id='${stalePostId}';
      update public.social_post_media set moderation_state='needs_review' where id='${MEDIA_STALE}';
      update public.social_post_moderation_jobs set state='done' where post_id='${stalePostId}';
      update public.social_posts set body='Edited after photo review',revision=revision+1,moderation_state='pending',updated_at=now()
      where id='${stalePostId}'`);
    expect(db.sql(`select count(*) from public.read_social_post_moderation_queue_admin('55555555-5555-4555-8555-555555555555',20) where post_id='${stalePostId}'`))
      .toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_media_admin('55555555-5555-4555-8555-555555555555','${MEDIA_STALE}')`)).toBe("0");
    expect(db.sql(`select public.moderate_social_post_admin('55555555-5555-4555-8555-555555555555','${stalePostId}','${MEDIA_STALE}','approve')`)).toBe("f");
    expect(db.sql(`select moderation_state || ':' || (select moderation_state from public.social_post_media where id='${MEDIA_STALE}')
      from public.social_posts where id='${stalePostId}'`)).toBe("pending:needs_review");
  });

  it("binds admin moderation to revision zero and disables the legacy overload", () => {
    const db = database!;
    const staffRoleId = "55555555-5555-4555-8555-555555555555";
    db.sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role,active)
      values ('${staffRoleId}','${CAROL}','Carol Smith','moderator',true)
      on conflict (id) do nothing`);
    const currentPostId = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','public','Revision zero',null,null,array[]::text[],'open',
      null,null,null,null,null,null,null,array[]::text[]
    )`);
    db.sql(`update public.social_post_moderation_jobs set state='done' where post_id='${currentPostId}';
      update public.social_posts set moderation_state='needs_review' where id='${currentPostId}'`);

    expect(db.sql(`select revision from public.social_posts where id='${currentPostId}'`)).toBe("0");
    expect(db.sql(`select public.moderate_social_post_admin('${staffRoleId}','${currentPostId}',null,'approve')`))
      .toBe("f");
    expect(db.sql(`select moderation_state || ':' || count(*) over () from public.social_posts
      where id='${currentPostId}'`)).toBe("needs_review:1");
    expect(db.sql(`select count(*) from public.social_post_moderation_actions where post_id='${currentPostId}'`))
      .toBe("0");

    expect(db.sql(`select public.moderate_social_post_admin('${staffRoleId}','${currentPostId}',null,0,'approve')`))
      .toBe("t");
    expect(db.sql(`select moderation_state from public.social_posts where id='${currentPostId}'`))
      .toBe("approved");

    staleAdminPostId = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','public','Stale revision',null,null,array[]::text[],'open',
      null,null,null,null,null,null,null,array[]::text[]
    )`);
    db.sql(`update public.social_posts set revision=1,moderation_state='needs_review' where id='${staleAdminPostId}';
      update public.social_post_moderation_jobs set
        revision=1,media_id=null,moderation_claim='Current revision',state='done'
      where post_id='${staleAdminPostId}'`);
    expect(db.sql(`select public.moderate_social_post_admin('${staffRoleId}','${staleAdminPostId}',null,0,'hide')`))
      .toBe("f");
    expect(db.sql(`select status || ':' || moderation_state || ':' || revision from public.social_posts
      where id='${staleAdminPostId}'`)).toBe("visible:needs_review:1");
    expect(db.sql(`select count(*) from public.social_post_moderation_actions where post_id='${staleAdminPostId}'`))
      .toBe("0");

    expect(db.sql("select to_regprocedure('public.moderate_social_post_admin(uuid,uuid,uuid,text)') is not null"))
      .toBe("t");
    expect(db.sql("select to_regprocedure('public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)') is not null"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('service_role','public.moderate_social_post_admin(uuid,uuid,uuid,text)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('service_role','public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)','execute')"))
      .toBe("t");
    expect(db.sql("select has_function_privilege('anon','public.moderate_social_post_admin(uuid,uuid,uuid,text)','execute')"))
      .toBe("f");
    expect(db.sql("select has_function_privilege('authenticated','public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)','execute')"))
      .toBe("f");
  });

  it("records cancellation and proposal events and notifications on photo replacement", () => {
    const db = database!;
    const replacedObjectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA_REPLACED}','${"f".repeat(64)}',800,600,1000
    )`);
    const replacementPost = db.sql(`select id from public.create_social_post(
      '${ALICE}','alice','standard','public','Replacement proof',null,null,array[]::text[],'open',
      '${MEDIA_REPLACED}','${replacedObjectKey}','${"f".repeat(64)}',800,600,1000,'Old photo',array['carol']
    )`);
    db.sql(`insert into public.social_post_create_requests(author_profile_id,idempotency_key,request_digest,post_id,media_id)
      values('${ALICE}','media-request-key-1234','${"e".repeat(64)}','${replacementPost}','${MEDIA_REPLACED}')`);
    const oldProposal = db.sql(`select id from public.social_post_tag_proposals where post_id='${replacementPost}' and target_profile_id='${CAROL}'`);
    const replacementObjectKey = db.sql(`select object_key from public.reserve_social_post_media_upload(
      '${ALICE}','${MEDIA_TWO}','${"d".repeat(64)}',800,600,1000
    )`);
    expect(db.sql(`select count(*) from public.edit_social_post_with_media(
      '${replacementPost}','${ALICE}',0,'standard','public','Replacement proof',null,null,array[]::text[],'open',
      '${MEDIA_TWO}','Replacement photo',true,'${replacementObjectKey}','${"d".repeat(64)}',800,600,1000,array['bob'])`)).toBe("1");
    expect(db.sql(`select state from public.social_post_tag_proposals where id='${oldProposal}'`)).toBe("cancelled");
    expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_tag_events where proposal_id='${oldProposal}'`)).toBe("propose,cancel");
    expect(db.sql(`select count(*) from public.social_post_tag_events event join public.social_post_tag_proposals proposal on proposal.id=event.proposal_id
      where proposal.media_id='${MEDIA_TWO}' and event.action='propose'`)).toBe("1");
    expect(db.sql(`select count(*) from public.social_notifications where source_post_id='${replacementPost}' and kind='tag_proposal' and source_content_id in
      (select id from public.social_post_tag_proposals where media_id='${MEDIA_TWO}')`)).toBe("1");
    db.sql(`update public.social_post_media set retention_expires_at=now()-interval '1 day' where id='${MEDIA_REPLACED}'; delete from public.social_post_media where id='${MEDIA_REPLACED}'`);
    expect(db.sql(`select coalesce(media_id::text,'purged') from public.social_post_create_requests where idempotency_key='media-request-key-1234'`)).toBe("purged");
    expect(db.sql(`select state || ':' || (media_id is null) from public.social_post_tag_proposals where id='${oldProposal}'`))
      .toBe("cancelled:true");
    expect(db.sql(`select string_agg(action,',' order by created_at,id) from public.social_post_tag_events where proposal_id='${oldProposal}'`))
      .toBe("propose,cancel");
  });

  it("rolls back Task 6 state and restores Task 3 public-Venue and edit rules", () => {
    const db = database!;
    db.apply(ADMIN_REVISION_GUARD_ROLLBACK);
    expect(db.sql("select to_regprocedure('public.moderate_social_post_admin(uuid,uuid,uuid,integer,text)') is null"))
      .toBe("t");
    expect(db.sql("select to_regprocedure('public.moderate_social_post_admin(uuid,uuid,uuid,text)') is not null"))
      .toBe("t");
    expect(db.sql(`select public.moderate_social_post_admin(
      '55555555-5555-4555-8555-555555555555','${staleAdminPostId}',null,'hide'
    )`)).toBe("f");
    expect(db.sql(`select status || ':' || moderation_state || ':' || revision from public.social_posts
      where id='${staleAdminPostId}'`)).toBe("visible:needs_review:1");
    db.apply(ADMIN_MODERATION_ROLLBACK);
    db.apply(ROLLBACK);
    expect(db.sql("select to_regclass('public.social_post_media') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_media_lifecycle_events') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_edit_audit') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.social_post_tag_proposals') is null")).toBe("t");
    expect(db.sql("select to_regprocedure('public.reserve_social_post_media_upload(uuid,uuid,text,integer,integer,integer)') is null")).toBe("t");
    expect(db.sql("select to_regprocedure('public.finalize_social_post_media_upload_cleanup(uuid,uuid,uuid)') is null")).toBe("t");
    expect(db.sql("select to_regprocedure('public.finalize_social_post_media_cleanup(uuid,uuid,uuid)') is null")).toBe("t");
    expect(() => db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,venue_id,comment_policy
    ) values ('${ALICE}','alice','standard','public','Public Venue','venue-canonical','open')`)).toThrow();
    expect(db.sql("select to_regclass('public.social_blocks') is not null")).toBe("t");
    expect(db.sql("select count(*) from public.profiles")).toBe("3");
    const rollbackPost = db.sql(`insert into public.social_posts(
      author_profile_id,author_handle,kind,visibility,body,comment_policy,moderation_state
    ) values ('${ALICE}','alice','standard','public','Blocked after rollback','open','approved') returning id`);
    db.sql(`select public.set_social_block('${ALICE}','${BOB}',true)`);
    expect(db.sql(`select count(*) from public.read_social_post('${rollbackPost}','${BOB}')`)).toBe("0");
    expect(db.sql(`select count(*) from public.read_social_post_feed('${BOB}','discover',null,null,null,20) where id='${rollbackPost}'`)).toBe("0");
  });
});
