-- A public handle is presentation, not proof of an independent contributor.
-- Store one per-venue pseudonym derived by the server from a verified PUBMAXX
-- User ID. Rows without a key remain visible provisional observations but can
-- never corroborate a Pint Price on authority-bearing surfaces.

alter table public.visit_reports
  add column if not exists authority_key text;

comment on column public.visit_reports.authority_key is
  'Server-derived per-venue pseudonym for verified Pint Price corroboration. Null is provisional.';
