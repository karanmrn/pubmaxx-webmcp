-- Official-API What's-On cache (0119): durable rows the Vercel cron writes.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one What's-On listing persisted from Ticketmaster or Skiddle
-- (kind=event today; quiz/deal/music/sport stay available for a later harvest
-- write). It is NOT a committed public/data/whats_on file. The serverless
-- filesystem is read-only, so this table is the only place a scheduled
-- function can keep events fresh.
--
-- RLS: service-role only. The browser never reads or writes this table.
-- GET /api/cron/refresh-whats-on writes; loadServedWhatsOnListings reads.

begin;

create table if not exists public.whats_on_listings (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  observed_at timestamptz not null,
  generated_at timestamptz not null,
  city text not null default 'london'
);

create table if not exists public.whats_on_listing_generations (
  kind text primary key,
  generated_at timestamptz not null
);

alter table public.whats_on_listing_generations
  drop constraint if exists whats_on_listing_generations_kind_check;
alter table public.whats_on_listing_generations
  add constraint whats_on_listing_generations_kind_check
  check (kind in ('sport', 'quiz', 'deal', 'music', 'event'));

comment on table public.whats_on_listings is
  'Durable Whats-On listings from official APIs. Readers prefer this store and fall back to bundled files.';
comment on column public.whats_on_listings.kind is
  'sport | quiz | deal | music | event. Cron refresh writes event.';
comment on column public.whats_on_listings.payload is
  'WhatsOnRow JSON. Expired rows are dropped on read and on write.';
comment on column public.whats_on_listings.city is
  'City the listing was fetched for. Default london.';

alter table public.whats_on_listings
  drop constraint if exists whats_on_listings_kind_check;
alter table public.whats_on_listings
  add constraint whats_on_listings_kind_check
  check (kind in ('sport', 'quiz', 'deal', 'music', 'event'));

create index if not exists whats_on_listings_kind_idx
  on public.whats_on_listings (kind);

alter table public.whats_on_listings enable row level security;

alter table public.whats_on_listing_generations enable row level security;

revoke all on table public.whats_on_listings from public, anon, authenticated;
grant select, insert, update, delete on table public.whats_on_listings to service_role;
revoke all on table public.whats_on_listing_generations from public, anon, authenticated;
grant select, insert, update, delete on table public.whats_on_listing_generations to service_role;

drop policy if exists whats_on_listings_anon_deny on public.whats_on_listings;
create policy whats_on_listings_anon_deny
  on public.whats_on_listings for all to anon
  using (false) with check (false);

drop policy if exists whats_on_listings_authenticated_deny on public.whats_on_listings;
create policy whats_on_listings_authenticated_deny
  on public.whats_on_listings for all to authenticated
  using (false) with check (false);

drop policy if exists whats_on_listing_generations_anon_deny on public.whats_on_listing_generations;
create policy whats_on_listing_generations_anon_deny
  on public.whats_on_listing_generations for all to anon
  using (false) with check (false);

drop policy if exists whats_on_listing_generations_authenticated_deny on public.whats_on_listing_generations;
create policy whats_on_listing_generations_authenticated_deny
  on public.whats_on_listing_generations for all to authenticated
  using (false) with check (false);

create or replace function public.replace_whats_on_listings(
  p_kind text,
  p_rows jsonb,
  p_generated_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_kind not in ('sport', 'quiz', 'deal', 'music', 'event') then
    raise exception 'invalid Whats-On kind: %', p_kind;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Whats-On rows must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtext('whats_on_listings:' || p_kind));

  if exists (
    select 1
    from public.whats_on_listings
    where kind = p_kind
      and generated_at > p_generated_at
  ) then
    raise exception 'stale Whats-On generation for kind: %', p_kind;
  end if;
  if exists (
    select 1
    from public.whats_on_listing_generations
    where kind = p_kind
      and generated_at > p_generated_at
  ) then
    raise exception 'stale Whats-On generation for kind: %', p_kind;
  end if;

  delete from public.whats_on_listings
  where kind = p_kind;

  insert into public.whats_on_listings (
    id, kind, payload, observed_at, generated_at, city
  )
  select input.id, p_kind, input.payload, input.observed_at,
    p_generated_at, coalesce(input.city, 'london')
  from jsonb_to_recordset(p_rows) as input(
    id text,
    payload jsonb,
    observed_at timestamptz,
    city text
  );

  get diagnostics inserted_count = row_count;

  insert into public.whats_on_listing_generations (kind, generated_at)
  values (p_kind, p_generated_at)
  on conflict (kind) do update
    set generated_at = excluded.generated_at;

  return inserted_count;
end;
$$;

revoke all on function public.replace_whats_on_listings(text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.replace_whats_on_listings(text, jsonb, timestamptz)
  to service_role;

commit;
