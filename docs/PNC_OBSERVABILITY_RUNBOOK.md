# Planned Nights Completed observability runbook

`public.plan_completions` is the durable north-star ledger. Operators query the
service-role-only `public.pnc_qualified_completions` view so browser telemetry,
lost HTTP responses, retries, recap views, and legacy unqualified rows cannot
inflate Planned Nights Completed (PNC).

## Canonical queries

Run these through an authenticated server or the Supabase SQL editor. Never put
the service-role key in a browser, dashboard embed, or client bundle.

Daily PNC:

```sql
select completion_day_utc, count(*) as planned_nights_completed
from public.pnc_qualified_completions
where completed_at >= now() - interval '30 days'
group by completion_day_utc
order by completion_day_utc;
```

Ending mix:

```sql
select ending, count(*) as planned_nights_completed
from public.pnc_qualified_completions
where completed_at >= now() - interval '30 days'
group by ending
order by planned_nights_completed desc;
```

Integrity checks:

```sql
select
  count(*) as qualified_rows,
  count(distinct completion_id) as distinct_completions,
  count(distinct plan_id) as distinct_plans
from public.pnc_qualified_completions;
```

All three values must match. A mismatch is a release blocker even though the
underlying table also has unique constraints.

## Provider boundary

- Supabase is authoritative for PNC.
- PostHog EU measures consented interaction funnels; it is not the PNC counter.
- Vercel owns deployment/runtime evidence and Web Vitals.
- Arize is reserved for redacted Pub Pal AI traces and evaluations.

The view contains completion and Plan UUIDs for idempotency audits, timestamps,
ending, and route revision. It contains no account identifiers, member tokens,
handles, names, free text, venue names, voice content, or coordinates.

## Runtime log signals (per-route latency + rate-limiter fail-open)

Distinct from the PNC ledger above: server runtime health is emitted as
structured one-line JSON via `lib/log.ts` and captured by Vercel runtime logs
(ADR 0007 — Vercel is the runtime-log / latency authority; no new vendor). Every
line is `{ "level", "event", …, "ts" }` and carries no account id, handle, IP,
free text, query string, or coordinate — only the fields listed below.

### `event: "http.request"` — per-route latency + error budget

Emitted once per wrapped API request by `withRouteTiming` (`lib/routeObservability.ts`;
currently applied across the `/api/citymcp/*` external-dependency surface). Fields:
`route` (static tag, e.g. `citymcp/status`), `method`, `status`, `durationMs`.
`level` is the error-budget signal: `info` (2xx/3xx), `warn` (4xx/429), `error`
(5xx or a thrown handler, which also carries a scrubbed `error` message).

Log-drain queries (Vercel log filters / any downstream aggregator):

```
# p50/p95 latency per route — group JSON.durationMs by JSON.route over the window
event="http.request"

# error budget — 5xx / thrown handlers
event="http.request" level="error"

# rate-limited / client-error rate
event="http.request" level="warn"
```

Alert: page when the `error`-level rate for a `route` exceeds its budget, or when
p95 `durationMs` crosses the route's SLO. Roll `withRouteTiming` onto more routes
by wrapping their exported handler — it is a pass-through observation seam, never
a behaviour change.

### `event: "rate_limit.fail_open"` — durable limiter degraded (alert)

Emitted by `isLimited` (`lib/pintDrops.ts`) the moment the durable Supabase
limiter cannot answer and the request falls back to the per-instance in-memory
budget. Fields: `reason` (`error` | `missing-rpc` | `no-client` | `unknown`),
`mode` (`degraded` = tightened to the degraded cap; `full` = full in-memory
budget), `effectiveLimit`, `windowMs`. This is the audit's alertable event —
on Vercel each cold-start instance gets a fresh budget, so the effective cap is
looser than intended exactly during an outage.

```
event="rate_limit.fail_open"
```

Alert: page on ANY sustained `rate_limit.fail_open` volume — it means the abuse
floor is degraded. Pair it with the underlying `[rate-limit] durable limiter
unavailable` line (from `checkRateLimitDurableDetailed`, which reports *why* the
RPC broke) for root cause. Fail-CLOSED paths (`failClosed` callers, or
`RATE_LIMIT_STRICT=1`) do NOT emit this event — they refuse rather than open.

## Dashboard certification

Provider-side dashboards are certified only after an operator records the
workspace/region, dashboard URL, query or insight version, owner, alert threshold,
and a screenshot from the exact production release. Repository code alone is not
evidence that a PostHog, Vercel, or Arize dashboard exists.
