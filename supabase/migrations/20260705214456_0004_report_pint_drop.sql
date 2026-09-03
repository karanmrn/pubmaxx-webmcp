-- Atomic public report (H4 + launch-PRD report-abuse threshold).
--
-- reportDropRemote used to read report_count then write n+1 — two concurrent
-- reports lose one. This single UPDATE increments the count, stamps the
-- report, and hides the drop only once the count reaches the threshold
-- (REPORT_HIDE_THRESHOLD in lib/pintDrops.ts, passed by the caller — one
-- unauthenticated report must never hide public content by itself).
-- Returns the new count, or no row when the id is unknown (caller maps that
-- to a 404). A per-row UPDATE is atomic in Postgres, so no explicit locking.

create or replace function report_pint_drop(p_id uuid, p_reason text, p_hide_threshold int)
returns int
language sql
as $$
  update visit_reports
     set report_count  = coalesce(report_count, 0) + 1,
         reported_at   = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status        = case
                           when coalesce(report_count, 0) + 1 >= p_hide_threshold
                             then 'hidden'
                           else status
                         end
   where id = p_id
   returning report_count;
$$;

-- Supersedes the interim increment-only helper from an earlier draft of this
-- migration, if it was ever applied.
drop function if exists increment_report_count(uuid);
