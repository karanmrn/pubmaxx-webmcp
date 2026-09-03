-- Rollback 0119: drop the official-API What's-On cache.
--
-- Lossy by design: persisted listings go with the table. Readers fall back to
-- the bundled public/data/whats_on files.

begin;

drop function if exists public.replace_whats_on_listings(text, jsonb, timestamptz);

drop policy if exists whats_on_listings_authenticated_deny on public.whats_on_listings;
drop policy if exists whats_on_listings_anon_deny on public.whats_on_listings;
drop policy if exists whats_on_listing_generations_authenticated_deny on public.whats_on_listing_generations;
drop policy if exists whats_on_listing_generations_anon_deny on public.whats_on_listing_generations;

drop index if exists public.whats_on_listings_kind_idx;

drop table if exists public.whats_on_listings;
drop table if exists public.whats_on_listing_generations;

commit;
