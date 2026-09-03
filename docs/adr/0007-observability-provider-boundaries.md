# ADR 0007: Observability has explicit provider boundaries

## Status

Accepted, amended by ADR 0009

## Context

The existing analytics route validates a closed event catalogue and writes
privacy-minimised structured logs. The v1 programme needs queryable activation,
completion, retention, provider-health, and AI-quality evidence without allowing
analytics content to become a shadow user profile.

## Decision

- PostHog EU is the product-interaction analytics authority. Product events
  remain registry-known with allow-listed, low-cardinality properties.
  Explicit pageviews use a separate closed route vocabulary that replaces
  dynamic values with templates. ADR 0009 owns analytics identity, standard
  browser context, and provider retention.
- The idempotent `plan_completions` ledger is the PNC metric authority. PNC is not
  emitted by a browser; a future PostHog export requires a server outbox keyed by
  completion ID.
- Vercel remains the deployment, runtime-log, Web Analytics, and Web Vitals
  authority. Its high-level pageview counter is separate from PostHog's
  coarse route pageviews for product funnels.
- Arize Phoenix receives only redacted Pub Pal AI spans, tool/result categories,
  cost/latency, errors, annotations, and evaluations.
- Voice audio, transcripts, messages, handles, names, contact details, free text,
  query strings, and precise coordinates are excluded from all three pipelines.
- Provider failures fail soft and never block a user journey. Consequential product
  writes remain governed by their own server authorisation and confirmation paths.

## Consequences

- The shared analytics registry remains the code-level schema even when a sink changes.
- Events are forwarded to PostHog only after explicit analytics consent. The stable
  pseudonymous browser identifier contains no account data, is deleted on revocation,
  and is never merged with account identity.
- Session replay and automatic product capture remain disabled until a separate
  consent, redaction, and retention review passes. ADR 0009 owns the allowed
  browser SDK event classes and context. Browser exceptions remain consent-gated
  and are stripped to anonymous/device identifiers plus bounded error types
  before transport.
- Browser exceptions use PostHog's supported error tracking; server errors remain in
  Vercel logs. Arize is not a general error-monitoring sink.
