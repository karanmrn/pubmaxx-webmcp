-- 0086: let the referral RPCs find pgcrypto's digest().
--
-- Migration 0060 pinned every referral function to `set search_path = public`,
-- but hosted Supabase installs pgcrypto in the `extensions` schema, so each
-- digest() call fails at runtime with "function digest(text, unknown) does not
-- exist". The visible symptom: POST /api/referrals/invite-link answers 503 and
-- "Invite a mate" never produces a link. Local test postgres installs pgcrypto
-- in public, and a nonexistent schema in search_path is silently skipped, so
-- `public, extensions` is safe on both (same reasoning as 0074's
-- social_post_digest). pg_temp stays last, matching 0007.

alter function public.get_or_create_referral_invite_code(uuid, text, text, timestamptz)
  set search_path = public, extensions, pg_temp;
alter function public.record_referral_edge(uuid, uuid, timestamptz)
  set search_path = public, extensions, pg_temp;
alter function public.claim_referral_code(text, uuid, timestamptz, timestamptz)
  set search_path = public, extensions, pg_temp;
alter function public.qualify_referral_from_contribution(uuid, text, text, timestamptz)
  set search_path = public, extensions, pg_temp;
alter function public.read_private_referral_status(uuid)
  set search_path = public, extensions, pg_temp;
alter function public.erase_referral_account(uuid)
  set search_path = public, extensions, pg_temp;
