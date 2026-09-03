import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260821120000_0112_pint_drop_verified_reports.sql",
);
const REOPEN_MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260823130000_0116_reopen_pint_drop_review.sql",
);
const REOPEN_ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260823130000_0116_reopen_pint_drop_review_rollback.sql",
);
const TABLE_SEPARATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260824010000_0118_pint_drop_table_separation.sql",
);
const TABLE_SEPARATION_ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260824010000_0118_pint_drop_table_separation_rollback.sql",
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
  sqlAsync: (statement: string) => Promise<string>;
  expectRefusal: (statement: string) => string;
  apply: (path: string) => void;
  stop: () => Promise<void>;
};

async function startSession(): Promise<Session> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL 16 is required.");

    const dataDir = mkdtempSync(join(tmpdir(), "pubmax-pint-drop-0112-0116-"));
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
      "shared_buffers = 16MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );
  const processHandle = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: "ignore" },
  );
  const args = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];

  const teardown = async (): Promise<void> => {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
      if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    }
    rmSync(dataDir, { recursive: true, force: true });
  };

  const sql = (statement: string): string =>
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement], {
      encoding: "utf8",
    }).trim();

  const sqlAsync = (statement: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        psql,
        [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.once("exit", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr));
      });
    });

  const expectRefusal = (statement: string): string => {
    try {
      execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      return String((error as { stderr?: string | Buffer }).stderr ?? "");
    }
    throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
  };

  try {
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

    sql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.visit_reports (
        id uuid primary key,
        report_count integer not null default 0,
        verified_report_count integer not null default 0,
        reported_at timestamptz,
        report_reason text,
        moderated_at timestamptz,
        moderator_note text,
        status text not null default 'visible'
      );
      create table public.pint_drop_reports (
        id uuid primary key default gen_random_uuid(),
        pint_drop_id uuid not null references public.visit_reports(id),
        actor_hash text not null,
        reason text,
        unique (pint_drop_id, actor_hash)
      );
      create table public.profiles (
        id uuid primary key,
        handle text unique not null,
        cover_object_key text,
        cover_generation uuid,
        cover_moderation_state text,
        cover_moderated_at timestamptz,
        cover_moderator_note text,
        updated_at timestamptz not null default now()
      );
      create table public.profile_cover_photos (
        id uuid primary key,
        profile_id uuid not null references public.profiles(id),
        moderation_state text not null default 'approved',
        report_actors text[] not null default '{}',
        report_count integer not null default 0,
        reported_at timestamptz,
        report_reason text,
        moderated_at timestamptz,
        moderator_note text
      );
    `);
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", MIGRATION_PATH], {
      stdio: "pipe",
    });
    execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", REOPEN_MIGRATION_PATH], {
      stdio: "pipe",
    });
  } catch (error) {
    await teardown();
    throw error;
  }

  return {
    sql,
    sqlAsync,
    expectRefusal,
    apply: (path: string) => {
      execFileSync(psql, [...args, "-v", "ON_ERROR_STOP=1", "-f", path], {
        stdio: "pipe",
      });
    },
    stop: teardown,
  };
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return "PostgreSQL was deliberately hidden by PUBMAX_RLS_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter((name) => !binary(name));
  return missing.length > 0 ? `Missing PostgreSQL binaries: ${missing.join(", ")}.` : null;
}

let session: Session | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      `PINT DROP 0112 + 0116 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS: ${skipReason}`,
    );
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

describe("0112 verified ledger and 0116 report reopening", () => {
  it("does not let a legacy anonymous count hide a visible Pint Drop", () => {
    const id = "00000000-0000-4000-8000-000000000112";
      session!.sql(`
      insert into public.visit_reports (id, report_count) values ('${id}', 1);
      insert into public.pint_drop_reports (pint_drop_id, actor_hash)
      values ('${id}', 'mixed-legacy-actor');
    `);

    expect(
      session!.sql(
        `select public.report_pint_drop_v2('${id}', 'mixed-legacy-actor', 'wrong venue', 2)`,
      ),
    ).toBe("1");
    expect(
      session!.sql(
        `select verified_report_count || ':' || report_count || ':' || status from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("1:1:visible");
  });

  it("hides only after two distinct verified accounts and stays idempotent", () => {
    const id = "00000000-0000-4000-8000-000000000113";
    session!.sql(`insert into public.visit_reports (id, report_count) values ('${id}', 9)`);

    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-a', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-a', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-b', '', 2)`),
    ).toBe("2");
    expect(
      session!.sql(
        `select verified_report_count || ':' || report_count || ':' || status from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("2:9:hidden");
  });

  it("keeps the verified ledger service-role only", () => {
    expect(
      session!.expectRefusal(
        "set role anon; select count(*) from public.pint_drop_verified_reports",
      ),
    ).toContain("permission denied");
    expect(
      session!.expectRefusal(
        "set role authenticated; select public.report_pint_drop_v2(gen_random_uuid(), 'x', '', 2)",
      ),
    ).toContain("permission denied");
    expect(
      session!.sql(
        "set role service_role; select has_table_privilege('service_role', 'public.pint_drop_verified_reports', 'select')",
      ),
    ).toMatch(/t$/);
    expect(
      session!.sql(
        "select has_function_privilege('service_role', 'public.report_pint_drop_v2(uuid, text, text, integer)', 'execute')",
      ),
    ).toBe("t");
    expect(
      session!.sql(
        "select has_function_privilege('anon', 'public.report_pint_drop_v2(uuid, text, text, integer)', 'execute')",
      ),
    ).toBe("f");
    expect(
      session!.sql(
        "select has_function_privilege('authenticated', 'public.report_pint_drop_v2(uuid, text, text, integer)', 'execute')",
      ),
    ).toBe("f");
    expect(
      session!.sql(
        "select has_function_privilege('service_role', 'public.report_pint_drop_anonymous(uuid, text, text)', 'execute')",
      ),
    ).toBe("t");
    expect(
      session!.sql(
        "select has_function_privilege('anon', 'public.report_pint_drop_anonymous(uuid, text, text)', 'execute')",
      ),
    ).toBe("f");
    expect(
      session!.sql(
        "select has_function_privilege('authenticated', 'public.report_pint_drop_anonymous(uuid, text, text)', 'execute')",
      ),
    ).toBe("f");
    expect(session!.sql("select has_function_privilege('service_role', 'public.append_profile_cover_photo_report_actor(uuid, text, text)', 'execute')")).toBe("t");
    expect(session!.sql("select has_function_privilege('anon', 'public.append_profile_cover_photo_report_actor(uuid, text, text)', 'execute')")).toBe("f");
    expect(session!.sql("select has_function_privilege('authenticated', 'public.moderate_profile_cover_across_stores(text, text, text)', 'execute')")).toBe("f");
  });

  it("keeps simultaneous cover reports and moderates mirror plus rotation atomically", async () => {
    const profileId = "10000000-0000-4000-8000-000000000001";
    const coverId = "20000000-0000-4000-8000-000000000001";
    session!.sql(`
      insert into public.profiles (id, handle, cover_object_key, cover_generation, cover_moderation_state)
      values ('${profileId}', 'cover-owner', 'cover/key', '30000000-0000-4000-8000-000000000001', 'approved');
      insert into public.profile_cover_photos (id, profile_id) values ('${coverId}', '${profileId}');
    `);
    await Promise.all([
      session!.sqlAsync(`select public.append_profile_cover_photo_report_actor('${coverId}', 'actor-a', 'a')`),
      session!.sqlAsync(`select public.append_profile_cover_photo_report_actor('${coverId}', 'actor-b', 'b')`),
    ]);
    expect(session!.sql(`select report_count || ':' || cardinality(report_actors) from public.profile_cover_photos where id = '${coverId}'`)).toBe("2:2");
    expect(session!.sql("select public.moderate_profile_cover_across_stores('cover-owner', 'hidden', 'reviewed')")).toBe("t");
    expect(session!.sql(`select cover_moderation_state || ':' || (select moderation_state from public.profile_cover_photos where id = '${coverId}') from public.profiles where id = '${profileId}'`)).toBe("hidden:hidden");
  });

  it("requeues but keeps a moderator-hidden drop hidden for a new verified actor", () => {
    const id = "00000000-0000-4000-8000-000000000114";
    session!.sql(`
      insert into public.visit_reports (id, moderated_at, status, moderator_note)
      values ('${id}', '2026-08-23 08:00:00+00', 'hidden', 'old decision');
    `);

    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-new', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(
        `select (moderated_at is null)::text || ':' || verified_report_count || ':' || status || ':' || coalesce(moderator_note, '') from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("true:1:hidden:");

    session!.sql(`update public.visit_reports set moderated_at = '2026-08-23 08:30:00+00' where id = '${id}'`);
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-new', 'duplicate', 2)`),
    ).toBe("1");
    expect(
      session!.sql(
        `select (moderated_at = timestamptz '2026-08-23 08:30:00+00')::text || ':' || verified_report_count from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("true:1");
  });

  it("keeps threshold auto-hides closed until a moderator decision", () => {
    const id = "00000000-0000-4000-8000-000000000115";
    session!.sql(`insert into public.visit_reports (id) values ('${id}')`);

    session!.sql(`select public.report_pint_drop_v2('${id}', 'account-a', '', 2)`);
    expect(session!.sql(`select public.report_pint_drop_v2('${id}', 'account-b', '', 2)`)).toBe("2");

    // Anonymous review evidence must not publish an auto-hidden row.
    expect(
      session!.sql(`select public.report_pint_drop_anonymous('${id}', 'anon-before-review', 'new evidence')`),
    ).toBe("t");
    expect(
      session!.sql(
        `select status || ':' || (moderated_at is null)::text from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("hidden:true");

    // New evidence requeues a moderator-hidden row without publishing it.
    session!.sql(
      `update public.visit_reports set moderated_at = '2026-08-23 08:30:00+00', moderator_note = 'reviewed' where id = '${id}'`,
    );
    const verifiedCountBefore = session!.sql(
      `select verified_report_count from public.visit_reports where id = '${id}'`,
    );
    expect(
      session!.sql(`select public.report_pint_drop_anonymous('${id}', 'anon-after-review', 'fresh evidence')`),
    ).toBe("t");
    expect(
      session!.sql(
        `select status || ':' || (moderated_at is null)::text || ':' || coalesce(moderator_note, '') from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("hidden:true:");
    expect(session!.sql(`select verified_report_count from public.visit_reports where id = '${id}'`)).toBe(verifiedCountBefore);
  });

  it("rollback restores the pre-reopen function behavior", () => {
    session!.apply(REOPEN_ROLLBACK_PATH);
    const id = "00000000-0000-4000-8000-000000000116";
    session!.sql(`
      insert into public.visit_reports (id, moderated_at, status, moderator_note)
      values ('${id}', '2026-08-23 08:00:00+00', 'hidden', 'old decision');
    `);

    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-rollback', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(
        `select (moderated_at = timestamptz '2026-08-23 08:00:00+00')::text || ':' || verified_report_count || ':' || status || ':' || coalesce(moderator_note, '') from public.visit_reports where id = '${id}'`,
      ),
    ).toBe("true:1:hidden:old decision");
  });

  it("renames Pint Drop storage in place and rolls the name back without losing rows or foreign keys", () => {
    session!.apply(REOPEN_MIGRATION_PATH);
    const id = "00000000-0000-4000-8000-000000000118";
    session!.sql(`insert into public.visit_reports (id) values ('${id}')`);

    session!.apply(TABLE_SEPARATION_PATH);

    expect(
      session!.sql(
        "select relname || ':' || relkind::text from pg_class where oid in (to_regclass('public.pint_drops'), to_regclass('public.visit_reports')) order by relname",
      ),
    ).toBe("pint_drops:r\nvisit_reports:v");
    expect(
      session!.sql(
        "select c.relname from pg_constraint x join pg_class c on c.oid = x.confrelid where x.conrelid = 'public.pint_drop_reports'::regclass and x.contype = 'f'",
      ),
    ).toBe("pint_drops");
    expect(
      session!.sql(
        "select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.visit_reports'::regclass",
      ),
    ).toContain("security_invoker=true");
    expect(
      session!.sql(`select public.report_pint_drop_v2('${id}', 'account-table', '', 2)`),
    ).toBe("1");
    expect(
      session!.sql(`select verified_report_count from public.pint_drops where id = '${id}'`),
    ).toBe("1");
    expect(
      session!.sql(`select verified_report_count from public.visit_reports where id = '${id}'`),
    ).toBe("1");

    session!.apply(TABLE_SEPARATION_ROLLBACK_PATH);

    expect(session!.sql("select to_regclass('public.pint_drops') is null")).toBe("t");
    expect(session!.sql("select relkind from pg_class where oid = 'public.visit_reports'::regclass")).toBe("r");
    expect(
      session!.sql(
        "select c.relname from pg_constraint x join pg_class c on c.oid = x.confrelid where x.conrelid = 'public.pint_drop_reports'::regclass and x.contype = 'f'",
      ),
    ).toBe("visit_reports");
    expect(session!.sql(`select count(*) from public.visit_reports where id = '${id}'`)).toBe("1");
  });
});
