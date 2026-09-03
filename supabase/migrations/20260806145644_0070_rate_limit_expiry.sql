-- Durable limiter rows are operational state, not an activity archive. Give
-- each key the same lifetime as its active window and prune every expired key
-- whenever either durable limiter writer runs. This removes abandoned keys
-- without requiring the same actor to return.

alter table public.rate_limits
  add column if not exists expires_at timestamptz;

-- Existing rows predate per-key expiry, so retain them for no longer than the
-- longest deployed limiter window (the seven-day broadcast claim window).
update public.rate_limits
   set expires_at = updated_at + interval '7 days'
 where expires_at is null;

delete from public.rate_limits
 where expires_at <= now();

alter table public.rate_limits
  alter column expires_at set not null;

create index if not exists rate_limits_expires_at_idx
  on public.rate_limits (expires_at);

create or replace function public.prune_expired_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  delete from public.rate_limits
   where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_expired_rate_limits()
  from public, anon, authenticated;
grant execute on function public.prune_expired_rate_limits()
  to service_role;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  cutoff timestamptz := now() - make_interval(secs => p_window_ms / 1000.0);
  n integer;
begin
  perform public.prune_expired_rate_limits();

  insert into public.rate_limits (key, expires_at)
  values (
    p_key,
    now() + make_interval(secs => p_window_ms / 1000.0)
  )
  on conflict (key) do nothing;

  update public.rate_limits
     set hits = array(
       select hit
         from unnest(hits) hit
        where hit > cutoff
     ) || now(),
         updated_at = now(),
         expires_at = now() + make_interval(secs => p_window_ms / 1000.0)
   where key = p_key
   returning cardinality(hits) into n;

  return n > p_limit;
end;
$$;

create or replace function public.charge_round_price_line(
  p_actor text,
  p_key text,
  p_limit integer,
  p_line_index integer,
  p_spend_id uuid,
  p_window_ms integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_owner text;
  v_receipt_actor text;
  v_cutoff timestamptz;
  v_hits integer;
begin
  if
    nullif(trim(p_actor), '') is null
    or nullif(trim(p_key), '') is null
    or p_limit < 0
    or p_line_index < 0
    or p_window_ms <= 0
  then
    return 'forbidden';
  end if;

  select items, promotion_actor
    into v_items, v_owner
    from public.round_spends
   where id = p_spend_id
   for update;

  if not found or v_owner is distinct from p_actor then
    return 'forbidden';
  end if;

  select actor
    into v_receipt_actor
    from public.round_price_line_charges
   where spend_id = p_spend_id
     and line_index = p_line_index;

  if found then
    return case
      when v_receipt_actor = p_actor then 'already_charged'
      else 'forbidden'
    end;
  end if;

  if
    p_line_index >= jsonb_array_length(v_items)
    or v_items->p_line_index->>'promotionStatus' <> 'pending'
  then
    return 'forbidden';
  end if;

  insert into public.round_price_line_charges (
    spend_id,
    line_index,
    actor
  )
  values (
    p_spend_id,
    p_line_index,
    p_actor
  );

  perform public.prune_expired_rate_limits();
  v_cutoff := now() - make_interval(secs => p_window_ms / 1000.0);

  insert into public.rate_limits (key, expires_at)
  values (
    p_key,
    now() + make_interval(secs => p_window_ms / 1000.0)
  )
  on conflict (key) do nothing;

  update public.rate_limits
     set hits = array(
       select hit
         from unnest(hits) hit
        where hit > v_cutoff
     ) || now(),
         updated_at = now(),
         expires_at = now() + make_interval(secs => p_window_ms / 1000.0)
   where key = p_key
   returning cardinality(hits) into v_hits;

  if v_hits > p_limit then
    delete from public.round_price_line_charges
     where spend_id = p_spend_id
       and line_index = p_line_index;
    return 'limited';
  end if;

  return 'charged';
end;
$$;

revoke all on function public.charge_round_price_line(
  text,
  text,
  integer,
  integer,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.charge_round_price_line(
  text,
  text,
  integer,
  integer,
  uuid,
  integer
) to service_role;
