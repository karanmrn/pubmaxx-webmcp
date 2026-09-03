-- Canonical operator-facing Planned Nights Completed (PNC) metric seam.
--
-- plan_completions remains the source of truth. This view deliberately exposes
-- only qualified, privacy-minimised completion facts: no member capability,
-- account, handle, venue name, free text, or precise location is present.
-- Browser roles cannot query it; production reporting uses the server-held
-- service role.

create or replace view public.pnc_qualified_completions
with (security_invoker = true)
as
select
  completion.id as completion_id,
  completion.plan_id,
  completion.completed_at,
  (completion.completed_at at time zone 'UTC')::date as completion_day_utc,
  completion.ending,
  completion.route_revision,
  completion.qualifying_arrival_at
from public.plan_completions completion
where completion.qualifying_arrival_action_id is not null
  and completion.qualifying_arrival_stop_position is not null
  and completion.qualifying_arrival_at is not null
  and completion.qualifying_arrival_at <= completion.completed_at
  and completion.ending_selection is not null;

comment on view public.pnc_qualified_completions is
  'One privacy-minimised row per qualified Planned Night Completion; service-role reporting only.';

revoke all on public.pnc_qualified_completions from public, anon, authenticated;
grant select on public.pnc_qualified_completions to service_role;
