# Wave 0 observability certification

This is the operational status of the provider boundaries defined by
`docs/adr/0007-observability-provider-boundaries.md`. It records evidence; it
does not replace `docs/MASTER_PRD.md`.

The privacy-minimal PostHog assertions certified on 26 July 2026 were
superseded by ADR 0009. The current standard product analytics implementation
requires fresh provider-side retention verification before production
certification.

## Certified in code

- Product events pass through the closed `ANALYTICS_EVENTS` registry and are
  re-sanitized at `/api/events`.
- No product event, structured analytics log, PostHog event, or Vercel
  pageview is emitted before explicit consent. Do Not Track fails closed.
- PostHog pageview counting begins with the current pathname when consent is
  granted, then records pathname changes in order. Query-string-only navigation
  is not a pageview, and query strings never enter the event.
- `/admin` and every nested moderation route are excluded from PostHog
  pageviews so staff traffic cannot contaminate product funnels.
- Revoking consent removes the local pseudonymous identifier and stops future
  collection.
- Vercel Analytics uses `beforeSend` to cancel pre-consent pageviews. It is not
  a second custom-event rail.
- PostHog capture targets the EU endpoint and enables pseudonymous
  person/device profiles. Product events remain registry-known; explicit
  pageviews carry a coarse templated path plus standard browser and device
  context.
- PostHog browser exception capture is separately consent-gated and strips
  messages, stack traces, URLs, and arbitrary context before EU ingest. Its
  pseudonymous device identifier persists across page loads and sessions after
  consent, alongside bounded standard browser context, referrer and campaign
  attribution, and Web Vitals.
- The registry contains no streak, freeze, drink-count, alcohol-quantity, or
  consumption-based progression event. Tests pin that absence.
- Supabase remains authoritative for PNC through the service-role-only
  `pnc_qualified_completions` view; browser telemetry cannot increment PNC.

## Provider configuration status

As of 26 July 2026, the primary `chengdu` Vercel project has the PostHog EU
public project token and host in Production, Preview, and Development. The
mirror `pubmax` project remains deliberately untouched pending an owner
decision. Provider project tokens are publishable identifiers, not secrets;
account identity still never enters the analytics rail.

To finish production certification:

1. Deploy one pinned commit to `chengdu`.
2. Keep `pubmax` out of scope until its disposition is decided.
3. Grant analytics consent in a test browser and exercise the activation,
   planning, sharing, return, and Web Vital events.
4. Prove no event is received before consent or under Do Not Track.
5. Create funnels/cohorts from registry event names only. Never capture free
   text, handles, messages, voice content, or coordinates.
6. Configure and verify event deletion 12 months after collection and
   person/device profile deletion 12 months after last activity.
7. Record dashboard URLs, retention settings, deletion procedure, project
   region, exact deployment IDs, and a redacted event sample in the Wave 0
   Wayfinder issue.

## Still open

- PostHog EU provider-side funnel/cohort/error dashboard evidence.
- Vercel production Web Vitals dashboard evidence for both projects.
- Arize Phoenix projects and redacted Pub Pal trace/evaluation certification.
- Consent-gated replay remains disabled pending a separate redaction and
  retention review.
