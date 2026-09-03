-- Restore 0075's social-boundary wrappers. The previous implementation still
-- owns the pre-0104 three-stop durable contract.

create or replace function public.replace_plan_route_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_stops jsonb,
  p_context jsonb,
  p_grounded_upgrade boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$ begin
  if public._social_plan_is_bound($1) then return 'not_found'; end if;
  return public._0075_replace_plan_route_atomic($1, $2, $3, $4, $5, $6);
end $$;

create or replace function public.decide_plan_route_proposal_atomic(
  p_plan_id uuid,
  p_proposal_id uuid,
  p_token_hash text,
  p_decision text,
  p_idempotency_key text,
  p_decided_at timestamptz
) returns text
language plpgsql
security definer
set search_path = ''
as $$ begin
  if public._social_plan_is_bound($1) then return 'not_found'; end if;
  return public._0075_decide_plan_route_proposal_atomic($1, $2, $3, $4, $5, $6);
end $$;
