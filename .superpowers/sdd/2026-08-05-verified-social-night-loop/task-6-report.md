# Task 6 report: composer, private media, and consent

## Status

Complete. Social remains behind existing preview and verified-adult access. No
migration was applied to a hosted database. No push or deployment was performed.

## Delivered

- Added a mobile-first, text-first Social composer with optional photo, Night
  Area, Mutual-only exact Venue, visibility, hashtags, comment policy, and
  feature-request post kind.
- Added bounded JSON and multipart parsing before image work. JPEG, PNG, and
  WebP input is normalised to bounded private JPEG media. Storage Object paths
  omit account, profile, and handle identifiers.
- Added account-bound local text and IndexedDB photo drafts. Failed submissions
  keep the request key. Account switches isolate drafts. Two open tabs warn
  through BroadcastChannel.
- Added idempotent create and remove requests. Exact photo replays use a stored
  owner, key, and digest decision, skip upload, and reach the durable
  idempotency RPC. Changed replays conflict. Generation-specific Storage Object
  keys and token-bound cleanup prevent stale workers from deleting retry media.
- Added explicit Photo Tag Proposal approval, decline, withdrawal,
  cancellation, and audience-change re-consent. Consent reads omit Social Post
  body text. Approved withdrawal remains reachable when a post or photo is not
  publishable. Each lane preserves data and exposes retry on HTTP or network
  failure.
- Added compare-and-swap editing, edited markers, immutable digest audit, exact
  media lifecycle audit, existing alt-text correction, photo replacement, and
  photo removal.
- Added revision-bound moderation, named staff held review, a paged owner
  outbox, honest visibility labels, signed private delivery budgets, and
  protected Venue lookup budgets.
- Added an independent `/api/cron/purge-social-media` cleanup route for failed
  uploads and detached media. Privacy copy states the staging and deletion
  windows.
- Migration 0074 refuses legacy non-null Task 3 photo references before it
  creates partial state. Rollback restores Task 3 rules and leaves profiles and
  blocks intact.

## Release review closure

Independent review rounds closed all Critical and Important findings. Final
product paths passed exact replay, cleanup ABA fencing, consent body privacy,
audience re-consent, withdrawal reachability, outbox pagination, media audit,
retention disclosure, and mobile proof checks. The last closure package removed
stale cached proof names and records current verification below.

## Verification

Focused closure suite: 13 files and 127 tests passed. Real PostgreSQL forward
and rollback proof passed 18/18, including exact photo replay without new
upload metadata, cleanup generation fencing, consent state, and rollback.

Full unit suite:

```sh
npm test
```

Result: 792 files and 7,928 tests passed in 109.80 seconds.

Static checks:

```sh
npm run typecheck
npm run lint
git diff --check
```

Result: typecheck passed. Lint passed with zero errors and 33 existing warnings.
Diff check passed. Worktree was clean.

Production build:

```sh
NEXT_DIST_DIR=.next-task6-ui-r4 npm run build
```

Result: 473 pages built. Existing `lib/ogBrand.tsx` Edge-runtime warnings remain.

Production browser proof:

```sh
PW_SCREENSHOTS=1 PW_SOCIAL_COMPOSER_PROOF=1 PW_NEXT_DIST_DIR=.next-task6-ui-r4 npx playwright test e2e/social-composer.spec.ts --project=chromium --workers=1
```

Result: 14/14 passed with Axe. Coverage includes text and photo posting, failed
draft recovery, exact retries, account and tab isolation, Venue selection,
Photo Tag Proposal consent and withdrawal, per-lane failure retry, alt-text
correction, photo removal, stale-edit recovery, owner outbox pagination, focus
containment, Escape return, reduced motion, no horizontal overflow, light and
dark themes, and 320, 390, 430, and 1280 px widths.

## Proof

Screenshots and command index: `docs/proof/social-composer/README.md`.

Both 390 px outbox proof files use final uncached names. Each shows the complete
header, action, 44 px control, and all six fixed mobile tabs.

## Release conditions

- Captain must apply migration 0074 after migrations 0072 and 0073.
- Social beta remains off until release owners assign moderation providers and
  approve access policy.
- Scheduled deletion depends on `/api/cron/purge-social-media` running with its
  configured cron secret.
