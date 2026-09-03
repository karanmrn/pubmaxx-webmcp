-- Retrieved heritage facts for a pub, one row per fact, each carrying its source.
-- Read best-effort by lib/heritage.ts when Supabase is configured; public read-only.
--
-- venue_key is normaliseVenueName(name) (lowercased, single-spaced) — the SAME
-- key the retrieval query (lib/heritage.ts) and the writer (scripts/
-- enrich_heritage.mjs) use. There is no server `pubs` table, so venues are
-- matched by normalised name, never by an opaque id.

create table if not exists pub_heritage (
  id           bigint generated always as identity primary key,
  venue_key    text,
  source       text        not null,
  fact         text        not null,
  source_ref   text,
  retrieved_at timestamptz  default now()
);

create index if not exists pub_heritage_venue_key_idx on pub_heritage (venue_key);

alter table pub_heritage enable row level security;

create policy "pub_heritage public read"
  on pub_heritage for select
  using (true);
