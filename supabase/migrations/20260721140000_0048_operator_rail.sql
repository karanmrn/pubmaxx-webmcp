-- Operator rail (0048): durable backing for Wayfinder 3.5 — verified venue
-- operators proposing ATTRIBUTED corrections/events/offers/responses that route
-- through REVIEW and never overwrite trusted data. Two additive tables:
--
--   • venue_operators   — an account's claim to run a pub + the owner-driven
--                         verification lifecycle (pending/verified/rejected/revoked).
--   • operator_proposals — a verified operator's structured proposal + its review
--                         status (pending/accepted/declined). ACCEPTANCE only
--                         stamps the status here; materialising an accepted
--                         payload into a served fact happens in app code via
--                         factClaims.acceptedProposalFactSource (authority
--                         `operator`, rank 0 — additive, never an overwrite).
--
-- Apply AFTER 0047 (alt-text / cron plane). House style mirrors 0046 / 0045:
--   • `create table if not exists` — idempotent, re-runnable.
--   • RLS enabled with NO anon/authenticated policy — reads and writes flow ONLY
--     through the service-role route (the admin client). Ownership is enforced in
--     app code (lib/authServer.ts binds account_id to the verified JWT; a
--     proposal requires a VERIFIED venue_operators row), never via RLS on these
--     service-role writes.
--   • No functions/RPCs are defined here, so there is no function search_path to
--     pin (the search_path note in the lane brief applies only when a migration
--     adds a SECURITY DEFINER function — none here).
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies via
-- MCP / `supabase db push` and runs the advisor pass. Until then
-- lib/venueOperatorsStore.ts + lib/operatorProposalsStore.ts fail soft to
-- process-memory, so the flow keeps working and becomes durable the moment this
-- lands (no code change) — the same soft degradation visit reports (#484) /
-- area demand (#474) ship with. A HARD durable write failure answers 503.
--
-- IDENTITY / PRIVACY:
--   • account_id is the VERIFIED Supabase auth uid (never a body value).
--   • ONE claim per (account_id, venue_id): unique. A re-claim UPDATES in place
--     (the store reopens it to `pending`), never a second row.
--   • evidence_note records HOW the operator says they can be verified (an email
--     domain, a phone behind the bar, a document). The evidence itself is checked
--     OUT OF BAND by the owner; no credential/secret is stored here.

-- ── venue_operators ──────────────────────────────────────────────────────────
create table if not exists public.venue_operators (
  id                 uuid primary key default gen_random_uuid(),
  account_id         text not null,
  venue_id           text not null,
  verification_state text not null default 'pending',
  evidence_kind      text not null,
  evidence_note      text not null default '',
  reviewed_at        timestamptz,
  reviewer_note      text,
  created_at         timestamptz not null default now(),
  unique (account_id, venue_id)
);

-- ── operator_proposals ───────────────────────────────────────────────────────
create table if not exists public.operator_proposals (
  id            uuid primary key default gen_random_uuid(),
  venue_id      text not null,
  account_id    text not null,
  type          text not null,
  -- Flat structured payload (title/body/field/startsAt); shape + per-type
  -- required fields are enforced in lib/operatorProposals.ts at write time.
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending',
  reviewed_at   timestamptz,
  reviewer_note text,
  created_at    timestamptz not null default now()
);

-- Vocabulary CHECK constraints (defence in depth): the real allowlists live in
-- lib/venueOperators.ts / lib/operatorProposals.ts, but the DB refuses an
-- off-allowlist value too.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venue_operators_state_check') then
    alter table public.venue_operators
      add constraint venue_operators_state_check
      check (verification_state in ('pending', 'verified', 'rejected', 'revoked'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venue_operators_evidence_check') then
    alter table public.venue_operators
      add constraint venue_operators_evidence_check
      check (evidence_kind in ('email-domain', 'phone', 'document'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venue_operators_note_len_check') then
    alter table public.venue_operators
      add constraint venue_operators_note_len_check
      check (length(evidence_note) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operator_proposals_type_check') then
    alter table public.operator_proposals
      add constraint operator_proposals_type_check
      check (type in ('correction', 'event', 'offer', 'response'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operator_proposals_status_check') then
    alter table public.operator_proposals
      add constraint operator_proposals_status_check
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end $$;

-- Caller lookup: an account's claim for a venue (the propose gate + own-state read).
create index if not exists venue_operators_account_venue_idx
  on public.venue_operators (account_id, venue_id);
-- Moderator review queue: claims awaiting a decision, newest-first.
create index if not exists venue_operators_review_idx
  on public.venue_operators (verification_state, created_at desc);

-- Moderator review queue: proposals by status, newest-first.
create index if not exists operator_proposals_status_idx
  on public.operator_proposals (status, created_at desc);
-- Accepted proposals a venue surface would fold into fact resolution.
create index if not exists operator_proposals_venue_accepted_idx
  on public.operator_proposals (venue_id, status, created_at desc);

alter table public.venue_operators enable row level security;
alter table public.operator_proposals enable row level security;

drop policy if exists venue_operators_public_read on public.venue_operators;
drop policy if exists operator_proposals_public_read on public.operator_proposals;
-- Intentionally NO SELECT/INSERT/UPDATE/DELETE policy for anon / authenticated:
-- reads and writes flow through the service-role route (the admin client),
-- exactly like Pint Drops / visit reports. Service-role only, by construction.
revoke all on public.venue_operators from anon, authenticated;
revoke all on public.operator_proposals from anon, authenticated;
grant all on public.venue_operators to service_role;
grant all on public.operator_proposals to service_role;
