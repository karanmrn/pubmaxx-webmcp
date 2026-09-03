create table if not exists public.plan_completions (
  id uuid primary key,
  plan_id uuid not null unique references public.plans(id) on delete cascade,
  ending text not null check (ending in ('food', 'get_home', 'keep_going')),
  terminal_venue_id text,
  final_pint_drop_id uuid references public.visit_reports(id) on delete set null,
  actor_member_id text not null,
  completed_at timestamptz not null default now()
);

alter table public.plan_completions enable row level security;
revoke all on public.plan_completions from anon, authenticated;

create table if not exists public.pub_pals (
  id uuid primary key,
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  adult_attested_at timestamptz not null,
  appearance jsonb not null,
  personality jsonb not null,
  voice jsonb not null,
  muted boolean not null default false,
  hidden boolean not null default false,
  mastery_points integer not null default 0 check (mastery_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pub_pal_memories (
  id uuid primary key,
  pal_id uuid not null references public.pub_pals(id) on delete cascade,
  kind text not null,
  value text not null check (char_length(value) between 1 and 500),
  provenance text not null check (provenance in ('user_confirmed', 'completed_plan', 'user_correction')),
  created_at timestamptz not null default now()
);

create table if not exists public.pub_pal_mastery_events (
  id uuid primary key,
  pal_id uuid not null references public.pub_pals(id) on delete cascade,
  kind text not null check (kind in ('plan_completed', 'venue_discovered', 'pint_drop_verified', 'heritage_read', 'crew_coordinated', 'night_captured')),
  source_id text not null,
  points integer not null check (points between 1 and 100),
  created_at timestamptz not null default now(),
  unique (pal_id, kind, source_id)
);

alter table public.pub_pals enable row level security;
alter table public.pub_pal_memories enable row level security;
alter table public.pub_pal_mastery_events enable row level security;
revoke all on public.pub_pals, public.pub_pal_memories, public.pub_pal_mastery_events from anon, authenticated;

create table if not exists public.pub_pal_voice_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  session_count integer not null default 0 check (session_count >= 0),
  primary key (owner_id, usage_month)
);

alter table public.pub_pal_voice_usage enable row level security;
revoke all on public.pub_pal_voice_usage from anon, authenticated;

create or replace function public.consume_pub_pal_voice_trial(
  p_owner_id uuid,
  p_month date,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count)
  values (p_owner_id, p_month, 1)
  on conflict (owner_id, usage_month) do update
  set session_count = public.pub_pal_voice_usage.session_count + 1
  where public.pub_pal_voice_usage.session_count < p_limit
  returning session_count into next_count;
  return next_count is not null and next_count <= p_limit;
end;
$$;

revoke all on function public.consume_pub_pal_voice_trial(uuid, date, integer) from public, anon, authenticated;
