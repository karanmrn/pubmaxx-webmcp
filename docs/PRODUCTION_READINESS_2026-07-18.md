# Production readiness audit — 2026-07-18

Scope: caching / CDN, database, resilience, observability, cost/scale, judged for
real load. This audit is deliberately fair to what already exists — PUBMAXX is
already well past "MVP" on backend fundamentals — and precise about the handful
of concrete gaps worth closing now. Every fix shipped in this branch is
justified by a finding below; nothing speculative.

## Verdict

The backend is **mature**. Rate limiting is durable + fail-open, the Supabase
client is a correct module singleton, every hot table but one is indexed, and
the flagship external dependency (TfL) is best-in-class (timeout + retry +
static stale-serve, never 500s). The gaps are narrow: a few cacheable responses
emit `no-store`, OG image regeneration is uncached, one hot query path
(author-scoped pint drops) is unindexed, and one external caller (social OAuth)
lacks a timeout. This branch closes those five.

---

## 1. HTTP caching / CDN

### Exists (verified)
| Surface | Posture |
|---|---|
| `/data/*.json` (public dataset, ~6 MB) | `next.config.mjs` headers: `public, max-age=3600, s-maxage=31536000, stale-while-revalidate=604800`. Deliberately NOT `immutable` (unhashed URLs; Vercel purges the edge on deploy). Well-reasoned. |
| Security headers | HSTS/nosniff/XFO/Permissions-Policy/COOP on `/:path*`; per-request nonce CSP in `proxy.ts`. |
| `heritage` GET | `public, s-maxage=300, stale-while-revalidate=600`. |
| `venue/[id]` GET | same 300/600 convention. |
| `pint-index/data.csv` GET | `public, s-maxage=3600, stale-while-revalidate=86400`. |
| `last-train` / `last-tram` / `last-subway` / `last-merseyrail` | edge-cache the timetable-only answer (`s-maxage=3600, swr=86400`); `no-store` whenever live TfL Arrivals or the time-sensitive decision is involved. Correct. |
| `image-proxy` | edge 1d/7d. |
| `plan-card` OG | `public, s-maxage=60, stale-while-revalidate=300` (the one card that does it right). |
| Service worker (`sw.js`) | per-deploy build id busts client caches; offline strategy present. |

### Missing / fixed here
| Gap | Detail | Fix |
|---|---|---|
| **OG image regeneration is uncached** | 13 of 14 `next/og` `ImageResponse` outputs (8 `opengraph-image.tsx` metadata routes + `og.png` + `list-card`/`crawl-card`/`city-map-card`/`chaos-card`) set NO `Cache-Control`. The per-request nonce middleware forces dynamic rendering, so these do not get Next's static-image immutable cache. Every social-crawler refetch (facebookexternalhit/Slackbot/Twitterbot) re-runs font loading + fs reads + PNG rasterization on a Node function. | **Fix 1 + 2** — explicit edge cache headers on every `ImageResponse`. |
| **Static bundled JSON served `no-store`** | `night-signals`, `late-food`, `night-areas` GETs read shipped/static bundled data (`public/data/night_signals/latest.json`, `lib/lateFood`, `lib/nightAreas`) yet emit `Cache-Control: no-store` via `jsonNoStore`. Every request hits a function; nothing reaches the CDN. `whats-on` is intentionally left `no-store` (it merges a live CityMCP layer). | **Fix 3** — `jsonCached` helper + apply to the three static routes. |
| HTML ISR/PPR | Every HTML route is dynamic by design — the per-request CSP nonce (`proxy.ts`) is incompatible with static generation / ISR / PPR. This is a conscious security trade-off, documented in `proxy.ts` and `next.config.mjs`. Not "fixed" — noted so it is a known, owned decision. Revisiting it (e.g. hash-based CSP for a static subset) is a larger design change, out of scope here. |

## 2. Database

Client: `lib/supabase.ts` `getSupabaseAdmin()` is a **module-memoized singleton**
(service-role key, `persistSession:false`), resolved lazily via
`storeBackend.admin()`. No per-request client construction → no connection churn.
Serverless caveat (already documented in-code): each cold-start instance gets a
fresh singleton and a fresh in-memory rate-limit budget.

### Index coverage (verified against `supabase/migrations/`)
Hot paths that ARE indexed: `visit_reports(venue_id, created_at desc)`, the
partial visible-feed index, `plans` PK + owner + idempotency key,
`notifications(recipient_handle, created_at desc)`, `night_signal_claims` active
partial, `drink_ratings`/`venue_ratings` by ref/venue/created,
`price_confirms(venue_id, price_pennies)`, `messages(conversation_id,
created_at)`, `follows(follower_id)`/`(followee_id)`, `pub_presence(venue_id,
expires_at)`, plan children (`stops`/`members`/`actions` by plan_id).

### Missing / fixed here
| Gap | Detail | Fix |
|---|---|---|
| **`visit_reports.handle` unindexed** | `pintDropsStore.listVisible` runs `.eq("status","visible").eq("handle",author).order("created_at" desc)` for author-scoped reads ("my drops" / profile drop list). `venue_id` and the global feed are indexed; the `handle` lane is a sequential scan that worsens linearly with table growth. | **Fix 4** — partial composite index `visit_reports(handle, created_at desc) where handle is not null`. |

