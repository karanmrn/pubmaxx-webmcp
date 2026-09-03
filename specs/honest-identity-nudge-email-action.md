# Honest Identity Nudge Email Action

Status: ready for implementation on 2026-08-15.

## Goal

Keep one functional email action in the post-value identity nudge. Remove the
weekly digest capture until double opt-in and delivery work end to end.

## Journey contract

1. A first successful Plan action or Moment capture arms the existing nudge.
2. A signed-out reader sees the nudge only after the existing grace and prompt
   budget gates.
3. Enabled social sign-in actions remain capability-gated.
4. Email magic-link sign-in remains the only email field and action.
5. `Not now` keeps the existing seven-day cooldown.

## Truth contract

- The nudge must not promise a weekly digest while confirmation dispatch,
  recipient loading, delivery, and schedule are inactive.
- The nudge must not call `/api/email-subscribers`.
- The nudge must not emit `email_subscribed`.
- Captain decision, 2026-08-15: the route, its store, its confirmation dispatch
  and the `email_subscribed` registry entry were then DELETED, because a public
  unauthenticated write with no caller is a write nobody watches. Pending
  subscriber rows and migration 0042 are untouched. See `docs/EMAIL_CAPTURE.md`.
- This slice does not claim that a digest has launched or that pending rows are
  confirmed subscribers.

## UI contract

- At 390 by 844 CSS pixels, the dialog contains exactly one `type="email"`
  field, owned by magic-link sign-in.
- No `weekly digest`, `Get the digest`, or second email form appears.
- Dialog has no horizontal overflow.
- Every visible action remains at least 44 by 44 CSS pixels.
- `Not now` stays visible and reachable without page-level horizontal scroll.

## Verification

- Unit: configured signed-out state renders magic-link action, no digest copy,
  and no digest request or analytics path.
- Browser: arm the Plan nudge at 390 pixels, clear grace with interaction,
  assert one email field, no digest action, no subscriber request, no
  `email_subscribed`, reachable dismissal, and no horizontal overflow.
- Full: focused lint, typecheck, `git diff --check`, exact production Playwright
  proof, `npm run verify`, and independent review.

## Out of scope

- Deleting or changing existing subscriber rows.
- Resend integration, sender-domain setup, confirmation delivery, recipient
  loading, digest composition, scheduling, unsubscribe, or bounce handling.
- Changing account identity, Plan, Moment, prompt-budget, or analytics privacy
  contracts.
