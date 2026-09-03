# ADR 0008: PostHog analytics supersedes the first-party-only decision

## Status

Superseded by ADR 0009. This record preserves the former decision for context;
ADR 0009 owns the current analytics contract.

## Context

In July 2026 an owner-locked decision held that analytics would use only a
self-owned first-party beacon, with no third-party analytics store. That
decision was recorded in a planning document that was never committed to this
repository, so it cannot be located here and no path is cited for it. The
description above is the whole of what this record can show of it.

The shipped system instead uses first-party collection boundaries and PostHog EU
as its analytics store. On 27 July 2026, the captain confirmed that this
architecture is intentional: "We need analytics because thats how we can measure
success." This is a product decision, not an accidental implementation
divergence.

## Decision

The shipped architecture stands:

- Analytics consent is off by default, and no analytics identifier is created
  until consent is granted.
- Product events come only from the closed registry in `lib/analyticsEvents.ts`.
  The browser and server both reject unknown events and properties.
- Product events cross the first-party `/api/events` boundary before the server
  forwards their sanitised form to PostHog EU.
- The PostHog browser SDK sends explicit coarse pageviews and scrubbed
  anonymous exception counts through the first-party `/ingest` proxy.
  Pageviews use a closed route vocabulary with dynamic values replaced by
  templates. The proxy forwards bounded bodies and safe content types without
  cookies, sign-in headers, referrers, or forwarded IP addresses.
- PostHog person profiles are disabled. Account identity is never joined to the
  pseudonymous analytics identifier.
- Do Not Track is honoured in the browser and re-checked at the server event
  boundary.

`/privacy` describes these controls and names PostHog EU. `/terms` links to that
notice as the account and data-practice record. Their disclosed provider,
consent, and analytics-control policy therefore agrees with this decision.

Do not resurrect the original first-party-only beacon design. Do not operate a
second analytics store alongside PostHog.

## Consequences

- PostHog EU remains the product-interaction analytics authority established by
  ADR 0007.
- First-party routes remain privacy and validation boundaries, not a separate
  analytics warehouse.
- Any future sink, identity linkage, automatic capture, session recording, or
  expansion beyond the closed product-event and pageview vocabularies requires
  a new decision and matching privacy review.
