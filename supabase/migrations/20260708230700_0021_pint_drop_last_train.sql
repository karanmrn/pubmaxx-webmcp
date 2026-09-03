-- Wave G1: persist Last Train context captured at Spill compose time.
-- Additive columns on visit_reports so feed/venue stamps can use the drop's
-- own leave-by + decision (honest before/after badges via lastTrainBadge).
-- Null when the composer had no live decision (or TfL was down).

alter table public.visit_reports
  add column if not exists leave_by_iso timestamptz,
  add column if not exists last_train_decision text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visit_reports_last_train_decision_chk'
  ) then
    alter table public.visit_reports
      add constraint visit_reports_last_train_decision_chk
      check (
        last_train_decision is null
        or last_train_decision in (
          'order_one_more',
          'half_pint_only',
          'settle_up_now',
          'train_risk'
        )
      );
  end if;
end $$;
