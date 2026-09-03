# Event sources research — official APIs for the Tonight page

**Date:** 2026-07-18
**Author:** feat/event-sources
**Goal:** Fatten the Tonight page (currently ~1 live listing) with real event data via **official APIs only**. No ToS-violating scraping of aggregators — this repo is provenance-obsessed. Every row must carry a real link back to the source and honour that source's display terms.

---

## Summary table

| Source | API available? | Cost / limits | Pub-scale London coverage | Attribution / display terms | Verdict |
|---|---|---|---|---|---|
| **Ticketmaster Discovery API v2** | Yes — public, self-service, instant key | Free; ~2–5 req/s, **5,000 calls/day** default quota | Ticketed London gigs/theatre/comedy at TM-selling venues (incl. mid-size). **Weak for pub-scale** (no free quizzes / open mics) | Deep-link back to the ticketmaster event URL; branding-guide compliance required for quota increases; **no permanent caching** (transient only) | **VIABLE** (primary — clean & free) |
| **Eventbrite API** | Public event **search removed 2019** | n/a | Can only read *your own* org's events now | n/a | **NOT VIABLE** |
| **Skiddle Events API** | Yes — free key by application | Free; soft rate-limiting, no hard numbers | **Best of the batch** — `BARPUB`, `LIVE`, `CLUB`, `COMEDY`, `FEST` codes + `venueid`/lat-lng targeting; London explicit | Link tickets back to skiddle.com; **commercial use needs written approval** (email dev@skiddle.com); affiliate programme | **VIABLE** (best pub-scale, **gated on commercial approval**) |
| **DICE.fm** | Only a partner "Ticket Holders" GraphQL (own buyers) | n/a | Great inventory, but no public discovery endpoint | n/a | **NOT VIABLE** |
| **SeeTickets** | Affiliate/partner API only (Eventim network) | Negotiated | Partner-gated | Provisioned per-partner | **NOT VIABLE** (quick build) |
| **TfL / open data** | Transport only | Free | No events feed | n/a | **NOT VIABLE** |
| **Songkick** | Effectively closed — "unable to process new applications for API keys" | n/a | Existing partners only | n/a | **NOT VIABLE** (no new keys) |
| **Bandsintown** | Partner-gated (written consent + manual app id) | n/a | Concert/tour data, not pubs | Provisioned | **NOT VIABLE** (self-serve) |
| **Resident Advisor** | No official API; undocumented GraphQL only | n/a | Strong London small-venue, but scraping-only | n/a | **NOT VIABLE** (would violate no-scrape rule) |

---

## Per-source detail

### 1. Ticketmaster Discovery API v2 — VIABLE (chosen, primary-clean)
- **Availability:** Public, self-service. Register at developer.ticketmaster.com for an instant consumer key; access Discovery + Commerce APIs. <https://developer.ticketmaster.com/products-and-docs/apis/getting-started/>
- **Cost / limits:** Free. TM's own docs quote a default **5,000 API calls/day** and **5 req/s** (getting-started) vs **2 req/s** (FAQ) — inconsistent, treat ~2–5 rps / 5k-day as the ceiling. Increases granted case-by-case after a ToS/branding-compliance review. <https://developer.ticketmaster.com/support/faq/>
- **Coverage:** Strong for **ticketed** London gigs, theatre, comedy, sport at venues that sell through Ticketmaster (International Discovery API v2, `countryCode=GB`, `city=London`). **Weak-to-absent for genuine pub-scale** (free pub quizzes, open-mics, non-ticketed small gigs are not in TM inventory). Good for "there's a show near you tonight", not "what's on at the local".
- **Attribution / terms:** Event links must **deep-link back to the Ticketmaster event page** for purchase. Branding-guide compliance (design.ticketmaster.com) is required to obtain rate-limit increases. **Could NOT verify a single verbatim "Powered by Ticketmaster" logo/string mandate** in the public Terms of Use — the precise attribution spec lives in the branding guide, which could not be extracted; **confirm before public launch.** Terms of Use also state you may only *"cache or store any Event Content other than for reasonable periods in order to provide the service you are providing"* — i.e. **transient caching only, not permanent storage**, and require a privacy policy in the page footer. <https://developer.ticketmaster.com/support/terms-of-use/>
  - **How we honour this:** `events_london.json` is **fully overwritten on every refresh** (never append-only history), and rows are tonight-windowed + dropped once stale (`STALE_AFTER_MS`) by the existing store — so stored TM content is only ever a short-lived working cache, satisfying "reasonable periods". The refresh cron is meant to run near-daily. Each row's `source = { label: "Ticketmaster", url: <event ticketmaster.co.uk URL> }`, which the Tonight page already renders as **"via Ticketmaster"** plus a CTA that opens the event's own TM page — the deep-link-back requirement.

