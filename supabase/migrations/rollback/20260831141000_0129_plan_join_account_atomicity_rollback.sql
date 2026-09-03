drop function if exists public.redeem_plan_invite_account_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text, uuid
);
drop function if exists public.join_plan_account_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text, uuid
);
