-- Visit Report review lane (0059). Adds only observed visit conditions and the
-- index used by exact per-contributor counts. Legacy recommendation columns stay
-- nullable so applying this migration never discards an older row.

alter table public.structured_visit_reports
  add column if not exists noise text,
  add column if not exists seating text,
  add column if not exists service_wait text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'svr_noise_check') then
    alter table public.structured_visit_reports
      add constraint svr_noise_check
      check (noise is null or noise in ('easy-to-talk', 'loud', 'had-to-shout'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'svr_seating_check') then
    alter table public.structured_visit_reports
      add constraint svr_seating_check
      check (seating is null or seating in ('plenty', 'tight', 'standing'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'svr_service_wait_check') then
    alter table public.structured_visit_reports
      add constraint svr_service_wait_check
      check (service_wait is null or service_wait in ('quick', 'some-wait', 'long'));
  end if;
end $$;

create index if not exists structured_visit_reports_contributor_idx
  on public.structured_visit_reports (handle, status);

-- Moderator review queue, as the admin route actually reads it: flagged rows
-- with no standing decision, newest flag first. 0046's review index leads on
-- `status`, which this queue no longer filters on, so it can't serve the read.
create index if not exists structured_visit_reports_flagged_review_idx
  on public.structured_visit_reports (reported_at desc)
  where moderated_at is null and report_count > 0;

alter table public.structured_visit_reports enable row level security;
revoke all on public.structured_visit_reports from anon, authenticated;
grant all on public.structured_visit_reports to service_role;
