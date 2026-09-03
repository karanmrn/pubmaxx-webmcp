# Honest Identity Nudge Email Action Implementation Plan

**Goal:** Remove an impossible digest promise and leave one functional email
action in the post-value identity nudge.

**Architecture:** Keep existing identity trigger, grace, prompt budget, social
provider, magic-link, Escape, and cooldown owners. Delete the parallel digest
capture UI, route, store, confirmation dispatch, and `email_subscribed` event
per captain decision D1. Keep migration 0042 and existing rows as history.
Known gap: a body-level sibling mounted after a trap engages is not contained,
so this PR keeps main's Command Palette overlap as a separate fix.

**Spec:** `specs/honest-identity-nudge-email-action.md`

## Task 1: Write RED truth and component contracts

**Files:**

- Modify: `__tests__/identityNudgeComponent.test.ts`
- Modify: `__tests__/voiceComplianceAudit.test.ts`

- [ ] Require configured state to render the mocked email sign-in action.
- [ ] Require digest copy and action to be absent.
- [ ] Require no subscriber route or `email_subscribed` path in current nudge.
- [ ] Run focused Vitest and record RED.

## Task 2: Remove parallel digest capture

**Files:**

- Modify: `components/identity/IdentityNudge.tsx`
- Modify: `components/identity/identityNudge.css`

- [ ] Remove digest email state, validation, request, success, and error flow.
- [ ] Remove digest divider, form, field, CTA, and unused CSS.
- [ ] Keep social providers, magic link, Escape, and `Not now` behavior.
- [ ] Run focused Vitest, lint, typecheck, and diff check.

## Task 3: Prove 390px nudge behavior

**Files:**

- Create: `e2e/identity-nudge-mobile.spec.ts`

- [ ] Arm a fresh Plan nudge in a configured signed-out browser.
- [ ] Clear grace through an allowed interaction.
- [ ] Assert one email field and no digest copy or CTA.
- [ ] Assert no subscriber request and no `email_subscribed` event.
- [ ] Assert 44px actions, visible dismissal, and no horizontal overflow.
- [ ] Capture and inspect light-mode 390px proof.

## Task 4: Record retired surface and close

**Files:**

- Modify: `docs/EMAIL_CAPTURE.md`

- [ ] State that public digest capture is retired until full double-opt-in and
  delivery are operational.
- [ ] Record the deleted route, store, confirmation dispatch, and analytics
  event while keeping migration 0042 and existing rows untouched.
- [ ] Run independent review and full `npm run verify`.
- [ ] Re-run production browser proof and confirm clean worktree.
