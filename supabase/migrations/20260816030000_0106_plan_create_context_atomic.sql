create function public.create_plan_with_context_idempotent_atomic(
  p_id uuid,
  p_title text,
  p_start_time timestamptz,
  p_stops jsonb,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_anchor_venue_id text,
  p_anchor_source text,
  p_outcome text,
  p_context jsonb
) returns text
language plpgsql security invoker set search_path = public
as $$
declare
  create_result text;
begin
  create_result := public.create_plan_idempotent_atomic(
    p_id,
    p_title,
    p_start_time,
    p_stops,
    p_member_id,
    p_member_name,
    p_token_hash,
    p_joined_at,
    p_idempotency_key_hash,
    p_request_hash,
    p_anchor_venue_id,
    p_anchor_source,
    p_outcome
  );

  -- A replay is not a second creation: the Plan already carries its context,
  -- may since have been adopted by a Social crew, and may have had its context
  -- edited. Only a genuine creation stamps one.
  if create_result <> 'created' or p_context is null then
    return create_result;
  end if;

  update public.plans
  set night_context = p_context
  where id = p_id
    and creation_key_hash = p_idempotency_key_hash
    and creation_request_hash = p_request_hash
    and social_owner_account_id is null;

  if not found then
    raise exception 'plan context write failed';
  end if;

  return create_result;
end;
$$;

revoke all on function public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_plan_with_context_idempotent_atomic(uuid,text,timestamptz,jsonb,uuid,text,text,timestamptz,text,text,text,text,text,jsonb)
  to service_role;
