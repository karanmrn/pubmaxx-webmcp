-- Plan vibe votes (docs/VIBE_LAYER_SPEC_2026-07-19.md, surface 3): the crew's
-- declared night, tallied for the share-card stamp. One vibe vote per plan
-- member; a revote overwrites the member's row (upsert on plan_id + member_id).
-- Additive only — no destructive statements. RLS + grants mirror the sibling
-- plan-collaboration tables in 0031 (service_role only; anon/authenticated
-- revoked). Owner applies this migration; nothing here auto-applies.

create table if not exists public.plan_vibe_votes (
  id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  vibe text not null check (vibe in ('bender','lit','quiet','cheeky','match','quiz','date')),
  idempotency_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(plan_id, member_id)
);

-- Idempotency ledger: a retried write with the same key returns the same row
-- rather than re-applying (mirrors plan_vote_requests in 0031).
create table if not exists public.plan_vibe_vote_requests (
  plan_id uuid not null references public.plans(id) on delete cascade,
  member_id uuid not null references public.plan_crew_members(id) on delete cascade,
  idempotency_key text not null,
  vibe text not null check (vibe in ('bender','lit','quiet','cheeky','match','quiz','date')),
  created_at timestamptz not null,
  primary key (plan_id, member_id, idempotency_key)
);

create index if not exists plan_vibe_votes_plan_idx on public.plan_vibe_votes(plan_id);

alter table public.plan_vibe_votes enable row level security;
alter table public.plan_vibe_vote_requests enable row level security;

revoke all on public.plan_vibe_votes, public.plan_vibe_vote_requests from anon, authenticated;
grant all on public.plan_vibe_votes, public.plan_vibe_vote_requests to service_role;

create or replace function public.record_plan_vibe_vote_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_vibe text,
  p_idempotency_key text,
  p_vote_id uuid,
  p_created_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_vote public.plan_vibe_votes%rowtype;
  v_request public.plan_vibe_vote_requests%rowtype;
begin
  if p_vibe not in ('bender','lit','quiet','cheeky','match','quiz','date') then return null; end if;
  select * into v_request from public.plan_vibe_vote_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_vote from public.plan_vibe_votes where plan_id = p_plan_id and member_id = p_member_id;
    return jsonb_build_object('plan_id', p_plan_id, 'member_id', p_member_id, 'vibe', v_vote.vibe, 'created_at', v_vote.created_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_plan_id::text || ':' || p_member_id::text, 0));
  select * into v_request from public.plan_vibe_vote_requests
  where plan_id = p_plan_id and member_id = p_member_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_vote from public.plan_vibe_votes where plan_id = p_plan_id and member_id = p_member_id;
    return jsonb_build_object('plan_id', p_plan_id, 'member_id', p_member_id, 'vibe', v_vote.vibe, 'created_at', v_vote.created_at);
  end if;
  -- Upsert: revote replaces the vibe, created_at stays the first cast.
  insert into public.plan_vibe_votes (id, plan_id, member_id, vibe, idempotency_key, created_at, updated_at)
  values (p_vote_id, p_plan_id, p_member_id, p_vibe, p_idempotency_key, p_created_at, p_created_at)
  on conflict (plan_id, member_id) do update set vibe = excluded.vibe, idempotency_key = excluded.idempotency_key, updated_at = excluded.updated_at
  returning * into v_vote;
  insert into public.plan_vibe_vote_requests (plan_id, member_id, idempotency_key, vibe, created_at)
  values (p_plan_id, p_member_id, p_idempotency_key, p_vibe, p_created_at);
  return jsonb_build_object('plan_id', p_plan_id, 'member_id', p_member_id, 'vibe', v_vote.vibe, 'created_at', v_vote.created_at);
end;
$$;

revoke all on function public.record_plan_vibe_vote_atomic(uuid, uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_plan_vibe_vote_atomic(uuid, uuid, text, text, uuid, timestamptz) to service_role;
