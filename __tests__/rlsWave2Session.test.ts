/**
 * Effective RLS session tests.
 *
 * Spins up throwaway local Postgres and PostgREST, applies the wave-2 policy
 * set plus the V1 release boundary, and proves deny/allow with real roles and
 * HTTP requests:
 *   anonymous  → DENIED
 *   owner      → ALLOWED (where product allows)
 *   other user → DENIED
 *   hidden / friends-gated rows → DENIED to everyone they should be
 *
 * When PostgreSQL 16+ binaries are absent (e.g. Vercel build hosts), every
 * test is SKIPPED with a loud reason — never reported as pass. CI job
 * `rls-session` installs Postgres 16 plus PostgREST 14 and runs this suite.
 *
 * Never applies migrations to a live Supabase project.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Session = {
  appliedForwardMigrations: string[];
  preWaveCatalogSnapshot: string;
  preV1CatalogSnapshot: string;
  preV1HelperOids: Record<string, string>;
  catalogSnapshot: () => string;
  sql: (
    statement: string,
    opts?: { asRole?: string | null; sub?: string | null },
  ) => { ok: boolean; out: string; err: string };
  sqlFile: (path: string) => void;
  rest: (
    path: string,
    opts: { method?: string; sub?: string | null; headers?: Record<string, string> },
  ) => Promise<{ status: number; body: unknown; text: string }>;
  reloadPostgrestSchema: () => Promise<void>;
  stop: () => Promise<void>;
  rollbackPath: string;
  v1RollbackPath: string;
};

const EXPECTED_SECURITY_MIGRATIONS = [
  "20260803200000_0065_rls_wave2_helpers.sql",
  "20260803201000_0066_rls_wave2_priority_policies.sql",
  "20260803202000_0067_rls_wave2_owner_policies.sql",
  "20260803203000_0068_rls_wave2_service_role_only.sql",
  "20260803204000_0069_rls_wave2_rpc_hardening.sql",
  "20260806035204_0070_v1_release_security.sql",
];

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const FRIEND = "33333333-3333-3333-3333-333333333333";
const STRANGER = "44444444-4444-4444-4444-444444444444";

const RLS_HELPERS = [
  {
    name: "rls_current_profile_id",
    signature: "rls_current_profile_id()",
    rpcQuery: "",
  },
  {
    name: "rls_owns_profile",
    signature: "rls_owns_profile(uuid)",
    rpcQuery: "?p_profile_id=a1111111-1111-1111-1111-111111111111",
  },
  {
    name: "rls_owns_handle",
    signature: "rls_owns_handle(text)",
    rpcQuery: "?p_handle=alice",
  },
  {
    name: "rls_is_plan_participant",
    signature: "rls_is_plan_participant(uuid)",
    rpcQuery: "?p_plan_id=a1000000-0000-4000-8000-000000000001",
  },
  {
    name: "rls_is_conversation_participant",
    signature: "rls_is_conversation_participant(uuid)",
    rpcQuery: "?p_conversation_id=b1000000-0000-4000-8000-000000000002",
  },
  {
    name: "rls_current_price_actor",
    signature: "rls_current_price_actor()",
    rpcQuery: "",
  },
  {
    name: "rls_follows_handle",
    signature: "rls_follows_handle(text)",
    rpcQuery: "?p_handle=alice",
  },
  {
    name: "rls_can_read_visit_report",
    signature: "rls_can_read_visit_report(text, text, text)",
    rpcQuery: "?p_status=visible&p_visibility=friends&p_handle=alice",
  },
] as const;

const V1_PROTECTED_WRITE_PROBES = [
  {
    table: "night_memories",
    insert: `insert into public.night_memories (id, owner_id, title)
      values ('ad000000-0000-4000-8000-000000000001', '${OWNER}', 'Probe memory')`,
    update: `update public.night_memories set title = 'Probe memory updated'
      where id = 'ad000000-0000-4000-8000-000000000001'`,
    delete: `delete from public.night_memories
      where id = 'ad000000-0000-4000-8000-000000000001'`,
  },
  {
    table: "night_moments",
    insert: `insert into public.night_moments (id, memory_id, owner_id, kind, caption)
      values ('ad000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'event', 'Probe moment')`,
    update: `update public.night_moments set caption = 'Probe moment updated'
      where id = 'ad000000-0000-4000-8000-000000000002'`,
    delete: `delete from public.night_moments
      where id = 'ad000000-0000-4000-8000-000000000002'`,
  },
  {
    table: "night_moment_consents",
    insert: `insert into public.night_moment_consents (story_id, moment_id, owner_id)
      values ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000002', '${OWNER}')`,
    update: `update public.night_moment_consents set status = 'pending'
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and moment_id = 'ab000000-0000-4000-8000-000000000002'`,
    delete: `delete from public.night_moment_consents
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and moment_id = 'ab000000-0000-4000-8000-000000000002'`,
  },
  {
    table: "night_stories",
    insert: `insert into public.night_stories (id, memory_id, host_editor_id, title)
      values ('ad000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Probe story')`,
    update: `update public.night_stories set title = 'Probe story updated'
      where id = 'ad000000-0000-4000-8000-000000000003'`,
    delete: `delete from public.night_stories
      where id = 'ad000000-0000-4000-8000-000000000003'`,
  },
  {
    table: "night_story_contributors",
    insert: `insert into public.night_story_contributors (story_id, profile_id, role)
      values ('ac000000-0000-4000-8000-000000000002', '${STRANGER}', 'contributor')`,
    update: `update public.night_story_contributors set status = 'invited'
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and profile_id = '${STRANGER}'`,
    delete: `delete from public.night_story_contributors
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and profile_id = '${STRANGER}'`,
  },
  {
    table: "night_story_moments",
    insert: `insert into public.night_story_moments (story_id, moment_id, position)
      values ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000002', 1)`,
    update: `update public.night_story_moments set position = 1
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and moment_id = 'ab000000-0000-4000-8000-000000000002'`,
    delete: `delete from public.night_story_moments
      where story_id = 'ac000000-0000-4000-8000-000000000002'
        and moment_id = 'ab000000-0000-4000-8000-000000000002'`,
  },
  {
    table: "night_story_publish_proposals",
    insert: `insert into public.night_story_publish_proposals
      (id, story_id, requested_by, moment_ids, visibility, token_hash, expires_at)
      values (
        'ad000000-0000-4000-8000-000000000004',
        'ac000000-0000-4000-8000-000000000002',
        '${OWNER}',
        array['ab000000-0000-4000-8000-000000000002'::uuid],
        'public',
        repeat('a', 64),
        now() + interval '1 hour'
      )`,
    update: `update public.night_story_publish_proposals
      set expires_at = expires_at + interval '1 minute'
      where id = 'ad000000-0000-4000-8000-000000000004'`,
    delete: `delete from public.night_story_publish_proposals
      where id = 'ad000000-0000-4000-8000-000000000004'`,
  },
  {
    table: "pub_pal_voice_usage",
    insert: `insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count)
      values ('${OWNER}', '2099-01-01', 1)`,
    update: `update public.pub_pal_voice_usage set session_count = 2
      where owner_id = '${OWNER}' and usage_month = '2099-01-01'`,
    delete: `delete from public.pub_pal_voice_usage
      where owner_id = '${OWNER}' and usage_month = '2099-01-01'`,
  },
] as const;

let session: Session | null = null;
/** Set only when Postgres binaries are genuinely missing. Loud skip, not pass. */
let skipReason: string | null = null;

