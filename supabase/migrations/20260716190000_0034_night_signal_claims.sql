create or replace function public.night_signal_public_url(value text)
returns boolean language sql immutable as $$
  select value ~* '^https?://[a-z0-9.-]+(/[^?#]*)?$';
$$;

create or replace function public.night_signal_source_host(value text)
returns text language sql immutable as $$
  select lower(substring(value from '^https?://([^/]+)'));
$$;

create or replace function public.night_signal_iso_timestamp(value text)
returns boolean language plpgsql immutable as $$
begin
  if value is null then return false; end if;
  perform value::timestamptz;
  return value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T';
exception when others then
  return false;
end;
$$;

create or replace function public.night_signal_independent_corroboration(primary_url text, primary_publisher text, observed_at timestamptz, sources jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(sources) = 'array'
    and jsonb_array_length(sources) between 1 and 5
    and (
      select count(*) = count(distinct lower(source->>'sourceUrl') || '|' || lower(btrim(source->>'publisher')))
      from jsonb_array_elements(sources) source
    )
    and not exists (
      select 1 from jsonb_array_elements(sources) source
      where not coalesce(public.night_signal_public_url(source->>'sourceUrl'), false)
        or char_length(btrim(coalesce(source->>'publisher', ''))) not between 1 and 160
        or case
          when public.night_signal_iso_timestamp(source->>'publishedAt')
            then (source->>'publishedAt')::timestamptz > observed_at
          else true
        end
    )
    and exists (
      select 1 from jsonb_array_elements(sources) source
      where public.night_signal_source_host(source->>'sourceUrl') <> public.night_signal_source_host(primary_url)
        and lower(btrim(source->>'publisher')) <> lower(btrim(primary_publisher))
    );
$$;

create table if not exists public.night_signal_claims (
  id text primary key check (char_length(btrim(id)) between 1 and 120),
  kind text not null check (kind in ('event', 'price', 'access', 'opening', 'transport')),
  entity_type text not null check (entity_type in ('venue', 'night_area', 'transport')),
  entity_id text not null check (char_length(btrim(entity_id)) between 1 and 120),
  claim text not null check (char_length(btrim(claim)) between 1 and 500),
  source_url text not null check (public.night_signal_public_url(source_url)),
  publisher text not null check (char_length(btrim(publisher)) between 1 and 160),
  published_at timestamptz not null,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  confidence double precision not null check (confidence between 0 and 1),
  review_state text not null check (review_state in ('pending', 'approved', 'rejected')),
  verification text not null check (verification in ('single_source', 'corroborated', 'manual_review')),
  route_effect text not null check (route_effect in ('none', 'boost', 'avoid')),
  corroborating_sources jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  review_authority text check (review_authority in ('operations', 'editorial', 'automated')),
  created_at timestamptz not null default now(),
  check (expires_at > observed_at),
  check (published_at <= observed_at),
  check (review_state <> 'approved' or (reviewed_at is not null and review_authority is not null and reviewed_at >= observed_at)),
  check (route_effect = 'none' or verification <> 'single_source'),
  check (route_effect = 'none' or verification <> 'manual_review' or review_authority in ('operations', 'editorial')),
  check (corroborating_sources = '[]'::jsonb or public.night_signal_independent_corroboration(source_url, publisher, observed_at, corroborating_sources)),
  check (verification <> 'corroborated' or public.night_signal_independent_corroboration(source_url, publisher, observed_at, corroborating_sources))
);

create index if not exists night_signal_claims_active_entity_idx
  on public.night_signal_claims (entity_type, entity_id, expires_at)
  where review_state = 'approved';

alter table public.night_signal_claims enable row level security;

drop policy if exists "Public reads current approved night signal claims" on public.night_signal_claims;
create policy "Public reads current approved night signal claims"
  on public.night_signal_claims for select
  using (review_state = 'approved' and observed_at <= now() and reviewed_at <= now() and expires_at > now());

revoke all on public.night_signal_claims from anon, authenticated;
grant select (
  id, kind, entity_type, entity_id, claim, source_url, publisher, published_at,
  observed_at, expires_at, confidence, review_state, verification, route_effect,
  corroborating_sources, reviewed_at, review_authority, created_at
) on public.night_signal_claims to anon, authenticated;
revoke execute on function public.night_signal_public_url(text) from public;
revoke execute on function public.night_signal_source_host(text) from public;
revoke execute on function public.night_signal_iso_timestamp(text) from public;
revoke execute on function public.night_signal_independent_corroboration(text, text, timestamptz, jsonb) from public;
