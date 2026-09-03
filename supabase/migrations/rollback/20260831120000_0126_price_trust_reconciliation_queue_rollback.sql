-- Rollback 0126: remove price trust reconciliation work.
--
-- Lossy by design: existing trust events and credits remain, but pending pairs
-- stop retrying until the migration is applied again or a direct sync succeeds.

begin;

drop trigger if exists community_prices_queue_price_trust
  on public.community_prices;
drop function if exists public.queue_community_price_trust_reconciliation();
drop function if exists public.enqueue_price_trust_reconciliation(text, text);

drop policy if exists price_trust_reconciliation_queue_authenticated_deny
  on public.price_trust_reconciliation_queue;
drop policy if exists price_trust_reconciliation_queue_anon_deny
  on public.price_trust_reconciliation_queue;

drop index if exists public.price_trust_reconciliation_queue_enqueued_idx;
drop table if exists public.price_trust_reconciliation_queue;
drop sequence if exists public.price_trust_reconciliation_version_seq;

commit;
