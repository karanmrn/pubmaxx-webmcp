-- Owner-scoped pending Plan recap drafts (Lane C durability). Private route
-- captions and completion references only — never member tokens or coordinates.
-- Service-role write path; browser roles get no privileges. Captain applies.

create table if not exists public.pending_plan_recaps (
  owner_id text not null,
  completion_id text not null,
  plan_id uuid not null,
  draft jsonb not null,
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, completion_id)
);

create index if not exists pending_plan_recaps_owner_saved_idx
  on public.pending_plan_recaps (owner_id, saved_at desc);

create index if not exists pending_plan_recaps_plan_idx
  on public.pending_plan_recaps (plan_id);

alter table public.pending_plan_recaps enable row level security;

revoke all on public.pending_plan_recaps from public, anon, authenticated;
grant all on public.pending_plan_recaps to service_role;
