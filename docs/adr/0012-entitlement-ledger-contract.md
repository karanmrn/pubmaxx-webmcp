# ADR 0012: Entitlement ledger contract (no Stripe build this wave)

## Status

Accepted (contract only)

## Context

Wayfinder §4.6 (trial entitlement ledger) and §6.3 (Stripe Billing) are still
MISSING. The honest path to a world platform puts drinker + venue habit before
commerce. Building Stripe Checkout now would be payments theatre.

Wayfinder’s principle already says: entitlement is independent of processor;
Stripe / App Store / Play receipts are inputs, never the truth.

## Decision

**Do not implement Stripe Checkout, Connect, Billing, or membership paywalls
in Horizon 0–1.**

When a ledger is built later, it must:

1. Own grant / revoke / expire as first-party rows (processor-agnostic truth).
2. Accept processor receipts as evidence inputs only.
3. Never grant entitlement from referral milestones. A milestone is a mark of
   honour and confers recognition only (`docs/REFERRALS.md`). This is not a
   sequencing note waiting on anti-abuse: the capability-grant model is
   deleted.
4. Never gate map price reads, plan invite RSVP, or the annual Year in Pints
   wrap behind payment. The wrap is free forever.
5. Earn from VENUES first. A drinker pays for nothing, and no drinker-facing
   paywall, membership or metered read is built before the venue rail earns
   (ADR 0011).
6. Keep rounds as spend diary, never debt (`lib/rounds.ts`), until a licensed
   PSP settlement path exists as an explicit later ADR.

**Near-term substitute:** capability flags already in tree (Social emergency
rollback, trusted handoff, admin roles) stay env / moderator gated. Soft-launch
success is invite k-factor + corroborated coverage, not MRR.

## Consequences

- Agents refuse Stripe Checkout PRs framed as “platform prep”
- Membership marketing copy must not claim paid features that do not exist
- A future commerce ADR must cite this contract and ADR 0011 (operator trust)
  before Connect-scale checkout
