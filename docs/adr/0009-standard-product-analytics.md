# ADR 0009: Standard product analytics supersedes privacy-minimal PostHog collection

## Status

Accepted

## Context

ADR 0008 deliberately moved product analytics to PostHog, but its implementation
used memory-only browser identity, disabled person profiles, and removed standard
browser context. Refreshing a page therefore created a new stranger, so unique
users and retention could not be measured.

On 28 July 2026, the captain chose standard product analytics: persistent device
identity, browser and operating system, device type, screen and viewport size,
referrer and campaign parameters, Web Vitals, unique users, and retention.

## Decision

- Analytics remains off until explicit consent, and Do Not Track still fails
  closed.
- Consent creates one pseudonymous device identifier that persists across page
  loads and browser sessions. PostHog person/device profiles are enabled so
  unique users and retention are answerable. Account identity is not joined to
  this identifier.
- Standard browser context, referrer and campaign attribution, and Web Vitals
  may accompany consented analytics. Named events still cross `/api/events`,
  where the server re-validates the closed registry and bounded context before
  forwarding it. Browser SDK traffic still uses the first-party `/ingest`
  proxy.
- The analytics route may forward the request IP address and user agent to
  PostHog for product analytics. PUBMAXX does not store or log the raw values.
  The existing abuse limiter continues to hash IP addresses and never stores
  them in raw form.
- Autocapture and session recording remain disabled. Product events remain a
  closed named registry, while explicit coarse pageviews, redacted exceptions,
  and Web Vitals remain the only allowed browser SDK event classes.
- Events must be deleted 12 months after collection. Pseudonymous person/device
  profiles must be deleted 12 months after their last activity. Provider-side
  configuration and verification are release gates, not assumptions made by
  application code.

## Consequences

The privacy-minimal identity and context restrictions in ADR 0008, and the
conflicting analytics restrictions in ADR 0007, no longer apply. Their provider
boundaries, consent requirement, identity separation, closed event registry,
and prohibitions on autocapture and session recording still stand.
