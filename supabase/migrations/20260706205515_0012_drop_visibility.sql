-- Per-drop visibility & privacy for Pint Drops (issue #29, PRD § "The Spill").
-- Adds a `visibility` column to visit_reports gating who can see a drop:
--
--   • public     — today's behaviour: on the feed, map, leaderboards, ledger,
--                  permalink. The default, so EVERY existing row is `public`
--                  and nothing changes for already-logged drops.
--   • friends    — visible only to the author and to viewers who FOLLOW the
--                  author (the author's followers). A courtesy curtain, not
--                  cryptographic privacy — see the trust note below.
--   • legacy     — the family/heirloom lane: readable ONLY on the venue's Ledger
--                  page and by the author; hidden from the main feed/map/
--                  leaderboard signals.
--   • anonymous  — shown publicly, but with the handle WITHHELD in every public
--                  DTO (rendered as "a PUBMAXXER"). The real handle is still
--                  stored here for moderation + rate-limits; it must never leave
--                  the server through a public read (enforced in the app layer:
--                  lib/pintDropsStore.ts toDTO, lib/pintDropLookup.ts).
--
-- Apply AFTER 0011.
--
-- Trust boundary (honest-best-effort, exactly like lib/notifications.ts):
--   Identity is a self-asserted handle — Google OAuth ownership is shipped but
--   not yet enabled, so the "viewer" of a friends-gated read is whoever the
--   client claims to be. `friends` visibility is therefore a COURTESY CURTAIN,
--   not a hard access control, until auth hardens. This migration does NOT add a
--   friends/legacy RLS SELECT policy: RLS here has no authenticated viewer to key
--   on (anon reads would either see everything or nothing). Instead, the write
--   path uses the service role (which bypasses RLS) and the SERVER applies the
--   visibility filter per request against the requester's self-asserted handle +
--   follow graph (lib/pintDropsStore.ts). When real auth lands, tighten this to
--   an auth.uid()-keyed RLS policy — the app-layer filter is the honest interim,
--   the same posture the rest of the social layer documents.
--
-- Style mirrors 0001_visit_reports.sql / 0006_social_layer.sql exactly:
--   • `add column if not exists` — idempotent, re-runnable, upgrades in place.
--   • CHECK constraint added inside a DO block guarded by a pg_constraint lookup
--     (ADD CONSTRAINT has no IF NOT EXISTS).
--   • A default of 'public' so existing rows and any insert that omits the column
--     stay exactly as they are today.

alter table public.visit_reports
  add column if not exists visibility text not null default 'public';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visit_reports_visibility_chk') then
    alter table public.visit_reports
      add constraint visit_reports_visibility_chk
      check (visibility in ('public', 'friends', 'legacy', 'anonymous'));
  end if;
end $$;

-- The legacy lane is queried per-venue for the Ledger surface (listLegacyForVenue
-- in lib/pintDropsStore.ts); a partial index keeps that scan cheap without
-- bloating the common visible-feed read (which filters visibility <> 'legacy').
create index if not exists visit_reports_legacy_venue_idx
  on public.visit_reports (venue_id, created_at desc)
  where visibility = 'legacy';
