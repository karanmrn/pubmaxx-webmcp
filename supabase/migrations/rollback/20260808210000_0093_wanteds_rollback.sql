-- Rollback 0093: drop Wanted Wave A table and policies.

begin;

drop policy if exists wanteds_anon_deny on public.wanteds;
drop policy if exists wanteds_owner_delete on public.wanteds;
drop policy if exists wanteds_owner_update on public.wanteds;
drop policy if exists wanteds_owner_insert on public.wanteds;
drop policy if exists wanteds_owner_select on public.wanteds;

drop index if exists public.wanteds_owner_open_venue_idx;
drop index if exists public.wanteds_owner_created_idx;

drop table if exists public.wanteds;

commit;
