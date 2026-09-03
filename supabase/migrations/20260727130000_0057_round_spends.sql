-- Round spending: immutable buying turns, not balances or debts.
-- Apply AFTER 0056. A row records one payer, one pub, one total, and optional
-- first-party drink lines. Money is integer pence throughout.
--
-- Identity follows the existing Round capability model. Reads are public to
-- anyone holding the Round code; writes stay service-role-only through API
-- routes. No column models shares, balances, IOUs, settlement, or debt.

create table if not exists public.round_spends (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null references public.rounds (id) on delete cascade,
  client_ref         text not null,
  payer_handle       text not null,
  recorded_by_handle text not null,
  venue_id           text not null,
  venue_name         text not null,
  total_pence        integer not null,
  items              jsonb not null default '[]'::jsonb,
  recorded_at        timestamptz not null default now(),
  unique (round_id, client_ref)
);

alter table public.round_spends
  add column if not exists client_ref text,
  add column if not exists payer_handle text,
  add column if not exists recorded_by_handle text,
  add column if not exists venue_id text,
  add column if not exists venue_name text,
  add column if not exists total_pence integer,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists recorded_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'round_spends_total_check'
  ) then
    alter table public.round_spends
      add constraint round_spends_total_check
      check (total_pence between 100 and 100000);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'round_spends_items_check'
  ) then
    alter table public.round_spends
      add constraint round_spends_items_check
      check (
        jsonb_typeof(items) = 'array'
        and jsonb_array_length(items) <= 20
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'round_spends_text_check'
  ) then
    alter table public.round_spends
      add constraint round_spends_text_check
      check (
        char_length(client_ref) between 1 and 80
        and char_length(payer_handle) between 1 and 30
        and char_length(recorded_by_handle) between 1 and 30
        and char_length(venue_id) between 1 and 80
        and char_length(venue_name) between 1 and 120
      );
  end if;
end $$;

create index if not exists round_spends_round_recorded_idx
  on public.round_spends (round_id, recorded_at);

create unique index if not exists round_spends_round_client_ref_idx
  on public.round_spends (round_id, client_ref);

alter table public.round_spends enable row level security;

drop policy if exists round_spends_public_read on public.round_spends;
create policy round_spends_public_read
  on public.round_spends
  for select
  using (true);
