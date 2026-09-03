create table if not exists public.round_price_line_charges (
  spend_id uuid not null references public.round_spends(id) on delete cascade,
  line_index integer not null check (line_index >= 0),
  actor text not null,
  charged_at timestamptz not null default now(),
  primary key (spend_id, line_index)
);

alter table public.round_price_line_charges enable row level security;
revoke all on table public.round_price_line_charges
  from public, anon, authenticated;
grant select, insert, delete on table public.round_price_line_charges
  to service_role;

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

  v_cutoff := now() - make_interval(secs => p_window_ms / 1000.0);

  insert into public.rate_limits (key)
  values (p_key)
  on conflict (key) do nothing;

  update public.rate_limits
     set hits = array(
       select hit
         from unnest(hits) hit
        where hit > v_cutoff
     ) || now(),
         updated_at = now()
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
