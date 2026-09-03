-- Pin helper lookup to pg_catalog and explicitly-qualified public functions.
-- This removes role-controlled search_path resolution from validation helpers
-- used by night_signal_claims constraints.

alter function public.night_signal_public_url(text)
  set search_path = '';

alter function public.night_signal_source_host(text)
  set search_path = '';

alter function public.night_signal_iso_timestamp(text)
  set search_path = '';

alter function public.night_signal_independent_corroboration(text, text, timestamptz, jsonb)
  set search_path = '';
