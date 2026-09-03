-- Author-confirmed photo alt text (0047): durable backing for Wayfinder 5.6.
-- A Story photo (a night_moments row that carries media_object_key) must have an
-- author-CONFIRMED description before it can be published, so people who cannot
-- see the photo can still experience it. AI may one day *suggest* the text, but
-- only a human save confirms it — modelled as two additive columns.
--
-- Additive & idempotent. Apply AFTER 0046. House style mirrors recent migrations
-- (0043/0045/0046):
--   • `add column if not exists` — re-runnable, never rewrites existing rows.
--   • Pre-existing rows get NULL for both columns, i.e. "no confirmed description
--     yet". This is deliberate and safe: the publish GATE lives in app code
--     (lib/nightMemory.ts + lib/nightMemoryStore.ts), and ALREADY-PUBLISHED
--     Stories are grandfathered there — this migration never unpublishes anything.
--   • No functions/RPCs are defined here, so there is no function search_path to
--     pin (the search_path hardening obligation applies to SECURITY DEFINER
--     functions; there are none in this file).
--   • RLS/grants are inherited from the existing night_moments table — reads and
--     writes flow through the service-role admin client, unchanged.
--
-- ⚠️ NOT APPLIED this session — ships as SQL only; the OWNER applies via
-- MCP / `supabase db push` and runs the advisor pass. Fail-soft posture:
--   • Reads: momentFromRow tolerates the columns being absent (reports null).
--   • Writes: a Moment saved WITHOUT alt text never references these columns, so
--     private capture keeps working pre-apply. A photo saved WITH a description,
--     and any publish of a photo, needs the columns present — so apply this WITH
--     the release that ships the 5.6 code, before authors describe photos.
--
-- IDENTITY / PRIVACY:
--   • alt_text is author-written free text describing their own photo. Capped at
--     200 chars (mirrors NIGHT_MOMENT_ALT_TEXT_MAX in lib/nightMemory.ts). No PII
--     beyond what the author chooses to write; the same trust posture as caption.

alter table public.night_moments
  add column if not exists alt_text text;

alter table public.night_moments
  add column if not exists alt_text_confirmed_at timestamptz;

-- Length guard (defence in depth): the real cap lives in lib/nightMemory.ts's
-- cleanText(..., NIGHT_MOMENT_ALT_TEXT_MAX); the DB refuses an over-long value
-- too. NULL is always allowed (the description is optional until publication).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'night_moments_alt_text_len_check') then
    alter table public.night_moments
      add constraint night_moments_alt_text_len_check
      check (alt_text is null or length(alt_text) <= 200);
  end if;
end $$;