beforeAll(async () => {
  // @ts-expect-error — plain .mjs harness, no declaration file (see scripts/rls/).
  const mod = await import("../scripts/rls/session-harness.mjs");
  const missing: string | null = mod.missingPostgresReason();
  if (missing) {
    skipReason = missing;
    // Loud, visible in CI/Vercel logs — a SKIP is not a green pass.
    console.error(
      [
        "",
        "══════════════════════════════════════════════════════════════",
        "SKIPPING RLS session tests (not a pass)",
        `Reason: ${missing}`,
        "CI job `rls-session` runs these with PostgreSQL 16.",
        "══════════════════════════════════════════════════════════════",
        "",
      ].join("\n"),
    );
    return;
  }

  try {
    session = (await mod.startRlsSession()) as Session;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Binaries present but cluster failed — fail hard, do not skip.
    throw new Error(`RLS session harness failed to start: ${msg}`);
  }

  // Seed identities and rows as table owner (bypasses RLS).
  const seed = `
    insert into auth.users (id) values
      ('${OWNER}'),
      ('${OTHER}'),
      ('${FRIEND}'),
      ('${STRANGER}');

    insert into public.profiles (id, user_id, handle) values
      ('a1111111-1111-1111-1111-111111111111', '${OWNER}', 'alice'),
      ('b2222222-2222-2222-2222-222222222222', '${OTHER}', 'bob'),
      ('c3333333-3333-3333-3333-333333333333', '${FRIEND}', 'cara'),
      ('d4444444-4444-4444-4444-444444444444', '${STRANGER}', 'dan');

    -- cara follows alice (cara is a follower of the author)
    insert into public.follows (follower_id, followee_id) values
      ('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111');

    -- bob follows alice one-way is NOT enough for mutual; product uses
    -- author-followers so bob does NOT qualify for friends drops.
    -- (deliberately no bob→alice edge)

    insert into public.visit_reports (id, venue_id, handle, price_gbp, status, visibility) values
      ('e1000000-0000-4000-8000-000000000001', 'v1', 'alice', 5.50, 'visible', 'public'),
      ('e1000000-0000-4000-8000-000000000002', 'v1', 'alice', 5.50, 'visible', 'friends'),
      ('e1000000-0000-4000-8000-000000000003', 'v1', 'alice', 5.50, 'visible', 'legacy'),
      ('e1000000-0000-4000-8000-000000000004', 'v1', 'alice', 5.50, 'hidden',  'public'),
      ('e1000000-0000-4000-8000-000000000005', 'v1', 'alice', 5.50, 'pending', 'public');

    insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, contributor_handle, hidden_at) values
      ('f1000000-0000-4000-8000-000000000001', 'v1', 'beer', 550, 'profile:22222222-2222-2222-2222-222222222222', 'bob', null),
      ('f1000000-0000-4000-8000-000000000002', 'v1', 'beer', 600, 'profile:a1111111-1111-1111-1111-111111111111', 'alice', now());

    insert into public.private_account_identities (user_id, date_of_birth, full_name) values
      ('${OWNER}', '1990-01-01', 'Alice Example');

    insert into public.plans (id, title, start_time, owner_user_id) values
      ('a1000000-0000-4000-8000-000000000001', 'Alice plan', now(), '${OWNER}'),
      ('a1000000-0000-4000-8000-000000000002', 'Bob plan', now(), '${OTHER}');

    insert into public.plan_crew_members (id, plan_id, name, token_hash, user_id) values
      ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Cara', repeat('c', 64), '${FRIEND}');

    insert into public.conversations (id, handle_a, handle_b, user_id_a, user_id_b) values
      ('b1000000-0000-4000-8000-000000000001', 'alice', 'cara', '${OWNER}', '${FRIEND}'),
      ('b1000000-0000-4000-8000-000000000002', 'alice', 'dan', null, null);

    insert into public.messages (id, conversation_id, sender_handle, body) values
      ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'alice', 'hello crew'),
      ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'alice', 'hello by handle');

    insert into public.saved_pubs (id, profile_id, venue_id) values
      ('c1000000-0000-4000-8000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'v1'),
      ('c1000000-0000-4000-8000-000000000002', 'b2222222-2222-2222-2222-222222222222', 'v2');

    insert into public.structured_visit_reports (id, venue_id, handle, visited_at, note, status) values
      ('d1000000-0000-4000-8000-000000000001', 'v1', 'alice', current_date, 'visible visit', 'visible'),
      ('d1000000-0000-4000-8000-000000000002', 'v1', 'alice', current_date - 1, 'hidden visit', 'hidden');

    insert into public.rounds (id, code, title, created_by_handle) values
      ('e2000000-0000-4000-8000-000000000001', 'ABCD', 'Alice round', 'alice');

    -- Night story graph: alice hosts published and draft stories. Bob owns
    -- the moments joined to them, proving a moment author cannot mutate the
    -- host-owned join through a published-row read policy.
    insert into public.night_memories (id, owner_id, title) values
      ('aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Alice night');
    insert into public.night_moments (id, memory_id, owner_id, kind, caption) values
      ('ab000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '${OTHER}', 'event', 'published moment'),
      ('ab000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'event', 'private moment'),
      ('ab000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001', '${OTHER}', 'event', 'draft story moment');
    insert into public.night_stories (id, memory_id, host_editor_id, title, status, visibility, published_at) values
      ('ac000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Published night', 'published', 'public', now()),
      ('ac000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001', '${OWNER}', 'Draft night', 'draft', 'private', null);
    insert into public.night_story_moments (story_id, moment_id, position) values
      ('ac000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001', 0),
      ('ac000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-000000000003', 0);
  `;
  const r = session!.sql(seed);
  if (!r.ok) {
    throw new Error(`seed failed: ${r.err}\n${r.out}`);
  }
}, 60_000);

