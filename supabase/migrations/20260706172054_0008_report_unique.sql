-- Per-actor-unique pint-drop reports (security audit: report-spam gap).
--
-- Background: 0006_social_layer.sql declares public.pint_drop_reports with an
-- inline `unique (pint_drop_id, actor_hash)` — but that clause only applies when
-- the table is created fresh. A table created by an earlier draft of 0006 (which
-- used `create table if not exists`) can already exist WITHOUT the constraint,
-- leaving one actor able to insert unlimited reports against the same drop and
-- inflate the hide-threshold counter. The route-level per-actor rate limit
-- (app/api/pint-drops/route.ts) is the first line of defence; this migration is
-- the durable backstop — a second report by the same actor becomes a constraint
-- violation the write path can treat as an idempotent no-op.
--
-- Idempotent + re-runnable, matching the style of 0006:
--   • guarded ADD CONSTRAINT inside a DO block (ADD CONSTRAINT has no
--     IF NOT EXISTS), keyed on pg_constraint.conname so re-applying is a no-op;
--   • table existence is guarded too, so this migration is safe even if applied
--     out of order relative to 0006.

do $$
begin
  -- Only act once the reports table exists (0006). If it doesn't, there is
  -- nothing to constrain yet — 0006 will create it with the constraint inline.
  if to_regclass('public.pint_drop_reports') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'pint_drop_reports_actor_unique'
     )
  then
    alter table public.pint_drop_reports
      add constraint pint_drop_reports_actor_unique
      unique (pint_drop_id, actor_hash);
  end if;
end $$;
