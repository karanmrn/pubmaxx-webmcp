# Night signal claim candidates

Scheduled ingestion reads `*.json` files in this directory. A file may contain
an array of claims or `{ "claims": [...] }`. Claims must satisfy the
`NightSignalClaim` contract in `lib/nightSignalClaims.ts`.

Automation only produces a review branch. A claim cannot affect route ranking
unless it is approved and either corroborated by another source or marked as a
manual review. User route requests read the reviewed snapshot and never run a
live third-party search.

Public claim artifacts expose only the non-personal review authority category
(`operations`, `editorial`, or `automated`). Individual reviewer identity is
not stored in committed candidates, database claims, or public snapshots.

## Exa buzz candidates (`exa-candidates.json`)

`npm run ingest:night-signals` arms `EXA_API_KEY` to fetch recent London pub
buzz — new openings, award wins and "best pint" features — and writes them here
as **pending** candidates. Every candidate is `single_source`,
`routeEffect: "none"`, with the publisher's own headline as the claim (no AI
summary) and a tracking-stripped source URL. A reviewer must verify each one and
set `reviewState` to `approved` with `reviewedAt` and `reviewAuthority` before
the reviewed snapshot ships it. Without the key the ingestion is a safe no-op.

The daily Vercel cron `GET /api/cron/refresh-night-signals` runs the same sweep
on a schedule, but a serverless filesystem cannot write this directory: it
returns pending candidates and stamps the ingestion freshness feed only. See
`docs/CRON_PLANE_RUNBOOK.md`.
