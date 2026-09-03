-- Durable, privacy-minimised dedupe receipts for server-verified loop events.
-- Raw delivery tokens and anonymous ids never enter this table.

create table if not exists public.analytics_event_receipts (
  event_id uuid primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  event_name text not null check (char_length(event_name) between 1 and 64),
  status text not null default 'pending' check (status in ('pending', 'delivered')),
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table public.analytics_event_receipts enable row level security;
revoke all on table public.analytics_event_receipts from public, anon, authenticated;
grant select, insert, update on table public.analytics_event_receipts to service_role;

create or replace function public.claim_analytics_event_receipt(
  p_event_id uuid,
  p_token_hash text,
  p_event_name text,
  p_now timestamptz,
  p_lease_until timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare receipt public.analytics_event_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('analytics:event:' || p_event_id::text, 0));
  select * into receipt from public.analytics_event_receipts where event_id = p_event_id for update;
  if found then
    if receipt.token_hash <> p_token_hash or receipt.event_name <> p_event_name then return 'conflict'; end if;
    if receipt.status = 'delivered' then return 'delivered'; end if;
    if receipt.lease_until > p_now then return 'busy'; end if;
    update public.analytics_event_receipts set lease_until = p_lease_until where event_id = p_event_id;
    return 'claimed';
  end if;
  insert into public.analytics_event_receipts (event_id, token_hash, event_name, lease_until, created_at)
  values (p_event_id, p_token_hash, p_event_name, p_lease_until, p_now);
  return 'claimed';
end;
$$;

create or replace function public.complete_analytics_event_receipt(
  p_event_id uuid,
  p_delivered_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = public
as $$
begin
  update public.analytics_event_receipts
  set status = 'delivered', delivered_at = coalesce(delivered_at, p_delivered_at), lease_until = p_delivered_at
  where event_id = p_event_id;
  return found;
end;
$$;

revoke all on function public.claim_analytics_event_receipt(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_analytics_event_receipt(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_analytics_event_receipt(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.complete_analytics_event_receipt(uuid, timestamptz) to service_role;
