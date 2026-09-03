-- Rollback 0123: drop the folded UK harvest overlay.
--
-- Lossy by design: folded website, menu, and cited lore go with the table.

begin;

drop policy if exists harvest_venue_overlays_authenticated_deny on public.harvest_venue_overlays;
drop policy if exists harvest_venue_overlays_anon_deny on public.harvest_venue_overlays;

drop table if exists public.harvest_venue_overlays;

commit;
