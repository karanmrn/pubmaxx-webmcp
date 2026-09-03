-- Pint Drops persistence. Mirrors the PintDrop shape in lib/pintDrops.ts
-- (snake_case). Writes go through the service role only (server route);
-- the public read is limited to visible rows.
--
-- Storage bucket (create once, out of band — buckets are not SQL objects):
--   In the Supabase dashboard (Storage) or via the Management API, create a
--   bucket named `pint-drops` with PUBLIC READ enabled. Two objects per drop:
--   `${venue_id}/${id}/pint.${ext}` and `${venue_id}/${id}/venue.${ext}`; their
--   keys live in visit_reports.pint_photo_key / venue_photo_key.
--
--   Bucket policy: PUBLIC READ, service-role-only write. A public bucket serves
--   every object at a stable /storage/v1/object/public/pint-drops/<key> URL — the
--   server hands those URLs out via toDTO() only for `visible` rows, but a public
--   bucket has no per-object gate, so a hidden row's object stays fetchable by
--   anyone who kept the URL. Acceptable for the prototype (keys are UUID-pathed,
--   unguessable); if a takedown must actually revoke access, switch to a private
--   bucket + signed URLs. Uploads/deletes are done by the service role from the
--   server (uploadPhoto/deletePhotos), so no anon write policy is needed.

create extension if not exists "pgcrypto";

create table if not exists public.visit_reports (
  id               uuid primary key default gen_random_uuid(),
  venue_id         text not null,
  handle           text not null,
  drink            text,
  price_gbp        numeric,          -- null for note-only anecdotes
  passed_down_note text,
  era              text,
  pint_photo_key   text,             -- Storage object key in the pint-drops bucket
  provenance       text,            -- 'contributor' (priced) | 'anecdote' (note-only)
  status           text not null default 'visible', -- 'visible' | 'hidden' | 'pending'
  created_at       timestamptz not null default now()
);

-- Two-photo support + moderation columns. ADD COLUMN IF NOT EXISTS so a table
-- created by an earlier version of this file upgrades in place and old rows
-- (no venue photo, never reported) still read fine as NULL/0.
alter table public.visit_reports
  add column if not exists venue_photo_key text,   -- Storage key in the pint-drops bucket
  add column if not exists reported_at    timestamptz,
  add column if not exists report_reason  text,
  add column if not exists report_count   int not null default 0,
  add column if not exists moderated_at   timestamptz,
  add column if not exists moderator_note text;

-- CHECK constraints, added idempotently (ADD CONSTRAINT has no IF NOT EXISTS, so
-- guard each with a catalog lookup). A drop must carry at least one signal.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visit_reports_status_chk') then
    alter table public.visit_reports
      add constraint visit_reports_status_chk
      check (status in ('visible', 'hidden', 'pending'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visit_reports_provenance_chk') then
    alter table public.visit_reports
      add constraint visit_reports_provenance_chk
      check (provenance is null or provenance in ('sourced', 'contributor', 'anecdote'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visit_reports_price_chk') then
    alter table public.visit_reports
      add constraint visit_reports_price_chk
      check (price_gbp is null or (price_gbp > 0 and price_gbp <= 20));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'visit_reports_signal_chk') then
    alter table public.visit_reports
      add constraint visit_reports_signal_chk
      check (
        price_gbp is not null
        or (passed_down_note is not null and passed_down_note <> '')
        or pint_photo_key is not null
        or venue_photo_key is not null
      );
  end if;
end $$;

create index if not exists visit_reports_venue_created_idx
  on public.visit_reports (venue_id, created_at desc);

alter table public.visit_reports enable row level security;

-- Public can read visible drops only. Hidden/pending stay server-side.
drop policy if exists visit_reports_public_read on public.visit_reports;
create policy visit_reports_public_read
  on public.visit_reports
  for select
  using (status = 'visible');

-- No anon INSERT policy: with RLS on and no permissive policy, anon/authenticated
-- inserts are denied. The service role bypasses RLS, so only the server route writes.
