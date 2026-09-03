# Task 4 report: Social interactions and governance

Status: complete. Fresh review found no remaining Critical or Important
findings.

## Delivered

- Added one verified Social interaction boundary for Cheers, private saves,
  reposts, held comments, held quote posts, comment policy, blocks,
  notifications, feature-request governance, reader reports and staff
  moderation.
- Desired-state writes use stable profile ownership and database uniqueness.
  Comments, quotes and feature updates use hashed idempotency keys plus payload
  digests. Reusing a key for different content is rejected.
- Added bounded, viewer-and-collection-bound HMAC cursors for Cheers, comments,
  private saves, derivatives, notifications, feature history, feature queue and
  report queue. Feeds and queues remain chronological.
- Saves remain private. They expose no count and produce no notification.
  Engagement never enters feed ordering, pub ranking, map price authority or
  paid reach.
- Comments and quotes remain held until OpenAI returns an approval. Provider
  failures retry with bounded backoff, terminal failures remain held, expired
  worker leases recover, and one failed item does not starve its batch.
- Author comment policy is enforced transactionally. A real PostgreSQL race
  proves comment creation cannot pass a concurrent author lock.
- Reposts, quotes, counts, notifications and report targets re-authorise the
  source on every read. Quote visibility intersects source visibility. Blocks
  reduce both sides without deleting provenance.
- In-app notifications store stable IDs and source references, never copied
  protected text or display handles. Self actions and saves produce none.
- Feature requests keep append-only staff history and update the canonical post
  status cache in the same transaction. A PostgreSQL concurrency proof catches
  and prevents update-lock deadlocks.
- Reader reports deduplicate without hiding content. Named moderators can read
  the private queue, hide or restore only queued comment and quote targets,
  resolve reports explicitly, and retain staff-role audit identity.
- Ordinary writes obey the emergency Social freeze. Reporting and moderation
  safety floors remain open, and immediate threat or doxxing reports bypass the
  ordinary write budget.
- Added migration `0073`, rollback, minute moderation cron, legal disclosure and
  write-surface certification. Every new table and function is service-role
  only with RLS enabled and browser roles revoked.

## TDD and review evidence

Red evidence was captured before each implementation or hardening seam:

- Domain, store and route suites first failed on missing modules.
- Migration proof first failed because `0073` did not exist.
- Desired-state retries, held moderation, comment-lock races, source visibility,
  cursor scope, private saves, reports, staff identity and production store
  selection each failed before implementation.
- Review regressions reproduced immediate reports being frozen, private quote
  IDs entering the report queue, the missing staff report workflow, stale
  canonical feature status, expired moderation leases and a real PostgreSQL
  feature-update deadlock. Final concurrency rerun also exposed transaction-start
  timestamps disagreeing with lock order; history now timestamps after the row
  lock with wall-clock time.
- Legal and write certification tests failed before current disclosure and the
  78-route inventory update.

Final reviewer verdict: ready, with no remaining Critical or Important
findings. Review specifically rechecked freeze safety floors, quote/source
visibility, report authority and audit, canonical feature status, lease
recovery, browser grants and rollback.

## Verification

- Full repository suite, single worker: 774 files and 7,810 tests passed in
  688.70 seconds.
- Final focused domain, route, legal, certification, Pub Pal warning and real
  PostgreSQL set: 7 files and 68 tests passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- Real PostgreSQL 16 forward, retry, visibility, lock-race, feature concurrency,
  private-grant and rollback proof passes.
- `git diff --check`: exit 0 before commit.
- Full-suite output exposed two existing unawaited Pub Pal test assertions.
  They are corrected in this change and receive an isolated regression run.

## Deployment note

Captain applies the `0073_social_interactions` forward migration after `0072`.
Agents did not apply production SQL. Current forward and rollback paths live in
`supabase/migrations/` and `supabase/migrations/rollback/`.

## Deliberate push boundary

Social delivers in-app notifications first. Existing web-push subscriptions are
opt-in but are not identity-bound strongly enough for protected Social
targeting. Task 4 therefore does not copy protected Social events into that
legacy push path. A future Social push seam must bind subscription ownership to
the stable verified profile and re-authorise source visibility at send time.
