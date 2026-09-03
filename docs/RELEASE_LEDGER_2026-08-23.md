# Release ledger - 2026-08-23

Baseline: `main@36f05dd059b1114d148696532c7ba71bdd0d5081`

This ledger separates product code from actions that require owner credentials, store accounts, or native devices. It does not state that the native apps or public launch are certified.

## Production evidence

- `https://pubmaxxing.com/api/version` returned deployment `dpl_29QeGuDqiAyAByxHG9oRLkuNxNWb`.
- `GET /api/out?city=london&day=today` returned `status: ready` on 2026-08-23.
- Ticketmaster returned 21 current London listings with `configured: true` and `status: ready`.

## Code work in progress

- Community Price moderator queue for reported and hidden observations.
- Night Area activation is blocked on a route-policy decision. `/area/[slug]` remains held and `/area/clapham` must continue to return 404.
- Machine-checked store inventory and pull-request scope guard.

## Owner gates

- Apple Developer and Google Play enrollment, signing identities, store records, and review submissions.
- Native simulator and device proof, APNs delivery, Universal Links, and Android App Links.
- Search Console and Bing ownership, sitemap submission, and indexing evidence.
- Production demo-off evidence, PostHog dashboard certification, and first-cohort results.
- Ticketmaster attribution and branding approval before public promotion.

## Deferred milestones

- Nine-city product parity remains after London MVP acceptance.
- Pub Pal push-to-talk remains after typed planning and model tracing pass release gates.
- Full remaining scope in The Local specification stays open. PR #1156 was closed unmerged because a dedicated `/area/[slug]` surface conflicts with the held-route contract.

## Tracker resolution

- #385 is complete because production Ticketmaster listings are ready.
- #384 is superseded by focused product, native, launch, city, and voice trackers. Its closure does not certify launch readiness.
- #443, #437, #392, and #390 remain open until owner evidence exists.
- #287 and #282 remain open as named post-London milestones.