afterAll(async () => {
  if (session) await session.stop();
});

// Every test skips with the same loud reason when Postgres is absent.
// Vitest reports these as skipped, never as passed.
beforeEach((ctx) => {
  if (skipReason) {
    ctx.skip(true, skipReason);
  }
});

function requireSession(): Session {
  if (skipReason) {
    throw new Error(`unreachable: test should have been skipped: ${skipReason}`);
  }
  if (!session) {
    throw new Error("RLS session not started");
  }
  return session;
}

function count(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): number {
  // Scalar expression so the harness can wrap it as RESULT:<n>.
  const r = requireSession().sql(
    `select count(*)::text from public.${table} where ${where}`,
    opts,
  );
  if (!r.ok) {
    // privilege or RLS denial for whole-table access surfaces as error
    if (/permission denied|row-level security/i.test(r.err)) return 0;
    throw new Error(`count ${table}: ${r.err}`);
  }
  const n = Number(r.out);
  return Number.isFinite(n) ? n : 0;
}

function canSelect(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  return count(table, where, opts) > 0;
}

function tryWrite(
  statement: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  const r = requireSession().sql(statement, opts);
  return r.ok;
}

/**
 * Attempt a DELETE as a client role, then count remaining rows as table owner
 * (bypasses RLS). RLS that filters the row out of DELETE returns success with
 * 0 rows affected - so "ok" alone is not proof the moderation record survived.
 */
