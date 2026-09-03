-- 0087: private gender on private_account_identities.
--
-- The profile editor gains gender beside full name and sex. Gender is a
-- closed set plus a self-described free-text line. Both stay private: the
-- table is owner SELECT only under RLS wave 2 and writes go through the
-- service role. No public route reads these columns.

alter table public.private_account_identities
  add column if not exists gender text,
  add column if not exists gender_self_described text;

alter table public.private_account_identities
  add constraint private_identity_gender_check
    check (
      gender is null
      or gender in ('woman', 'man', 'non_binary', 'self_described', 'prefer_not_to_say')
    ),
  add constraint private_identity_gender_self_described_check
    check (
      gender_self_described is null
      or (
        gender = 'self_described'
        and char_length(gender_self_described) between 1 and 60
      )
    );
