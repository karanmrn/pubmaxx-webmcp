-- Founding members (0097): the first hundred claimed handles carry a number.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT THE NUMBER IS: a position, and nothing else. No capability anywhere in
-- this product reads it. `lib/foundingMembers.ts` owns that rule on the app
-- side; here the column is a plain integer with a cap, deliberately carrying no
-- tier, no entitlement and no grant of any kind.
--
-- WHY A LOCK OF ITS OWN: `claim_pubmaxx_handle` already takes an advisory lock
-- keyed on the HANDLE, which keeps two people off one handle. It says nothing
-- about two people racing for the same NUMBER, because they are claiming
-- different handles and so take different locks. The cohort therefore needs one
-- lock on one constant key, held for the transaction, around read-count-then-
-- write. The unique index below is the second line: if the lock were ever
-- wrong, a duplicate number fails the write rather than printing twice.
--
-- WHY A TOMBSTONE KEEPS ITS NUMBER: recycling No. 7 would make the mark
-- ambiguous - two people, one number, and a wall that cannot say which. A
-- departed founder keeps the slot and simply stops appearing on the wall, so
-- the live list may have gaps. Gaps are honest; a reused number is not.
--
-- RLS: `founding_member_number` lives on public.profiles, which already carries
-- owner-only SELECT (`profiles_owner_select`, migration 0067) plus service-role
-- writes, so the column inherits that posture and needs no new policy. The
-- public founders wall reads through the service role like every other app
-- store. Any future policy on this table must call
-- `pubmax_private.rls_owns_profile(...)`: migration 0070 moved the helpers out
-- of `public`, and a policy naming the old schema fails to create rather than
-- failing open. The grant helper below is likewise `pubmax_private.*`.

begin;

alter table public.profiles
  add column if not exists founding_member_number integer;

comment on column public.profiles.founding_member_number is
  'Position among the first 100 claimed handles (1..100), or null. Public by design. Grants no capability anywhere: founding buys belonging only.';

-- Drop and recreate so re-apply stays idempotent on the CHECK shape.
alter table public.profiles
  drop constraint if exists profiles_founding_member_number_check;

alter table public.profiles
  add constraint profiles_founding_member_number_check
  check (
    founding_member_number is null
    or (founding_member_number >= 1 and founding_member_number <= 100)
  );

-- One number, one profile. The second line of defence behind the advisory lock.
create unique index if not exists profiles_founding_member_number_key
  on public.profiles (founding_member_number)
  where founding_member_number is not null;

-- The wall reads this order directly.
create index if not exists profiles_founding_member_wall_idx
  on public.profiles (founding_member_number)
  where founding_member_number is not null
    and user_id is not null
    and tombstoned_at is null;

-- ── The grant ────────────────────────────────────────────────────────────────
-- Returns the profile's founding number, granting the next one when the cohort
-- is not full yet. Idempotent: a profile that already holds a number gets that
-- number back and the counter does not move.
create or replace function pubmax_private.grant_founding_member_number(
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pubmax_private, public
as $$
declare
  v_existing integer;
  v_taken integer;
  v_highest integer;
begin
  if p_profile_id is null then
    return null;
  end if;

  -- ONE key for the whole cohort, held to the end of the transaction. Every
  -- concurrent claim queues here, so the count each one reads is already the
  -- count after every earlier grant committed.
  perform pg_advisory_xact_lock(hashtextextended('pubmax:founding_member_number', 0));

  select founding_member_number into v_existing
    from public.profiles
   where id = p_profile_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Only a claimed, live handle is owed a number. An unowned legacy row and a
  -- tombstoned account are both outside the cohort.
  if not exists (
    select 1 from public.profiles
     where id = p_profile_id
       and user_id is not null
       and tombstoned_at is null
  ) then
    return null;
  end if;

  select count(*), coalesce(max(founding_member_number), 0)
    into v_taken, v_highest
    from public.profiles
   where founding_member_number is not null;

  -- Both guards, because they answer different questions: the count says the
  -- cohort is full, the highest says the next number would be out of range if a
  -- gap were ever introduced by hand.
  if v_taken >= 100 or v_highest >= 100 then
    return null;
  end if;

  update public.profiles
     set founding_member_number = v_highest + 1,
         updated_at = now()
   where id = p_profile_id;

  return v_highest + 1;
end;
$$;

revoke all on function pubmax_private.grant_founding_member_number(uuid)
  from public, anon, authenticated;
grant execute on function pubmax_private.grant_founding_member_number(uuid)
  to service_role;

-- ── The claim path ───────────────────────────────────────────────────────────
-- Migration 0071's body, with the founding grant added to both success exits.
-- The grant runs inside the claim's own transaction, so a claim that rolls back
-- never burns a number.
create or replace function public.claim_pubmaxx_handle(
  p_user_id uuid,
  p_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
  v_founding integer;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid',
      'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in (
    'admin', 'api', 'help', 'moderation', 'official', 'pubmaxx',
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system'
  ) or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$'
  then
    return jsonb_build_object('ok', false, 'code', 'reserved',
      'error', 'That handle is reserved.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));

  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true)
    on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
      -- Idempotent re-claim: an account claimed before this migration shipped
      -- and still inside the cohort gets its number here rather than never.
      v_founding := pubmax_private.grant_founding_member_number(v_profile.id);
      return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
        'handle', v_handle, 'founding_member_number', v_founding);
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;

  select * into v_profile from public.profiles
   where lower(handle) = v_handle limit 1 for update;
  if found then
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;
  if exists (
    select 1 from public.profile_handle_aliases where lower(handle) = v_handle
  ) then
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;

  insert into public.profiles(user_id, handle)
  values (p_user_id, v_handle)
  returning * into v_profile;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
  values (v_profile.id, v_handle, true);
  v_founding := pubmax_private.grant_founding_member_number(v_profile.id);
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
    'handle', v_handle, 'founding_member_number', v_founding);
exception when unique_violation then
  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;
  return jsonb_build_object('ok', false, 'code', 'taken',
    'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- The accounts already here earned their places by arriving first, so the order
-- is the order they were created in. `id` breaks a same-timestamp tie so the
-- result is deterministic on any replica. The founder's own accounts are the
-- oldest rows, which is why they come out as No. 1 and No. 2 naturally rather
-- than being seeded by hand.
with ranked as (
  select
    id,
    row_number() over (order by created_at asc, id asc) as position
  from public.profiles
  where user_id is not null
    and tombstoned_at is null
    and founding_member_number is null
)
update public.profiles p
   set founding_member_number = ranked.position,
       updated_at = now()
  from ranked
 where p.id = ranked.id
   and ranked.position <= 100
   and not exists (
     select 1 from public.profiles taken
      where taken.founding_member_number is not null
   );

commit;
