# Email digest capture: removed

There is no digest capture in PUBMAXX. The identity nudge has one email action,
and it is functional magic-link sign-in. It does not collect a second address
or promise a digest. The separate area-demand form may store an optional contact
address for that named area.

Captain decision, 2026-08-15: delete the path rather than leave it dormant. The
capture surface had already gone (`specs/honest-identity-nudge-email-action.md`)
because confirmation, delivery and the weekly schedule were never built, which
left a public unauthenticated POST writing subscriber rows that no product
surface called. A write nobody makes is a write nobody watches.

## What was deleted

| Concern | File |
|---|---|
| Capture route (public POST) | `app/api/email-subscribers/route.ts` |
| Confirm / unsubscribe endpoints (token-gated GET) | `app/api/email-subscribers/confirm/route.ts`, `.../unsubscribe/route.ts` |
| Dual-backend store (memory ↔ Supabase `email_subscribers`) | `lib/emailSubscribersStore.ts` |
| Provider-gated confirmation email (inert until keys) | `lib/emailConfirmation.ts` |
| Analytics event with no emitter | `email_subscribed` in `lib/analyticsEvents.ts` |

The address validation survives as `lib/emailAddress.ts`, because
`lib/areaDemand.ts` still validates an optional contact address with it.

## What was kept

- `supabase/migrations/20260718150000_0042_email_subscribers.sql` and the
  `public.email_subscribers` table. A migration is history, and no row is
  deleted, confirmed or mailed by this removal. The table is now unreferenced by
  the app; dropping it is a separate captain-applied migration.
- Rendered signed-out IdentityNudge coverage in
  `__tests__/identityNudgeComponent.test.ts`, which refuses digest capture and
  shows the functional sign-in action.

## If a digest is ever built

Build delivery first, then capture. One stated purpose at the point of capture,
double opt-in, an unsubscribe token that never leaves the server, and durable
per-IP plus global rate limits on the write. Nothing becomes mailable until the
recipient confirms.
