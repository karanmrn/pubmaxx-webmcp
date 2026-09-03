alter table public.community_prices
  add column if not exists round_spend_id uuid,
  add column if not exists round_line_index integer;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'community_prices_round_source_check'
  ) then
    alter table public.community_prices
      add constraint community_prices_round_source_check
      check (
        (round_spend_id is null and round_line_index is null)
        or (
          round_spend_id is not null
          and round_line_index is not null
          and round_line_index >= 0
        )
      );
  end if;
end $$;

create unique index if not exists community_prices_round_source_owner_idx
  on public.community_prices (round_spend_id, round_line_index)
  where round_spend_id is not null;

create or replace function public.reconcile_round_price_keys(
  p_spend_id uuid,
  p_actor text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner text;
  v_round_id uuid;
begin
  if nullif(trim(p_actor), '') is null then
    return 'forbidden';
  end if;

  select round_id, promotion_actor
    into v_round_id, v_owner
    from public.round_spends
   where id = p_spend_id;

  if not found then
    return 'not_found';
  end if;

  if v_owner is distinct from p_actor then
    return 'forbidden';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  perform 1
    from public.round_spends
   where round_id = v_round_id
     and promotion_actor = p_actor
   for update;

  with all_items as materialized (
    select
      spend.id as spend_id,
      expanded.item,
      expanded.ordinality
    from public.round_spends spend
    cross join lateral jsonb_array_elements(spend.items)
      with ordinality as expanded(item, ordinality)
    where spend.round_id = v_round_id
      and spend.promotion_actor = p_actor
  ),
  ranked_round as materialized (
    select
      spend.id as spend_id,
      expanded.ordinality,
      row_number() over (
        partition by spend.venue_id, expanded.item->>'drinkCategory'
        order by
          spend.recorded_at desc,
          spend.id::text desc,
          expanded.ordinality desc
      ) as ownership_rank
    from public.round_spends spend
    cross join lateral jsonb_array_elements(spend.items)
      with ordinality as expanded(item, ordinality)
    where spend.round_id = v_round_id
      and spend.promotion_actor = p_actor
      and expanded.item->>'source' = 'round'
      and expanded.item->>'promotionStatus' in ('pending', 'ready')
  ),
  rebuilt as (
    select
      all_items.spend_id,
      jsonb_agg(
        case
          when ranked_round.ownership_rank > 1
            then jsonb_set(
              all_items.item,
              '{promotionStatus}',
              to_jsonb('superseded'::text),
              true
            )
          else all_items.item
        end
        order by all_items.ordinality
      ) as items
    from all_items
    left join ranked_round
      on ranked_round.spend_id = all_items.spend_id
     and ranked_round.ordinality = all_items.ordinality
    group by all_items.spend_id
  )
  update public.round_spends spend
     set items = rebuilt.items
    from rebuilt
   where spend.id = rebuilt.spend_id;

  return 'ok';
end;
$$;

revoke all on function public.reconcile_round_price_keys(
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.reconcile_round_price_keys(
  uuid,
  text
) to service_role;

create or replace function public.transition_round_price_lines(
  p_spend_id uuid,
  p_actor text,
  p_updates jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_owner text;
  v_reconciled text;
  v_update jsonb;
  v_index integer;
  v_status text;
  v_item jsonb;
begin
  if
    nullif(trim(p_actor), '') is null
    or jsonb_typeof(p_updates) is distinct from 'array'
  then
    return 'forbidden';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  v_reconciled := public.reconcile_round_price_keys(p_spend_id, p_actor);
  if v_reconciled <> 'ok' then
    return v_reconciled;
  end if;

  select items, promotion_actor
    into v_items, v_owner
    from public.round_spends
   where id = p_spend_id
   for update;

  if not found then
    return 'not_found';
  end if;

  if v_owner is distinct from p_actor then
    return 'forbidden';
  end if;

  for v_update in
    select value from jsonb_array_elements(p_updates)
  loop
    if
      jsonb_typeof(v_update) <> 'object'
      or coalesce(v_update->>'index', '') !~ '^[0-9]+$'
    then
      continue;
    end if;

    v_index := (v_update->>'index')::integer;
    v_status := v_update->>'status';
    v_item := v_items->v_index;

    if v_item->>'source' is distinct from 'round' then
      continue;
    end if;

    if
      v_status = 'ready'
      and v_item->>'promotionStatus' = 'pending'
    then
      v_items := jsonb_set(
        v_items,
        array[v_index::text, 'promotionStatus'],
        to_jsonb('ready'::text),
        false
      );
    elsif
      v_status = 'promoted'
      and v_item->>'promotionStatus' = 'ready'
      and exists (
        select 1
          from public.community_prices price
         where price.actor = p_actor
           and price.round_spend_id = p_spend_id
           and price.round_line_index = v_index
      )
    then
      v_items := jsonb_set(
        v_items,
        array[v_index::text, 'promotionStatus'],
        to_jsonb('promoted'::text),
        false
      );
    elsif
      v_status = 'superseded'
      and v_item->>'promotionStatus' in ('pending', 'ready', 'promoted')
    then
      v_items := jsonb_set(
        v_items,
        array[v_index::text, 'promotionStatus'],
        to_jsonb('superseded'::text),
        false
      );
    end if;
  end loop;

  update public.round_spends
     set items = v_items
   where id = p_spend_id;

  return 'ok';
end;
$$;

revoke all on function public.transition_round_price_lines(
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.transition_round_price_lines(
  uuid,
  text,
  jsonb
) to service_role;

drop function if exists public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz
);

create or replace function public.upsert_attributed_community_price_if_newer(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz,
  p_round_spend_id uuid,
  p_round_line_index integer
)
returns table (
  id uuid,
  price_pennies integer,
  submitted_at timestamptz,
  round_spend_id uuid,
  round_line_index integer,
  source_became_owner boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_spend_id uuid;
  v_old_line_index integer;
  v_current_id uuid;
  v_current_pennies integer;
  v_current_submitted_at timestamptz;
  v_current_spend_id uuid;
  v_current_line_index integer;
  v_source_round_id uuid;
  v_source_venue_id text;
  v_source_item jsonb;
  v_candidate_spend_id uuid;
  v_candidate_line_index integer;
begin
  if
    nullif(trim(p_actor), '') is null
    or (
      (p_round_spend_id is null) is distinct from
      (p_round_line_index is null)
    )
    or coalesce(p_round_line_index, 0) < 0
  then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('round-price-actor:' || p_actor, 0)
  );

  if p_round_spend_id is not null then
    select
      source.round_id,
      source.venue_id,
      source.items->p_round_line_index
    into
      v_source_round_id,
      v_source_venue_id,
      v_source_item
    from public.round_spends source
    where source.id = p_round_spend_id
      and source.promotion_actor = p_actor
      and jsonb_array_length(source.items) > p_round_line_index
    for update;

    if
      not found
      or v_source_venue_id is distinct from p_venue_id
      or v_source_item->>'source' is distinct from 'round'
      or v_source_item->>'drinkCategory' is distinct from p_drink_category
    then
      return;
    end if;

    if v_source_item->>'promotionStatus' = 'promoted' then
      select
        existing.id,
        existing.price_pennies,
        existing.submitted_at,
        existing.round_spend_id,
        existing.round_line_index
      into
        v_current_id,
        v_current_pennies,
        v_current_submitted_at,
        v_current_spend_id,
        v_current_line_index
      from public.community_prices existing
      where existing.venue_id = p_venue_id
        and existing.drink_category = p_drink_category
        and existing.actor = p_actor
      for update;

      if
        not found
        or v_current_spend_id is distinct from p_round_spend_id
        or v_current_line_index is distinct from p_round_line_index
      then
        return;
      end if;

      return query
      select
        v_current_id,
        v_current_pennies,
        v_current_submitted_at,
        v_current_spend_id,
        v_current_line_index,
        true as source_became_owner;
      return;
    end if;

    if v_source_item->>'promotionStatus' is distinct from 'ready' then
      return;
    end if;

    perform 1
      from public.round_spends candidate
     where candidate.round_id = v_source_round_id
       and candidate.promotion_actor = p_actor
     for update;

    select
      candidate.id,
      (expanded.ordinality - 1)::integer
    into
      v_candidate_spend_id,
      v_candidate_line_index
    from public.round_spends candidate
    cross join lateral jsonb_array_elements(candidate.items)
      with ordinality as expanded(item, ordinality)
    where candidate.round_id = v_source_round_id
      and candidate.promotion_actor = p_actor
      and candidate.venue_id = p_venue_id
      and expanded.item->>'source' = 'round'
      and expanded.item->>'drinkCategory' = p_drink_category
      and expanded.item->>'promotionStatus' in ('pending', 'ready')
    order by
      candidate.recorded_at desc,
      candidate.id::text desc,
      expanded.ordinality desc
    limit 1;

    if
      v_candidate_spend_id is distinct from p_round_spend_id
      or v_candidate_line_index is distinct from p_round_line_index
    then
      return;
    end if;
  end if;

  select existing.round_spend_id, existing.round_line_index
    into v_old_spend_id, v_old_line_index
    from public.community_prices existing
   where existing.venue_id = p_venue_id
     and existing.drink_category = p_drink_category
     and existing.actor = p_actor
   for update;

  insert into public.community_prices (
    venue_id,
    drink_category,
    price_pennies,
    actor,
    contributor_handle,
    submitted_at,
    round_spend_id,
    round_line_index
  )
  values (
    p_venue_id,
    p_drink_category,
    p_price_pennies,
    p_actor,
    p_contributor_handle,
    p_submitted_at,
    p_round_spend_id,
    p_round_line_index
  )
  on conflict (venue_id, drink_category, actor)
  do update
     set price_pennies = excluded.price_pennies,
         contributor_handle = excluded.contributor_handle,
         submitted_at = excluded.submitted_at,
         round_spend_id = excluded.round_spend_id,
         round_line_index = excluded.round_line_index
   where public.community_prices.submitted_at <= excluded.submitted_at
  returning
    public.community_prices.id,
    public.community_prices.price_pennies,
    public.community_prices.submitted_at,
    public.community_prices.round_spend_id,
    public.community_prices.round_line_index
  into
    v_current_id,
    v_current_pennies,
    v_current_submitted_at,
    v_current_spend_id,
    v_current_line_index;

  if not found then
    select
      existing.id,
      existing.price_pennies,
      existing.submitted_at,
      existing.round_spend_id,
      existing.round_line_index
    into
      v_current_id,
      v_current_pennies,
      v_current_submitted_at,
      v_current_spend_id,
      v_current_line_index
    from public.community_prices existing
    where existing.venue_id = p_venue_id
      and existing.drink_category = p_drink_category
      and existing.actor = p_actor;
  end if;

  if
    v_old_spend_id is not null
    and (
      v_old_spend_id is distinct from v_current_spend_id
      or v_old_line_index is distinct from v_current_line_index
    )
  then
    update public.round_spends spend
       set items = jsonb_set(
         spend.items,
         array[v_old_line_index::text, 'promotionStatus'],
         to_jsonb('superseded'::text),
         false
       )
     where spend.id = v_old_spend_id
       and spend.promotion_actor = p_actor
       and jsonb_array_length(spend.items) > v_old_line_index
       and spend.items->v_old_line_index->>'source' = 'round';
  end if;

  if p_round_spend_id is not null then
    update public.round_spends spend
       set items = jsonb_set(
         spend.items,
         array[p_round_line_index::text, 'promotionStatus'],
         to_jsonb(
           (
             case
               when
                 v_current_spend_id is not distinct from p_round_spend_id
                 and v_current_line_index is not distinct from p_round_line_index
               then 'promoted'
               else 'superseded'
             end
           )::text
         ),
         false
       )
     where spend.id = p_round_spend_id
       and spend.promotion_actor = p_actor
       and jsonb_array_length(spend.items) > p_round_line_index
       and spend.items->p_round_line_index->>'source' = 'round'
       and spend.items->p_round_line_index->>'promotionStatus'
         in ('ready', 'promoted');
  end if;

  return query
  select
    v_current_id,
    v_current_pennies,
    v_current_submitted_at,
    v_current_spend_id,
    v_current_line_index,
    v_current_spend_id is not distinct from p_round_spend_id
      and v_current_line_index is not distinct from p_round_line_index;
end;
$$;

revoke all on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;
grant execute on function public.upsert_attributed_community_price_if_newer(
  text,
  text,
  integer,
  text,
  text,
  timestamptz,
  uuid,
  integer
) to service_role;