### 2. Eventbrite API — NOT VIABLE
- Public event **search endpoint (`GET /v3/events/search/`) was removed 12 Dec 2019** (fully off Feb 2020). You can now only read **your own organization's** events via `/v3/organizations/{org_id}/events/`. Broad discovery needs their gated Distribution Partner Program (apply, not self-serve). <https://www.eventbrite.com/platform/api>, <https://github.com/Automattic/eventbrite-api/issues/83>
- **Confirmed dead for our use case** — you cannot query London pub events you don't own.

### 3. Skiddle Events API — VIABLE (chosen, best pub-scale, gated)
- **Availability:** Public, free key by application at <https://www.skiddle.com/api/join.php>. UK-focused. Docs: <https://github.com/Skiddle/web-api/wiki/Events-API> (repo archived read-only Apr 2024, but the live API service continues).
- **Cost / limits:** Free. *"We monitor all requests and reserve the right to rate-limit or block any excessive requests… please contact us if you are expecting to hit our API frequently."* No hard published numbers.
- **Coverage:** **Best small-venue coverage.** Event codes include **`BARPUB` (Bar/Pub event)**, `LIVE`, `CLUB`, `COMEDY`, `ARTS`, `FEST`, plus `venueid` and latitude/longitude+radius targeting. London explicitly covered.
- **Attribution / terms:** No explicit verbatim attribution clause found, but ticket links are expected to route back to skiddle.com and they run a 30%-commission affiliate programme. **Hard gate:** the API is *"for non-commercial use only. Any commercial use must be first approved in writing by emailing dev@skiddle.com."* PUBMAXX is commercial, so **written approval must be secured before this source is switched on.** <https://www.skiddle.com/affiliates/>
  - **How we honour this:** the Skiddle provider **noop-skips whenever `SKIDDLE_API_KEY` is absent**, so nothing ships until the owner both (a) obtains a key and (b) has the required written commercial approval. Each row links back to its skiddle.com event page. This is flagged loudly in code + workflow.

### 4–7. Not viable right now
- **DICE.fm** — only a partner "Ticket Holders" GraphQL (a promoter querying *their own* buyers). No public discovery endpoint. <https://partners-endpoint.dice.fm/graphql/docs/index.html>
- **SeeTickets** — Affiliate/partner API (Eventim Affiliates Network) only; provisioned per-partner. <https://clients.eventim.us/hc/en-us/articles/18890091910939-Affiliates-Network>
- **TfL / London open data** — transport only; no nightlife/events feed. <https://tfl.gov.uk/info-for/open-data-users/>
- **Songkick** — *"unable to process new applications for API keys"*; existing partners only. <https://support.songkick.com/hc/en-us/articles/360012423194-Access-the-Songkick-API>
- **Bandsintown** — partner-gated (written consent + manual app id); tour data, not pubs. <https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api>
- **Resident Advisor** — no official API; only an undocumented/unsanctioned GraphQL endpoint. Using it would be ToS-risky scraping — excluded by the no-scrape rule.

---

## Chosen sources & why

1. **Ticketmaster Discovery API (primary)** — the only truly open, free, self-service, legally-clean discovery API. Instant key, London GB market, Music + Sports classifications map cleanly onto our `music`/`sport` kinds. Skews to ticketed shows, not pub-scale, but it is the safest source to activate first.
2. **Skiddle Events API (secondary)** — genuinely the best pub/bar-scale coverage (`BARPUB`/`LIVE`/`FEST` + lat-lng radius). **Blocked on written commercial approval from Skiddle** and a free key; wired but noop-skipped until both land.

Everything else is partner-gated, discontinued, transport-only, or scraping-only — unusable under the official-API-only constraint.

## Caveats (unverified — confirm before public launch)
- **Ticketmaster's exact attribution wording** (a specific "Powered by Ticketmaster" logo/string) was not found verbatim in the public ToS; it lives in the branding guide at design.ticketmaster.com. The current implementation satisfies the *deep-link-back* requirement and labels every row "via Ticketmaster"; confirm the logo/string spec with the branding guide before going live.
- Ticketmaster's own docs disagree on the rate limit (2 vs 5 req/s) — confirm with a live key.
- Skiddle publishes no hard rate-limit numbers and requires written commercial approval — a hard gate, not optional.
- **Firecrawl MCP returned HTTP 401 on every call during this research** (all facts gathered via web search + direct page fetch instead) — the `FIRECRAWL_API_KEY` may need rotating.
