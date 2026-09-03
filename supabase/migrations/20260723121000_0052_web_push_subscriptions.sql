-- Extend the identity-free push registry to installed web apps. A web token is
-- a compact serialized PushSubscription (endpoint + browser-generated keys),
-- so it needs a larger bound than an APNs device token. This is additive data:
-- existing iOS/Android rows remain valid and unchanged.

alter table public.push_tokens
  drop constraint if exists push_tokens_token_check,
  drop constraint if exists push_tokens_platform_check;

alter table public.push_tokens
  add constraint push_tokens_token_check
    check (char_length(btrim(token)) between 1 and 2048),
  add constraint push_tokens_platform_check
    check (platform in ('ios', 'android', 'web'));

comment on column public.push_tokens.platform is
  'Delivery transport only (ios, android, web). Deliberately carries no user or Plan identity.';
