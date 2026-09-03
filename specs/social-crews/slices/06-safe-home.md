# Slice 6: Safe Home

## Contract

A member chooses one current Mutual Crew recipient, scope, deadline, and
explicit escalation permission, then confirms in a separate write. Revoke and
`home` close sharing immediately.

## Seam

`SocialSafeHomeStore` owns pending grant, confirmation, status, home, revoke,
read, and escalation RPCs.

```ts
type SafeHomeScope = "status_only" | "status_and_check_ins";
type SafeHomeGrantState =
  | "pending_confirmation"
  | "active"
  | "home"
  | "revoked"
  | "expired";
type SafeHomeStatus = "leaving" | "on_my_way" | "home";
```

Escalation locks the grant and rechecks active state, deadline, permission,
membership, reciprocal friendship, and block. Notification text is generic.

Deadline is the escalation threshold, not expiry. Recipient reads remain
available while a confirmed grant is active and `now < deadline + 2 hours`.
Escalation is allowed when `now >= deadline` and
`now < deadline + 2 hours`. At exact `deadline + 2 hours`, the grant becomes
`expired`; recipient read and escalation both stop. `home` or revoke closes it
earlier.

## RED cases

- Pending grant shares nothing.
- Non-Mutual recipient is rejected.
- Changed scope needs new confirmation.
- Revoke or home removes read access immediately.
- Exact deadline permits escalation. Earlier time does not.
- Exact deadline plus two hours is expired and shares nothing.
- Revoke racing escalation produces either revoke with no notification or one
  completed escalation before revoke.
- Removal, unfriend, or block defeats read and escalation.
- Notification contains no Venue, route, handle, deadline, or grant ID.

## Required copy

`PUBMAXX does not monitor your journey or contact emergency services.`

Calling 999 stays a direct user action.

## Playable checkpoint

Propose, review, confirm, mark on the way, read as recipient, revoke, and prove
recipient loses access. Repeat at deadline with permitted generic escalation.

## Verification

Run state-machine and PostgreSQL race tests. Perform security review of every
notification and log field.
