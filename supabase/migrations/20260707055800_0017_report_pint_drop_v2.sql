-- Durable per-actor report uniqueness (Feature B; closes the H1 window gap).
--
-- report_pint_drop (0004) blindly increments visit_reports.report_count, so the
-- ONLY thing stopping one actor double-counting a drop was the route's windowed
-- per-actor rate limit — which resets every window and on limiter cold-start.
-- The durable ledger already exists: pint_drop_reports with
-- unique (pint_drop_id, actor_hash) (0006 + 0008) — it was just never written.
--
-- This v2 makes the report path write that ledger FIRST and drive the counter
-- off the insert outcome:
--   • unknown drop id                     → return null (caller maps to a 404);
--   • fresh (drop, actor) pair           → insert the report row, then ONE atomic
--     UPDATE on visit_reports: increment report_count, stamp reported_at, keep
--     the first non-empty reason, hide at p_hide_threshold. Returns the new count;
--   • duplicate (drop, actor) pair       → idempotent no-op: the ON CONFLICT
--     DO NOTHING swallows the insert and the counter is NOT touched. Returns the
--     current count unchanged.
--
-- visit_reports.report_count stays the counter of record — it is NOT derived
-- from count(*) over pint_drop_reports, because pre-0017 counts have no report
-- rows behind them. The per-row UPDATE is atomic in Postgres (same guarantee as
-- 0004), so two concurrent FIRST reports by different actors can't lose an
-- increment, and two concurrent reports by the SAME actor race on the unique
-- constraint — exactly one wins the insert and bumps the counter.
--
-- 0004's report_pint_drop is deliberately KEPT (not dropped): the store calls
-- v2 and falls back to it until this migration is applied everywhere.

create or replace function report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  -- Unknown drop → null; the caller maps a null/absent result to a 404. Checked
  -- up front so a bad id returns cleanly instead of tripping the ledger's FK.
  if not exists (select 1 from public.visit_reports where id = p_id) then
    return null;
  end if;

  -- The durable per-actor ledger. ON CONFLICT (the 0006/0008 unique pair) makes
  -- a same-actor duplicate a silent no-op; FOUND tells us which case we're in.
  insert into public.pint_drop_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    -- Duplicate report by the same actor: idempotent — the counter, the reason,
    -- and the status are all left exactly as they are.
    select report_count into v_count
      from public.visit_reports
     where id = p_id;
    return v_count;
  end if;

  -- Fresh (drop, actor) report: same atomic single-UPDATE shape as 0004 —
  -- increment, stamp, keep the first non-empty reason, hide at the threshold.
  update public.visit_reports
     set report_count  = coalesce(report_count, 0) + 1,
         reported_at   = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status        = case
                           when coalesce(report_count, 0) + 1 >= p_hide_threshold
                             then 'hidden'
                           else status
                         end
   where id = p_id
   returning report_count into v_count;

  return v_count;
end;
$$;