function rowSurvivesDelete(
  table: string,
  where: string,
  opts: { asRole?: string | null; sub?: string | null },
): boolean {
  const s = requireSession();
  // Privilege denial or an RLS-filtered zero-row DELETE both protect the row.
  // Any other SQL error means the test did not exercise DELETE successfully.
  const deleted = s.sql(`delete from public.${table} where ${where}`, opts);
  if (!deleted.ok && !/permission denied/i.test(deleted.err)) {
    throw new Error(`delete ${table}: ${deleted.err}`);
  }
  const left = s.sql(`select count(*)::text from public.${table} where ${where}`);
  if (!left.ok) throw new Error(`post-delete count ${table}: ${left.err}`);
  return Number(left.out) === 1;
}

async function expectHiddenThroughPostgrest({
  table,
  filter,
  sqlWhere,
  sub,
}: {
  table: string;
  filter: string;
  sqlWhere: string;
  sub: string;
}) {
  const s = requireSession();
  const selected = await s.rest(`/rest/v1/${table}?${filter}`, { sub });
  expect(selected.status).toBe(200);
  expect(selected.body).toEqual([]);

  const deleted = await s.rest(`/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    sub,
    headers: { Prefer: "return=representation" },
  });
  expect([200, 401, 403]).toContain(deleted.status);
  if (deleted.status === 200) expect(deleted.body).toEqual([]);

  const remaining = s.sql(
    `select count(*)::text from public.${table} where ${sqlWhere}`,
  );
  expect(remaining.ok).toBe(true);
  expect(Number(remaining.out)).toBe(1);
}

describe("migration execution", () => {
  it("applies every exact security migration file", () => {
    expect(requireSession().appliedForwardMigrations).toEqual(
      EXPECTED_SECURITY_MIGRATIONS,
    );
  });

  it.each(V1_PROTECTED_WRITE_PROBES)(
    "denies authenticated DML and permits service-role DML on $table",
    ({ table, insert, update, delete: deleteStatement }) => {
      const s = requireSession();
      for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
        const browserPrivilege = s.sql(
          `select has_table_privilege('authenticated', 'public.${table}', '${privilege}')::text`,
        );
        const servicePrivilege = s.sql(
          `select has_table_privilege('service_role', 'public.${table}', '${privilege}')::text`,
        );
        expect(browserPrivilege.ok, browserPrivilege.err).toBe(true);
        expect(browserPrivilege.out).toBe("false");
        expect(servicePrivilege.ok, servicePrivilege.err).toBe(true);
        expect(servicePrivilege.out).toBe("true");
      }

      expect(tryWrite(insert, { asRole: "authenticated", sub: OWNER })).toBe(false);
      expect(tryWrite(insert, { asRole: "service_role" })).toBe(true);
      expect(tryWrite(update, { asRole: "authenticated", sub: OWNER })).toBe(false);
      expect(tryWrite(update, { asRole: "service_role" })).toBe(true);
      expect(
        tryWrite(deleteStatement, { asRole: "authenticated", sub: OWNER }),
      ).toBe(false);
      expect(tryWrite(deleteStatement, { asRole: "service_role" })).toBe(true);
    },
  );

  it("executes both Pub Pal voice quota RPCs only as service_role", () => {
    const s = requireSession();
    const quotaRpcSignatures = [
      "consume_pub_pal_voice_trial(uuid, date, integer)",
      "release_pub_pal_voice_trial(uuid, date)",
    ];

    for (const signature of quotaRpcSignatures) {
      const privileges = s.sql(`
        select jsonb_build_object(
          'serviceRole', has_function_privilege(
            'service_role', 'public.${signature}', 'EXECUTE'
          ),
          'authenticated', has_function_privilege(
            'authenticated', 'public.${signature}', 'EXECUTE'
          ),
          'anon', has_function_privilege(
            'anon', 'public.${signature}', 'EXECUTE'
          )
        )::text
      `);
      expect(privileges.ok, privileges.err).toBe(true);
      expect(JSON.parse(privileges.out)).toEqual({
        serviceRole: true,
        authenticated: false,
        anon: false,
      });
    }

    const consumed = s.sql(
      `select public.consume_pub_pal_voice_trial(
        '${OWNER}', '2098-01-01', 10
      )::text`,
      { asRole: "service_role" },
    );
    expect(consumed.ok, consumed.err).toBe(true);
    expect(consumed.out).toBe("true");

    const released = s.sql(
      `select public.release_pub_pal_voice_trial(
        '${OWNER}', '2098-01-01'
      )::text`,
      { asRole: "service_role" },
    );
    expect(released.ok, released.err).toBe(true);
    expect(released.out).toBe("true");

    for (const role of ["authenticated", "anon"]) {
      const denied = s.sql(
        `select public.consume_pub_pal_voice_trial(
          '${OWNER}', '2098-01-01', 10
        )::text`,
        { asRole: role, sub: role === "authenticated" ? OWNER : null },
      );
      expect(denied.ok).toBe(false);
      expect(denied.err).toMatch(/permission denied/i);
    }
  });
});

describe("unexposed RLS helper functions", () => {
  it("grants private schema usage only to policy-evaluation roles", () => {
    const result = requireSession().sql(`
      select jsonb_build_object(
        'authenticated', exists (
          select 1 from pg_namespace n
          where n.nspname = 'pubmax_private'
            and has_schema_privilege('authenticated', n.oid, 'USAGE')
        ),
        'service_role', exists (
          select 1 from pg_namespace n
          where n.nspname = 'pubmax_private'
            and has_schema_privilege('service_role', n.oid, 'USAGE')
        ),
        'anon', exists (
          select 1 from pg_namespace n
          where n.nspname = 'pubmax_private'
            and has_schema_privilege('anon', n.oid, 'USAGE')
        ),
        'public', exists (
          select 1
          from pg_namespace n
          cross join lateral aclexplode(
            coalesce(n.nspacl, acldefault('n', n.nspowner))
          ) acl
          where n.nspname = 'pubmax_private'
            and acl.grantee = 0
            and acl.privilege_type = 'USAGE'
        )
      )::text
    `);
    expect(result.ok, result.err).toBe(true);
    expect(JSON.parse(result.out)).toEqual({
      authenticated: true,
      service_role: true,
      anon: false,
      public: false,
    });
  });

  it.each(RLS_HELPERS)(
    "moves $name without replacing its OID or function protections",
    ({ name, signature }) => {
      const s = requireSession();
      const result = s.sql(`
        select jsonb_build_object(
          'oid', p.oid::text,
          'securityDefiner', p.prosecdef,
          'volatility', p.provolatile,
          'config', p.proconfig,
          'authenticatedExecute', has_function_privilege(
            'authenticated', p.oid, 'EXECUTE'
          ),
          'serviceRoleExecute', has_function_privilege(
            'service_role', p.oid, 'EXECUTE'
          ),
          'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
          'publicExecute', exists (
            select 1
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          )
        )::text
        from pg_proc p
        where p.oid = to_regprocedure('pubmax_private.${signature}')
      `);
      expect(result.ok, result.err).toBe(true);
      expect(result.out, `missing pubmax_private.${signature}`).not.toBe("");
      expect(JSON.parse(result.out)).toEqual({
        oid: s.preV1HelperOids[name],
        securityDefiner: true,
        volatility: "s",
        config: ["search_path=public"],
        authenticatedExecute: true,
        serviceRoleExecute: true,
        anonExecute: false,
        publicExecute: false,
      });

      const publicOid = s.sql(
        `select to_regprocedure('public.${signature}')::oid::text`,
      );
      expect(publicOid.ok, publicOid.err).toBe(true);
      expect(publicOid.out).toBe("");
    },
  );

  it("keeps every helper out of authenticated PostgREST RPC after schema reload", async () => {
    const s = requireSession();
    await s.reloadPostgrestSchema();

    for (const { name, rpcQuery } of RLS_HELPERS) {
      const response = await s.rest(`/rest/v1/rpc/${name}${rpcQuery}`, {
        sub: OWNER,
      });
      expect(response.status, `${name}: ${response.text}`).toBe(404);
      expect(response.body).toMatchObject({ code: "PGRST202" });
    }
  });

  it("executes the conversation wrapper through its private handle dependency", () => {
    const result = requireSession().sql(
      "select pubmax_private.rls_is_conversation_participant('b1000000-0000-4000-8000-000000000002')::text",
      { asRole: "authenticated", sub: OWNER },
    );
    expect(result.ok, result.err).toBe(true);
    expect(result.out).toBe("true");
  });

  it("executes the current-price wrapper through its private profile dependency", () => {
    const result = requireSession().sql(
      "select pubmax_private.rls_current_price_actor()",
      { asRole: "authenticated", sub: OWNER },
    );
    expect(result.ok, result.err).toBe(true);
    expect(result.out).toBe("profile:a1111111-1111-1111-1111-111111111111");
  });

  it("executes the visit-report wrapper through its private follower dependency", () => {
    const result = requireSession().sql(
      "select pubmax_private.rls_can_read_visit_report('visible', 'friends', 'alice')::text",
      { asRole: "authenticated", sub: FRIEND },
    );
    expect(result.ok, result.err).toBe(true);
    expect(result.out).toBe("true");
  });
});

describe("PostgREST JSON claims", () => {
  it("resolves the owner for profile-owned rows", async () => {
    const s = requireSession();
    const path =
      "/rest/v1/saved_pubs?id=eq.c1000000-0000-4000-8000-000000000001&select=id";
    const owner = await s.rest(path, { sub: OWNER });
    expect(owner.status).toBe(200);
    expect(owner.body).toEqual([
      { id: "c1000000-0000-4000-8000-000000000001" },
    ]);

    const other = await s.rest(path, { sub: OTHER });
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
  });

  it("resolves an author's follower for a friends-only report", async () => {
    const s = requireSession();
    const path =
      "/rest/v1/visit_reports?id=eq.e1000000-0000-4000-8000-000000000002&select=id";
    const follower = await s.rest(path, { sub: FRIEND });
    expect(follower.status).toBe(200);
    expect(follower.body).toEqual([
      { id: "e1000000-0000-4000-8000-000000000002" },
    ]);

    const other = await s.rest(path, { sub: OTHER });
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
  });

  it("resolves both owner and linked crew plan participants", async () => {
    const s = requireSession();
    const path =
      "/rest/v1/plans?id=eq.a1000000-0000-4000-8000-000000000001&select=id";
    for (const sub of [OWNER, FRIEND]) {
      const participant = await s.rest(path, { sub });
      expect(participant.status).toBe(200);
      expect(participant.body).toEqual([
        { id: "a1000000-0000-4000-8000-000000000001" },
      ]);
    }

    const stranger = await s.rest(path, { sub: STRANGER });
    expect(stranger.status).toBe(200);
    expect(stranger.body).toEqual([]);
  });

  it("resolves a conversation participant through linked handle ownership", async () => {
    const s = requireSession();
    const path =
      "/rest/v1/messages?id=eq.b2000000-0000-4000-8000-000000000002&select=id";
    const participant = await s.rest(path, { sub: OWNER });
    expect(participant.status).toBe(200);
    expect(participant.body).toEqual([
      { id: "b2000000-0000-4000-8000-000000000002" },
    ]);

    const nonParticipant = await s.rest(path, { sub: OTHER });
    expect(nonParticipant.status).toBe(200);
    expect(nonParticipant.body).toEqual([]);
  });
});

describe("private Pint Drop storage", () => {
  it("denies direct client reads and permits service-role reads", () => {
    const s = requireSession();
    const seeded = s.sql(`
      insert into storage.objects (bucket_id, name, owner_id)
      values ('pint-drops', 'v1/drop-1/pint.jpg', '${OWNER}')
    `);
    expect(seeded.ok, seeded.err).toBe(true);

    for (const role of ["anon", "authenticated"]) {
      const read = s.sql(
        "select count(*)::text from storage.objects where bucket_id = 'pint-drops'",
        { asRole: role, sub: role === "authenticated" ? OWNER : null },
      );
      expect(read.ok, read.err).toBe(true);
      expect(Number(read.out)).toBe(0);
    }

    const serviceRead = s.sql(
      "select count(*)::text from storage.objects where bucket_id = 'pint-drops'",
      { asRole: "service_role" },
    );
    expect(serviceRead.ok, serviceRead.err).toBe(true);
    expect(Number(serviceRead.out)).toBe(1);
  });
});

describe("visit_reports — effective RLS", () => {
  it("denies anonymous on every drop", () => {
    expect(canSelect("visit_reports", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows any authenticated reader on a visible public drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies a non-follower on a friends-only drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: STRANGER,
      }),
    ).toBe(false);
  });

  it("allows the author and a follower on a friends-only drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(true);
  });

  it("allows only the author on a legacy drop", () => {
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000003'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000003'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(false);
  });

  it("denies hidden and pending to the author (and everyone else)", () => {
    for (const sub of [OWNER, OTHER, FRIEND]) {
      expect(
        canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000004'", {
          asRole: "authenticated",
          sub,
        }),
      ).toBe(false);
      expect(
        canSelect("visit_reports", "id = 'e1000000-0000-4000-8000-000000000005'", {
          asRole: "authenticated",
          sub,
        }),
      ).toBe(false);
    }
  });

  it("keeps a hidden drop undeletable by its author (moderation record survives)", () => {
    expect(
      rowSurvivesDelete(
        "visit_reports",
        "id = 'e1000000-0000-4000-8000-000000000004'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });
});

describe("community_prices — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("community_prices", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows authenticated select of non-hidden rows", () => {
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies hidden rows even to the contributing actor", () => {
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(false);
    expect(
      canSelect("community_prices", "id = 'f1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });

  it("keeps a hidden price undeletable by its contributing actor", () => {
    expect(
      rowSurvivesDelete(
        "community_prices",
        "id = 'f1000000-0000-4000-8000-000000000002'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });
});

describe("private_account_identities — effective RLS", () => {
  it("denies anonymous select", () => {
    expect(
      canSelect("private_account_identities", "true", { asRole: "anon" }),
    ).toBe(false);
  });

  it("allows owner select and denies other user", () => {
    expect(
      canSelect("private_account_identities", "true", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("private_account_identities", "true", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });

  it("denies authenticated insert/update/delete (service-role only writes)", () => {
    expect(
      tryWrite(
        `insert into public.private_account_identities (user_id, date_of_birth)
         values ('${OTHER}', '1991-02-02');`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(false);
    expect(
      tryWrite(
        `update public.private_account_identities set full_name = 'hacked'
         where user_id = '${OWNER}';`,
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(false);
    expect(
      tryWrite(
        `delete from public.private_account_identities where user_id = '${OWNER}';`,
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(false);
  });
});

describe("plans — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("plans", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows owner and denies other user", () => {
    expect(
      canSelect("plans", "id = 'a1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("plans", "id = 'a1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("messages — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("messages", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows a conversation participant and denies a stranger", () => {
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: FRIEND,
      }),
    ).toBe(true);
    expect(
      canSelect("messages", "id = 'b2000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: STRANGER,
      }),
    ).toBe(false);
  });
});

describe("saved_pubs — effective RLS", () => {
  it("denies anonymous", () => {
    expect(canSelect("saved_pubs", "true", { asRole: "anon" })).toBe(false);
  });

  it("allows owner and denies other user", () => {
    expect(
      canSelect("saved_pubs", "id = 'c1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("saved_pubs", "id = 'c1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("structured_visit_reports + rounds — effective RLS", () => {
  it("hides hidden structured visit reports from their author", () => {
    expect(
      canSelect("structured_visit_reports", "id = 'd1000000-0000-4000-8000-000000000001'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(true);
    expect(
      canSelect("structured_visit_reports", "id = 'd1000000-0000-4000-8000-000000000002'", {
        asRole: "authenticated",
        sub: OWNER,
      }),
    ).toBe(false);
  });

  it("keeps a hidden structured visit report undeletable by its author", () => {
    expect(
      rowSurvivesDelete(
        "structured_visit_reports",
        "id = 'd1000000-0000-4000-8000-000000000002'",
        { asRole: "authenticated", sub: OWNER },
      ),
    ).toBe(true);
  });

  it("denies client roles on rounds (service-role only)", () => {
    expect(canSelect("rounds", "true", { asRole: "anon" })).toBe(false);
    expect(
      canSelect("rounds", "true", { asRole: "authenticated", sub: OWNER }),
    ).toBe(false);
  });
});

describe("night_story_moments / night_stories / night_moments - write isolation", () => {
  const PUBLISHED_STORY = "ac000000-0000-4000-8000-000000000001";
  const DRAFT_STORY = "ac000000-0000-4000-8000-000000000002";
  const STORY_MOMENT = "ab000000-0000-4000-8000-000000000001";
  const PRIVATE_MOMENT = "ab000000-0000-4000-8000-000000000002";

  it("lets any authenticated reader select moments on a published public story", () => {
    expect(
      canSelect(
        "night_story_moments",
        `story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(true);
  });

  it("lets a moment author read but rejects browser delete through PostgREST", async () => {
    const filter =
      "story_id=eq.ac000000-0000-4000-8000-000000000001&moment_id=eq.ab000000-0000-4000-8000-000000000001&select=story_id,moment_id";
    const s = requireSession();
    const selected = await s.rest(`/rest/v1/night_story_moments?${filter}`, {
      sub: OTHER,
    });
    expect(selected.status).toBe(200);
    expect(selected.body).toEqual([
      {
        story_id: "ac000000-0000-4000-8000-000000000001",
        moment_id: "ab000000-0000-4000-8000-000000000001",
      },
    ]);

    const deleted = await s.rest(`/rest/v1/night_story_moments?${filter}`, {
      method: "DELETE",
      sub: OTHER,
      headers: { Prefer: "return=representation" },
    });
    expect([401, 403]).toContain(deleted.status);

    const remaining = s.sql(
      `select count(*)::text from public.night_story_moments
       where story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
    );
    expect(remaining.ok).toBe(true);
    expect(Number(remaining.out)).toBe(1);
  });

  it("denies every authenticated DELETE on a published story moment", () => {
    // Gate defect: FOR ALL + published USING let any authenticated user delete.
    expect(
      rowSurvivesDelete(
        "night_story_moments",
        `story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
        { asRole: "authenticated", sub: OTHER },
      ),
    ).toBe(true);
    // Host writes also travel through the service-role API after 0070.
    const hostDelete = requireSession().sql(
      `delete from public.night_story_moments
       where story_id = '${PUBLISHED_STORY}' and moment_id = '${STORY_MOMENT}'`,
      { asRole: "authenticated", sub: OWNER },
    );
    expect(hostDelete.ok).toBe(false);
    expect(hostDelete.err).toMatch(/permission denied|row-level security/i);
  });

  it("denies non-host DELETE on a draft night story and a private night moment", () => {
    expect(
      rowSurvivesDelete("night_stories", `id = '${DRAFT_STORY}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
    expect(
      rowSurvivesDelete("night_moments", `id = '${PRIVATE_MOMENT}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(true);
  });

  it("denies non-owner SELECT of a private night moment and draft story", () => {
    expect(
      canSelect("night_moments", `id = '${PRIVATE_MOMENT}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
    expect(
      canSelect("night_stories", `id = '${DRAFT_STORY}'`, {
        asRole: "authenticated",
        sub: OTHER,
      }),
    ).toBe(false);
  });
});

describe("hidden rows through PostgREST", () => {
  it.each([
    {
      table: "night_moments",
      filter: "id=eq.ab000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'ab000000-0000-4000-8000-000000000002'",
      sub: OTHER,
    },
    {
      table: "night_stories",
      filter: "id=eq.ac000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'ac000000-0000-4000-8000-000000000002'",
      sub: OTHER,
    },
    {
      table: "night_story_moments",
      filter:
        "story_id=eq.ac000000-0000-4000-8000-000000000002&moment_id=eq.ab000000-0000-4000-8000-000000000003&select=story_id,moment_id",
      sqlWhere:
        "story_id = 'ac000000-0000-4000-8000-000000000002' and moment_id = 'ab000000-0000-4000-8000-000000000003'",
      sub: OTHER,
    },
    {
      table: "community_prices",
      filter: "id=eq.f1000000-0000-4000-8000-000000000002&select=id",
      sqlWhere: "id = 'f1000000-0000-4000-8000-000000000002'",
      sub: OWNER,
    },
    {
      table: "visit_reports",
      filter: "id=eq.e1000000-0000-4000-8000-000000000004&select=id",
      sqlWhere: "id = 'e1000000-0000-4000-8000-000000000004'",
      sub: OWNER,
    },
  ])(
    "$table cannot be observed or deleted by its protected actor",
    async (testCase) => {
      await expectHiddenThroughPostgrest(testCase);
    },
  );
});

describe("rollback path", () => {
  it("restores exact pre-0070 then pre-wave catalogs", () => {
    const s = requireSession();
    expect(() => s.sqlFile(s.v1RollbackPath)).not.toThrow();
    expect(s.catalogSnapshot()).toBe(s.preV1CatalogSnapshot);
    expect(() => s.sqlFile(s.rollbackPath)).not.toThrow();
    expect(s.catalogSnapshot()).toBe(s.preWaveCatalogSnapshot);
  });
});
