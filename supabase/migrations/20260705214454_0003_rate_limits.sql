-- Durable rate limiting for Pint Drop writes (PRD P3 item 9).
--
-- One row per limiter key. Submission keys are "drop:<handle>:<sha256(salt+ip)>"
-- — the IP is hashed server-side (lib/supabase.ts) before it ever reaches this
-- table; raw IPs are never stored. Report keys stay "report:<drop-id>" (a
-- per-drop cap, matching the in-memory semantics).
--
-- check_rate_limit is ONE atomic round trip: prune timestamps outside the
-- window, record this hit, return whether the caller is now over the limit.
-- Semantics match lib/pintDrops.ts isRateLimited: the hit is recorded even
-- when limited, and "limited" means more than p_limit hits in the window.

create table if not exists rate_limits (
  key        text primary key,
  hits       timestamptz[] not null default '{}',
  updated_at timestamptz   not null default now()
);

-- Service-role only: RLS on with no policies, so anon/authenticated clients
-- can neither read nor tamper with limiter state.
alter table rate_limits enable row level security;

create or replace function check_rate_limit(p_key text, p_limit int, p_window_ms int)
returns boolean
language plpgsql
as $$
declare
  cutoff timestamptz := now() - make_interval(secs => p_window_ms / 1000.0);
  n int;
begin
  -- Ensure the row exists, then take the row lock via UPDATE — concurrent
  -- callers for the same key serialise here, so the check-and-increment is
  -- atomic without any application-side retry.
  insert into rate_limits (key) values (p_key)
  on conflict (key) do nothing;

  update rate_limits
     set hits = array(select t from unnest(hits) t where t > cutoff) || now(),
         updated_at = now()
   where key = p_key
   returning cardinality(hits) into n;

  return n > p_limit;
end;
$$;
