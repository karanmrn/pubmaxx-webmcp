-- Harvest overlay (0123): folded UK website, menu, and cited lore per OSM id.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT A ROW IS: one harvest overlay for one OSM object. Identity is osm_id
-- (`node/123`), never the pub name. Website and menu are https-only. Lore is
-- present only with https citations. Social handles are not stored.
--
-- RLS: service-role only. Readers go through GET /api/harvest-overlay and
-- GET /api/heritage, which use the service-role store.

begin;

create table if not exists public.harvest_venue_overlays (
  osm_id text primary key,
  osm_ref text not null unique,
  website text,
  menu_url text,
  lore_text text,
  lore_citations jsonb not null default '[]'::jsonb,
  lore_match_name text,
  lore_match_town text,
  sources jsonb not null default '[]'::jsonb,
  folded_at timestamptz not null default now()
);

alter table public.harvest_venue_overlays
  drop constraint if exists harvest_venue_overlays_website_https;
alter table public.harvest_venue_overlays
  add constraint harvest_venue_overlays_website_https
  check (website is null or website ilike 'https://%');

alter table public.harvest_venue_overlays
  drop constraint if exists harvest_venue_overlays_menu_https;
alter table public.harvest_venue_overlays
  add constraint harvest_venue_overlays_menu_https
  check (menu_url is null or menu_url ilike 'https://%');

alter table public.harvest_venue_overlays
  drop constraint if exists harvest_venue_overlays_lore_pair;
alter table public.harvest_venue_overlays
  add constraint harvest_venue_overlays_lore_pair
  check (
    (lore_text is null and lore_citations = '[]'::jsonb and lore_match_name is null and lore_match_town is null)
    or
    (lore_text is not null and lore_match_name is not null and lore_match_town is not null and jsonb_typeof(lore_citations) = 'array' and jsonb_array_length(lore_citations) > 0)
  );

comment on table public.harvest_venue_overlays is
  'Folded UK harvest overlay. OSM id is the key. https website/menu and cited lore only.';
comment on column public.harvest_venue_overlays.osm_id is
  'Canonical OSM id, e.g. node/123. Never a pub name.';
comment on column public.harvest_venue_overlays.lore_text is
  'Cited heritage sentence. Null means unknown, not no history.';

alter table public.harvest_venue_overlays enable row level security;

revoke all on table public.harvest_venue_overlays from public, anon, authenticated;
grant select, insert, update, delete on table public.harvest_venue_overlays to service_role;

drop policy if exists harvest_venue_overlays_anon_deny on public.harvest_venue_overlays;
create policy harvest_venue_overlays_anon_deny
  on public.harvest_venue_overlays for all to anon
  using (false) with check (false);

drop policy if exists harvest_venue_overlays_authenticated_deny on public.harvest_venue_overlays;
create policy harvest_venue_overlays_authenticated_deny
  on public.harvest_venue_overlays for all to authenticated
  using (false) with check (false);

commit;
