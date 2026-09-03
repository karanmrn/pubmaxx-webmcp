# Weekly email digest — "your London week in pints"

Cycle 8 PRD, item 2. A weekly reach channel that mirrors the push story: **one
provider seam, no-op until keys, honest content from real data only.** Nothing
is sent today — this is the scaffold that activates the moment an email provider
and per-user opt-in exist.

## Architecture (three seams)

| Concern | File | Notes |
| --- | --- | --- |
| Delivery provider | `lib/emailProvider.ts` | `EmailProvider.send(messages)`; `noopEmailProvider` (active until keys) / `resendEmailProvider` (stub). `selectEmailProvider()` picks by env — same shape as `lib/pushProvider.ts` and `lib/storeBackend.ts`. |
| Content generator + render | `lib/weeklyDigest.ts` | Pure + unit-tested. `generateWeeklyDigest(input)` → structured digest; `renderWeeklyDigestHtml` / `renderWeeklyDigestText`; `resolveDigestRecipients` (opt-in gate). Imports no store/env/fs. |
| Trigger | `scripts/send_weekly_digest.mjs` + `.github/workflows/weekly-digest.yml` | Batch orchestration + safety gates. Cron is commented out until keys land; manual dispatch exercises the safe no-op. |

The generator is deliberately decoupled from the app's large `Venue` type: the
script normalises real datasets into small `Digest*` input records (prices in
**GBP**, ISO `observedAt`), so composition stays pure and testable.

## Provider decision — Resend (default), Postmark (alternative)

**Recommended: Resend.** First-class transactional API, generous free tier, a
single `POST https://api.resend.com/emails` send, and DKIM/SPF via a verified
domain. Set:

- `RESEND_API_KEY` — server-only API key.
- `EMAIL_FROM` — a **verified** sender, e.g. `hello@pubmaxxing.com` (already on
  the owner queue).

The real transport is a later drop-in inside `resendEmailProvider.send` (shape
fully specified in `lib/emailProvider.ts`): per-message POST with
`Authorization: Bearer <key>` and `{ from, to, subject, html, text }`, mapping
`200 → sent`, invalid-recipient `4xx → invalid`, `429/5xx → error`.

**Alternative: Postmark.** Same seam — only `isResendConfigured` /
`resendEmailProvider` swap for Postmark equivalents: `POST
https://api.postmarkapp.com/email`, header `X-Postmark-Server-Token`, body
`{ From, To, Subject, HtmlBody, TextBody }`. No caller changes.

## Opt-in stance — privacy-first (explicit opt-IN)

There is **no user-preferences store in the repo today**: `profiles` has no email
column, and emails live only in Supabase Auth (`auth.users`). Given that, the
digest gates on **explicit opt-in**, not opt-out:

- A user is mailed **only** if they positively opted in **and** have not opted
  out. Opt-out **always wins** (`isDigestOptedIn` in `lib/weeklyDigest.ts`).
- Until a durable prefs table exists, the flags live on the Supabase Auth user's
  metadata:
  - `user_metadata.digest_opt_in === true` → opted in
  - `user_metadata.digest_opt_out === true` → opted out
- Every rendered email carries an `{{unsubscribe_url}}` placeholder;
  `toEmailMessage(digest, { unsubscribeUrl })` **requires** a per-recipient URL,
  substitutes it into both parts, and **throws** if any residual `{{…}}`
  placeholder survives (P2-c) — a message can never ship half-templated.

**Where the durable field goes (owner decision needed).** When opt-in volume
warrants it, add a `public.user_email_prefs` table keyed by `user_id →
auth.users(id)` with `digest_opt_in boolean`, `digest_opt_out boolean`,
`unsubscribe_token uuid`, `updated_at`. Swap the flag source in
`listOptInAudience` (in the send script) to read this table; `isDigestOptedIn`
and `resolveDigestRecipients` do not change. This mirrors the notifications
migration idiom (`supabase/migrations/…_0010_notifications.sql`).

## Honesty contract

Enforced by the generator and covered by tests:

- A section renders **only** when real data backs it — no "0 drops 🎉" filler, no
  invented prices or events.
- Prices honour an observed-at window (default 7 days); stale never reads live.
- Provenance `{label, url}` rides every price / what's-on line.
- An **empty week** yields a shorter email (greeting + one honest guardian tip +
  unsubscribe), never padding. See the three rendered examples in
  `docs/digest-samples/`.

## Data sources the send path normalises in

- **Prices:** `public/data/pint_index_snapshot.json` observations (PENCE → GBP)
  + the public slim-venue baseline (`lib/venuesSlim`).
- **Drops:** `lib/pintDrops.listAllVisiblePintDrops("london")` (count in window).
- **What's-on:** `public/data/whats_on/latest.json` (freshest, soon, in-scope).
- Drops / what's-on carry no borough → resolve `venueId` → borough via
  `venues_slim.json` to scope to a user's area.

## Fixtures

`docs/digest-samples/{full-week-camden,partial-week-london,empty-week-barnet}.{html,txt}`
are committed rendered examples for review — the **final provider-ready
messages** built via `toEmailMessage` with a fixed example unsubscribe URL, so no
`{{…}}` placeholder survives. Regenerate after an intentional copy/markup change:

```
WRITE_DIGEST_FIXTURES=1 npx vitest run __tests__/weeklyDigestFixtures.test.ts
```

The fixtures test also asserts the renderers stay in sync with the committed
files on every normal run.