### N+1 / batching (noted, not fixed — all bounded)
- `messagesStore.listConversations`: 1 + N per-conversation message reads, capped at
  `MAX_CONVERSATIONS` (100). Acknowledged in-code. Acceptable at cap; a future
  lateral/window-function rewrite would remove it.
- `followStore.counts`: two `COUNT(*)` awaited serially (+ a profile lookup).
  Could be `Promise.all`. Minor.
These are not shipped in this branch — they are behavior-adjacent and below the
bar for "top 5 highest-leverage, zero-risk".

### Row growth / scale cliffs
- No `push_tokens`/`device_tokens` table exists in migrations — push-token
  storage lives outside this data layer (notifications key off `recipient_handle`).
  If/when device tokens land in Postgres, they need a unique index + a stale-token
  reaper. Flagged for the push-senders workstream, not owned here.
- `visit_reports` (pint drops) and `price_confirms` grow with usage; both are
  indexed on their read paths. No retention policy yet — a P3 to revisit at scale.

## 3. Resilience

Best-in-class: **TfL/last-train** (9s `AbortController` timeout, transient-only
retry, `nearestStaticStation` stale-serve, never throws/500s). Solid:
**CityMCP** (10s timeout + TTL cache, fail-soft to empty), **heritage/OpenRouter**
(10s timeout + deterministic grounded fallback), **image-proxy**/**ElevenLabs**/
**PostHog** (all timed out). Tiles (OpenFreeMap/CARTO) are client-side MapLibre
fetches — no server route to harden (map-fallback is a separate workstream).

### Missing / fixed here
| Gap | Detail | Fix |
|---|---|---|
| **social OAuth has no timeout** | `lib/socialOAuth.ts` — the token-exchange and X/Instagram/TikTok profile `fetch`es (4 calls) have NO `AbortController`/`signal`. A stalled provider hangs the OAuth callback function until its own `maxDuration`, burning a full function slot. Every other server-side external call is timed out. | **Fix 5** — `AbortSignal.timeout(8s)` on all four. No behavior change on the happy path. |

### Noted, not fixed (behavior-changing — needs product sign-off)
- **CityMCP has no stale-serve.** Its TTL caches are fresh-only; on upstream
  failure or an expired entry it throws and routes return empty banners even
  though a slightly-stale value existed moments ago. A serve-last-known-on-error
  path (+ optional single retry / circuit breaker) is the highest-value
  resilience upgrade left, but it changes what users see (stale vs empty), so it
  is a deliberate design decision, not a drop-in quick win. **Recommended P2.**

## 4. Observability

Exists: `PNC_OBSERVABILITY_RUNBOOK.md` (durable north-star ledger via a
service-role-only view), `OBSERVABILITY_CERTIFICATION.md`, consent-gated PostHog
EU funnels, Vercel Web Vitals, structured `console.error` on the rate-limiter
degrade path.

Gaps (noted, not fixed — needs infra decisions, not a code quick win):
- **No per-route latency / error-budget visibility.** Funnel is measured
  (PostHog) and PNC is measured (Supabase), but there is no server-side
  per-route p50/p95/error-rate dashboard. Vercel's built-in function metrics
  partially cover this; a structured log line (route, status, duration) piped to
  a drain would close it. **Recommended P2.**
- No alerting on the rate-limiter fail-open events (they log but nothing pages).

## 5. Cost / scale cliffs

- **OG image functions** were the clearest cost hotspot (uncached font+PNG
  rasterization per crawl) — closed by Fixes 1–2.
- `last-train` `maxDuration = 30s` with a concurrent TfL fan-out is the longest
  function; already capped (`LINE_CAP = 4`) and edge-cached. Acceptable.
- **openfreemap tile host** is a single client-side dependency with no fallback
  host — an outage degrades the map for everyone. Owned by the map-fallback
  workstream; flagged here for completeness.
- Supabase row growth (pint drops, price confirms, notifications) — indexed,
  unbounded; revisit retention at scale (P3).

---

## Shipped in this branch (5 commits, each low-risk, no behavior change)
1. Cache headers on OG metadata images (`opengraph-image.tsx` × 8 + `og.png`).
2. Cache headers on OG card API routes (`list-card`, `crawl-card`,
   `city-map-card`, `chaos-card`).
3. `jsonCached` helper + apply to static bundled GETs (`night-signals`,
   `late-food`, `night-areas`).
4. `visit_reports(handle, created_at desc)` partial index migration.
5. `AbortSignal.timeout` on the four `socialOAuth` external fetches.

## Recommended next (not in this branch)
- P2: CityMCP serve-last-known-on-error + single transient retry.
- P2: per-route latency/error-budget log drain + rate-limiter fail-open alert.
- P3: retention policy for pint drops / price confirms; push-token table +
  reaper when device tokens move into Postgres.
