-- Pint Drops and Visit Reports are different domain objects. The original Pint
-- Drop table was named visit_reports before structured Visit Reports existed.
-- Rename that physical table in place so rows, foreign keys, policies, indexes,
-- and publication membership keep their object identity. A security-invoker
-- view keeps the previous server release compatible during migration rollout.

begin;

do $$
declare
  legacy_kind "char";
begin
  select c.relkind
    into legacy_kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'visit_reports';

  if to_regclass('public.pint_drops') is null then
    if legacy_kind is null or legacy_kind not in ('r', 'p') then
      raise exception 'Pint Drop source table public.visit_reports is missing';
    end if;
    alter table public.visit_reports rename to pint_drops;
  elsif legacy_kind in ('r', 'p') then
    raise exception 'Both public.pint_drops and physical public.visit_reports exist';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'pint_drops'
       and policyname = 'visit_reports_public_surface_select'
  ) then
    alter policy visit_reports_public_surface_select
      on public.pint_drops rename to pint_drops_public_surface_select;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'pint_drops'
       and policyname = 'visit_reports_anon_deny'
  ) then
    alter policy visit_reports_anon_deny
      on public.pint_drops rename to pint_drops_anon_deny;
  end if;
end
$$;

comment on table public.pint_drops is
  'Community Pint Drops. Structured Visit Reports live in public.structured_visit_reports.';

create or replace view public.visit_reports
with (security_invoker = true)
as
select * from public.pint_drops;

comment on view public.visit_reports is
  'Deprecated compatibility view for the pre-0118 Pint Drop table name. New code uses public.pint_drops.';

revoke all on public.visit_reports from public, anon, authenticated;
grant select on public.visit_reports to authenticated;
grant select, insert, update, delete on public.visit_reports to service_role;

-- Legacy RPC retained only for an old server release during rollout.
create or replace function public.report_pint_drop(
  p_id uuid,
  p_reason text,
  p_hide_threshold int
)
returns int
language sql
set search_path = ''
as $$
  update public.pint_drops
     set report_count = coalesce(report_count, 0) + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         status = case
                    when coalesce(report_count, 0) + 1 >= p_hide_threshold
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning report_count;
$$;

create or replace function public.report_pint_drop_v2(
  p_id uuid,
  p_actor_hash text,
  p_reason text,
  p_hide_threshold int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_count int;
begin
  if not exists (select 1 from public.pint_drops where id = p_id) then
    return null;
  end if;

  insert into public.pint_drop_verified_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    select verified_report_count into v_count
      from public.pint_drops
     where id = p_id;
    return v_count;
  end if;

  update public.pint_drops
     set verified_report_count = verified_report_count + 1,
         reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                          when moderated_at is not null then null
                          else moderated_at
                        end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end,
         status = case
                    when verified_report_count + 1 >= greatest(p_hide_threshold, 1)
                      then 'hidden'
                    else status
                  end
   where id = p_id
   returning verified_report_count into v_count;

  return v_count;
end;
$$;

create or replace function public.report_pint_drop_anonymous(
  p_id uuid,
  p_actor_hash text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if not exists (select 1 from public.pint_drops where id = p_id) then
    return false;
  end if;

  insert into public.pint_drop_reports (pint_drop_id, actor_hash, reason)
  values (p_id, p_actor_hash, nullif(p_reason, ''))
  on conflict (pint_drop_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    return true;
  end if;

  update public.pint_drops
     set reported_at = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason),
         moderated_at = case
                          when moderated_at is not null then null
                          else moderated_at
                        end,
         moderator_note = case
                            when moderated_at is not null then null
                            else moderator_note
                          end
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.report_pint_drop_v2(uuid, text, text, int)
  from public, anon, authenticated;
grant execute on function public.report_pint_drop_v2(uuid, text, text, int)
  to service_role;
revoke all on function public.report_pint_drop_anonymous(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.report_pint_drop_anonymous(uuid, text, text)
  to service_role;

commit;
