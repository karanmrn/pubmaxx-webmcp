-- Price trust reconciliation queue (0126).
-- Captain applies. Agents ship SQL only.
--
-- A community price and its Pint Drop can commit before the derived trust event
-- or account credits do. This queue is written in the same transaction as each
-- attributed price insert or correction. Direct submission and the scheduled
-- worker both reconcile it. A revision-bound delete cannot erase a newer write.
--
-- RLS: service-role only. Browser roles never read or write this table or call
-- its enqueue function.

begin;

create sequence if not exists public.price_trust_reconciliation_version_seq
  as bigint;

create table if not exists public.price_trust_reconciliation_queue (
  venue_id text not null,
  category text not null,
  version bigint not null
    default nextval('public.price_trust_reconciliation_version_seq')
    check (version > 0),
  enqueued_at timestamptz not null default now(),
  primary key (venue_id, category),
  constraint price_trust_reconciliation_queue_category_check
    check (category in (
      'beer',
      'wine',
      'whisky',
      'gin',
      'vodka',
      'rum',
      'cocktail',
      'shot',
      'alcohol-free',
      'soft-drink',
      'coffee',
      'other'
    ))
);

alter sequence public.price_trust_reconciliation_version_seq
  owned by public.price_trust_reconciliation_queue.version;

comment on table public.price_trust_reconciliation_queue is
  'Service-role work queue for derived first-cluster trust events and account credits.';
comment on column public.price_trust_reconciliation_queue.version is
  'Monotonic pair revision. A worker deletes only the revision it reconciled.';

create index if not exists price_trust_reconciliation_queue_enqueued_idx
  on public.price_trust_reconciliation_queue (enqueued_at, venue_id, category);

alter table public.price_trust_reconciliation_queue enable row level security;

revoke all on table public.price_trust_reconciliation_queue
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.price_trust_reconciliation_queue to service_role;
revoke all on sequence public.price_trust_reconciliation_version_seq
  from public, anon, authenticated;
grant usage, select on sequence public.price_trust_reconciliation_version_seq
  to service_role;

drop policy if exists price_trust_reconciliation_queue_anon_deny
  on public.price_trust_reconciliation_queue;
create policy price_trust_reconciliation_queue_anon_deny
  on public.price_trust_reconciliation_queue for all to anon
  using (false) with check (false);

drop policy if exists price_trust_reconciliation_queue_authenticated_deny
  on public.price_trust_reconciliation_queue;
create policy price_trust_reconciliation_queue_authenticated_deny
  on public.price_trust_reconciliation_queue for all to authenticated
  using (false) with check (false);

create or replace function public.enqueue_price_trust_reconciliation(
  p_venue_id text,
  p_category text
)
returns table (
  venue_id text,
  category text,
  version bigint,
  enqueued_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if nullif(btrim(p_venue_id), '') is null
     or p_category is null
     or p_category not in (
       'beer', 'wine', 'whisky', 'gin', 'vodka', 'rum',
       'cocktail', 'shot', 'alcohol-free', 'soft-drink', 'coffee', 'other'
     ) then
    return;
  end if;

  return query
  insert into public.price_trust_reconciliation_queue as queue (
    venue_id,
    category,
    version,
    enqueued_at
  )
  values (
    btrim(p_venue_id),
    p_category,
    nextval('public.price_trust_reconciliation_version_seq'),
    now()
  )
  on conflict on constraint price_trust_reconciliation_queue_pkey do update
    set version = nextval('public.price_trust_reconciliation_version_seq'),
        enqueued_at = excluded.enqueued_at
  returning queue.venue_id, queue.category, queue.version, queue.enqueued_at;
end;
$$;

revoke all on function public.enqueue_price_trust_reconciliation(text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_price_trust_reconciliation(text, text)
  to service_role;

create or replace function public.queue_community_price_trust_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor is not null
     and old.drink_category is not null
     and (
       new.actor is null
       or new.venue_id is distinct from old.venue_id
       or new.drink_category is distinct from old.drink_category
     ) then
    perform *
      from public.enqueue_price_trust_reconciliation(
        old.venue_id,
        old.drink_category
      );
  end if;

  if new.actor is not null and new.drink_category is not null then
    perform *
      from public.enqueue_price_trust_reconciliation(
        new.venue_id,
        new.drink_category
      );
  end if;
  return new;
end;
$$;

revoke all on function public.queue_community_price_trust_reconciliation()
  from public, anon, authenticated;
grant execute on function public.queue_community_price_trust_reconciliation()
  to service_role;

drop trigger if exists community_prices_queue_price_trust
  on public.community_prices;
create trigger community_prices_queue_price_trust
after insert or update of venue_id, drink_category, price_pennies, actor, submitted_at
on public.community_prices
for each row
execute function public.queue_community_price_trust_reconciliation();

commit;
