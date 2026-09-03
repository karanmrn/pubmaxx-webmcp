# Crawl stop count 3-6

## Goal

Let describe-first and wizard planning request 3, 4, 5, or 6 grounded pub stops. Keep 3 as default. Preserve the Culture Crawl opener as a separate waypoint that never counts as a pub stop.

## Baseline proof

Production build passed with the keyless flags required by this repository. Browser proof used Chrome DevTools at 390px and 1440px against the production server.

- 3-stop describe-first generation for `crawl in Camden for 5` returned three distinct named venues with priced, grounded route data.
- Swap changed stop 1 to another listed venue.
- Removal reduced the draft to two stops and disabled locking, so an incomplete route could not be shared.
- Host share showed all three numbered stops, the walking-route link, invite link, copy control, and WhatsApp link.
- `/crawls` rendered route packs and 5-10-stop curated routes. `/borough/camden` rendered `Start a crawl from cheapest pubs` and `Crawls through Camden` links.
- Map build mode rendered the 3-stop route, two walking legs, and `Camden Market` as an `On the way` waypoint outside the stop list.
- No confirmed 3-stop failure remained after restarting with `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1`. The first redacted guest observation came from a server started without that required keyless flag and was not treated as a product defect.

Evidence screenshots are in [`docs/screenshots/crawl-baseline`](../../screenshots/crawl-baseline).

## Implementation slices

1. Add a shared 3-6 stop-count policy and optional context field with safe default 3. Infer explicit `N pubs`, `N stops`, and `big crawl` from free text. Keep `for N` group-size parsing unchanged.
2. Add stop-count controls to describe-first and the existing wizard without adding a mandatory wizard step. Thread the chosen count through intake, context reconciliation, drafts, and generation requests.
3. Generalize the grounded optimizer and anchored optimizer from triples to N stops. Keep price evidence, access evidence, reviewed-safety exclusions, walking feasibility, opening checks, deduplication, deterministic scoring, alternatives, and honest scarcity responses.
4. Generalize generation proof and plan state validation from exactly three to the requested 3-6 stops. Make 422 messages name the requested count.
5. Remove UI assumptions that require exactly three stops. Keep map, share, editor, numbering, leg totals, budget summaries, and route links array-driven up to six stops. Keep Culture Crawl data outside the stop array.
6. Add unit tests for inference, optimizer grounding/deduplication/scarcity per count, intake and route count validation, and browser coverage for 5 and 6 stops at both viewports.

## Validation

- Targeted Vitest for planning, optimizer, routes, drafts, map links, and share DTOs.
- `npm run typecheck`.
- Scoped ESLint for changed TypeScript and TSX files.
- `memory_pressure -Q` before production build and browser e2e. Run one build at a time with `NEXT_DIST_DIR=.next-prod`.
- Production browser e2e proves 5-stop and 6-stop keyless crawls at 390px and 1440px, including each numbered map stop and every walking leg.
