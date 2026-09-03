-- Ledger reconciliation: this RPC is already live in production (applied
-- 2026-08-27 from PR #1237, which then closed unmerged; this file records the
-- PR's final aligned body, where the Pint Drop mirrors the pennies of the
-- Community Price row that won ownership). One venue-sheet action owns one
-- Community Price and one Pint Drop: both rows commit together or neither
-- becomes visible. No app code calls it yet - reviving the one-tap pairing
-- lane or rolling this function back is an open captain decision; the ledger
-- records what production holds either way. Body matches production
-- pg_get_functiondef output; see 0127's header.

create or replace function public.create_one_tap_price_pair(
  p_venue_id text,
  p_drink_category text,
  p_price_pennies integer,
  p_actor text,
  p_contributor_handle text,
  p_submitted_at timestamptz,
  p_drop_id uuid,
  p_handle text,
  p_drink text,
  p_pint_photo_key text,
  p_venue_photo_key text,
  p_authority_key text
)
returns table (
  price_id uuid,
  price_pennies integer,
  submitted_at timestamptz,
  drop_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_price_id uuid;
  v_price_pennies integer;
  v_submitted_at timestamptz;
begin
  select saved.id, saved.price_pennies, saved.submitted_at
    into v_price_id, v_price_pennies, v_submitted_at
  from public.upsert_attributed_community_price_if_newer(
    p_venue_id,
    p_drink_category,
    p_price_pennies,
    p_actor,
    p_contributor_handle,
    p_submitted_at,
    null,
    null
  ) saved;

  if v_price_id is null then
    raise exception 'Community Price was not stored';
  end if;

  insert into public.pint_drops (
    id,
    venue_id,
    handle,
    drink,
    price_gbp,
    passed_down_note,
    era,
    vibe_tags,
    visibility,
    pint_photo_key,
    venue_photo_key,
    provenance,
    status,
    created_at,
    authority_key
  ) values (
    p_drop_id,
    p_venue_id,
    p_handle,
    p_drink,
    v_price_pennies::numeric / 100,
    '',
    '',
    '{}',
    'public',
    p_pint_photo_key,
    p_venue_photo_key,
    'contributor',
    'visible',
    p_submitted_at,
    p_authority_key
  );

  return query select v_price_id, v_price_pennies, v_submitted_at, p_drop_id;
end;
$$;

revoke all on function public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_one_tap_price_pair(
  text, text, integer, text, text, timestamptz, uuid, text, text, text, text, text
) to service_role;
