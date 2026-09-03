-- Public plan invite page: an unguessable invite token per plan, plus
-- handle-free RSVP and emoji reactions from guests who never join the plan.
--
-- Privacy posture: `plans` stays participant-fenced (RLS wave 2, migration
-- 0066) — this migration does NOT loosen that. The public invite read at
-- app/invite/[token] goes through a service-role API route that looks the
-- plan up by invite_token and returns a narrow projected read (route stops,
-- prices, start time, host handle, RSVP aggregate, guest display names) —
-- never the raw plan row. `invite_token` is a bearer-capability slug, like a
-- Partiful link: whoever holds the link may view and RSVP. It is stored in
-- clear text (not hashed) because the host must be able to keep reading it
-- back to re-share the same link — unlike plan_crew_members.token_hash,
-- which validates a one-time join and is fine to be one-way.
--
-- `submitter_hash` on the RSVP/reaction tables is the opposite case: the
-- client-minted device id (lib/anonId.ts) is hashed server-side via
-- hashActor() before it ever reaches the database, matching the
-- pint_drop_reactions.actor_hash convention — the raw device id is never
-- persisted.
--
-- Shipped, NOT applied. Captain applies migrations.

begin;

-- ── plans.invite_token ───────────────────────────────────────────────────
-- default is a volatile expression, so ADD COLUMN backfills every existing
-- row with its own fresh random value (not one shared default) and every
-- future INSERT keeps generating one automatically — no application code
-- has to mint or backfill this column.
--
-- gen_random_bytes is pgcrypto, and Supabase installs pgcrypto in the
-- `extensions` schema, not `public` (docs/DEPLOYMENT.md, "Supabase installs
-- the pgcrypto extension..."). Schema-qualify it so the same migration runs
-- the same way on Supabase and on the local harness.
alter table public.plans
  add column invite_token text not null unique
  default encode(extensions.gen_random_bytes(16), 'hex');

alter table public.plans
  add constraint plans_invite_token_format_check
  check (invite_token ~ '^[0-9a-f]{32}$');

-- ── plan_invite_rsvps ────────────────────────────────────────────────────
-- One row per (plan, device). Handle-free: a guest gives a display name and
-- Going/Maybe, no account. Re-submitting updates the same row (upsert on the
-- unique key) so a guest can change their mind without stacking rows.
create table public.plan_invite_rsvps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  submitter_hash text not null check (submitter_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  status text not null check (status in ('going', 'maybe')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, submitter_hash)
);
create index plan_invite_rsvps_plan_idx on public.plan_invite_rsvps(plan_id);

-- ── plan_invite_reactions ────────────────────────────────────────────────
-- Sibling table to the RSVP row: a closed emoji set, one row per
-- (plan, device, reaction) so a device can't double-count one reaction.
-- Reuses the same allowlist as pint_drop_reactions (lib/reactions.ts
-- REACTION_KEYS) rather than a second taxonomy.
create table public.plan_invite_reactions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  submitter_hash text not null check (submitter_hash ~ '^[0-9a-f]{64}$'),
  reaction text not null check (reaction in ('cheers', 'bargain', 'chaos', 'proper', 'legendary')),
  created_at timestamptz not null default now(),
  unique (plan_id, submitter_hash, reaction)
);
create index plan_invite_reactions_plan_idx on public.plan_invite_reactions(plan_id);

-- ── RLS: deny-all to anon/authenticated, service-role only ──────────────
-- Matches the social-tables posture (migration 0073): RLS enabled with no
-- permissive policy is deny-by-default; the explicit revoke/grant below
-- makes the intent reviewable rather than relying on the advisor default.
alter table public.plan_invite_rsvps enable row level security;
alter table public.plan_invite_reactions enable row level security;

revoke all on table public.plan_invite_rsvps, public.plan_invite_reactions
  from public, anon, authenticated;
grant select, insert, update, delete on table public.plan_invite_rsvps, public.plan_invite_reactions
  to service_role;

commit;
