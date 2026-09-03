alter table public.plans
  add column if not exists status text not null default 'draft'
    check (status in ('draft', 'ready', 'active', 'ending', 'completed', 'abandoned')),
  add column if not exists night_context jsonb,
  add column if not exists ending text
    check (ending is null or ending in ('food', 'get_home', 'keep_going'));

create table if not exists public.plan_actions (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  actor_member_id uuid references public.plan_crew_members(id) on delete set null,
  type text not null check (type in ('arrived', 'skipped', 'swapped', 'ending')),
  stop_position integer check (stop_position is null or stop_position between 0 and 7),
  ending text check (ending is null or ending in ('food', 'get_home', 'keep_going')),
  created_at timestamptz not null default now(),
  check ((type = 'ending' and ending is not null) or (type <> 'ending' and stop_position is not null))
);

create index if not exists plan_actions_plan_created_idx on public.plan_actions(plan_id, created_at);
alter table public.plan_actions enable row level security;
revoke all on public.plan_actions from anon, authenticated;
grant all on public.plan_actions to service_role;
