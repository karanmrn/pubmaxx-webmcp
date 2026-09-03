alter table public.round_spends
  add column if not exists promotion_actor text;

revoke all on public.round_spends from anon, authenticated;
