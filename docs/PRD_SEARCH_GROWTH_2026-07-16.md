# PRD — Search, AI Visibility & Growth (D2+) · 2026-07-16

Owner-approved via grilling session 2026-07-16. Extends sol.md's queued **D2 (SEO growth)** lane.
North star for this lane: **organic sessions that reach `discovery_viewed`** (top of the existing
activation funnel). Secondary: AI-assistant citations of pubmaxxing.com.

Decisions locked with the owner:
- **Target territory:** all three lanes — pint prices, crawl planner, historic pubs (D1).
- **OG images:** dynamic per-page via `next/og` (D2).
- **AI-citability:** programmatic fact paragraphs + schema, no editorial commitment yet (D3).
- **Outreach:** all four channels, founder-led narrative (fundraising-aware) (D4).

## Ground truth (audited 2026-07-16)

| Surface | State |
|---|---|
| Site-wide OG image + Twitter card | ✅ `/og.png` 1200×630, metadataBase set |
| `robots.txt` | ❌ **404** |
| `sitemap.xml` | ❌ **404** |
| JSON-LD structured data | ❌ none anywhere |
| Per-page OG images | ❌ all pages share generic card |
| `generateMetadata` | ✅ exists on borough + city map pages (titles/descriptions only) |
| AI crawler access | ⚪ not blocked, not guided |
| Google Search Console / Bing Webmaster | ❓ unverified (owner action) |

## Why this works (the moat)

AI assistants (Claude, ChatGPT, Perplexity) and Google both reward **unique, structured,
dated, extractable facts**. PUBMAXX owns two datasets nobody else has:
1. **3,113+ tracked pint prices** with observation dates and provenance.
2. **346 cited historic pubs** with sourced heritage facts.

Nobody can out-write us on "cheapest pint in Hackney" — we're the only one with the number.
Every workstream below converts those datasets into crawlable, citable surfaces.

---

## Wave S1 — Technical foundation (ship first; ~1 day of agent work)

- **S1.1 `app/robots.ts`** — allow all (explicitly including GPTBot, ClaudeBot/Claude-User,
  PerplexityBot, Google-Extended, Bingbot), point at sitemap. Disallow `/api/`, `/admin`,
  `/p/` permalinks with tokens, any member-token surface.
- **S1.2 `app/sitemap.ts`** — dynamic: static routes + all boroughs + all cities + all
  venue detail permalinks (canonical, token-free) + `/historic` + landmark pages +
  curated crawls. `lastModified` from data-refresh timestamps.
- **S1.3 JSON-LD** (`components/seo/JsonLd.tsx`, injected per route):
  - Site: `WebSite` + `Organization` (logo → Google brand panel).
  - Borough pages: `ItemList` of pubs + `FAQPage` (see S3) + `BreadcrumbList`.
  - Venue pages: `BarOrPub` (name, geo, address, priceRange, servesCuisine=beer 😐 no —
    keep honest: name/geo/url/priceRange only from observed data).
  - Historic pages: `LandmarksOrHistoricalBuildings` per pub + citations.
  - Pint Index report: `Dataset` schema (this is what AI engines love most).
- **S1.4 Canonicals + honest freshness** — `alternates.canonical` on every indexed route;
  visible "Prices last observed <date>" stamps (provenance rule: never claim live).
- **S1.5 `llms.txt`** — top-level map of the site's data surfaces for AI agents, linking
  the Pint Index, borough pages, historic index. Cheap, emerging standard, zero risk.
- **S1.6 Favicon check** — ensure ≥48×48 PNG variant renders crisp next to Google results
  (icon-192 exists; verify Google picks it).

Acceptance: robots/sitemap 200 on prod; Rich Results Test passes on borough/venue/historic
pages; Search Console fetch renders full content.

## Wave S2 — Dynamic OG images (`next/og`)

- **S2.1 OG service** — `app/*/opengraph-image.tsx` (edge ImageResponse) per route family,
  brand-consistent: dark elevation ladder + coral accent + Space Grotesk.
- **S2.2 Borough card** — "Cheapest pint in {Borough}: £{price}" + avg + pub count + map
  silhouette. Data from the slim index at render.
- **S2.3 Venue card** — pub name, observed pint price, borough, heritage badge if cited.
- **S2.4 Crawl card** — route name, stop count, total walk time, price band.
- **S2.5 Homepage/static** — keep polished `/og.png`, refresh to match card system.
- **S2.6 Twitter/X `summary_large_image`** parity everywhere.

Acceptance: sharing any borough/venue/crawl URL in iMessage/WhatsApp/Slack/X shows its
specific card; OG debuggers clean; cards render <200ms at edge.

## Wave S3 — Programmatic fact layer (GEO)

- **S3.1 Fact blocks** — server-rendered paragraph + stat table on every borough/city page,
  generated from the dataset: average pint, cheapest tracked pub + price, price range, pub
  count, observation window. Written as extractable prose ("As of July 2026, the average
  pint in Hackney costs £6.10 across 43 tracked pubs.").
- **S3.2 FAQ blocks** — 3-5 real questions per borough ("What's the cheapest pint in X?",
  "How much is a pint in X in 2026?") answered from data, marked up as `FAQPage`.
  Questions only where data supports an honest answer.
- **S3.3 The London Pint Index** — `/pint-index` (quarterly): borough league table,
  movers, methodology + provenance section, `Dataset` schema, downloadable CSV. THE
  citable artifact for both journalists and AI engines. Auto-built from the price-refresh
  workflows already scheduled.
- **S3.4 Historic hub hardening** — `/historic` already has 346 cited pubs; add per-pub
  anchor pages' metadata, "oldest pubs in {borough}" internal links, citation-forward
  markup. (Time Out can't cite sources; we can.)
- **S3.5 Internal linking** — borough ↔ venue ↔ crawl ↔ historic cross-links so crawlers
  discover the whole graph (map-first UI currently hides most of it from bots).

Acceptance: fact blocks render server-side (curl shows the numbers in HTML); FAQ rich
results eligible; Pint Index page live with Dataset schema.

## Wave S4 — Outreach engine (founder-led, all four channels)

Owner narrative (their words, keep): *"after a hard day's work you want a cheap pint
nearby, a couple of places, maybe meet people — without bouncing between Google Maps,
other maps, and ChatGPT. One app. Great memories."*

- **S4.1 Data-PR** — on each Pint Index release: press kit page + pitch list (Time Out,
  Evening Standard, MyLondon, Londonist, local borough papers). Angle rotation:
  "cheapest borough", "price rises", "the £4 pint is dying". Each story = backlink.
- **S4.2 Reddit/community** — founder account playbook: answer pint-price questions in
  r/london / r/CasualUK / borough subs with data + methodology link, never spam; monthly
  "state of pint prices" post. Brand mentions are AI-model training signal.
- **S4.3 Short-form social** — map fly-through clips (borough heat map), "cheapest pint
  challenge" format; reuse OG card system for thumbnails.
- **S4.4 Partnerships** — deferred until B-wave (aligns with sol.md Rails); QR-at-bar
  drives the data flywheel more than search.
- **S4.5 Founder/fundraising surface** — `/about` story page (why PUBMAXX exists, the
  provenance ethos, traction numbers) — doubles as press bio and investor link.

## Owner actions (only you can do these)

1. **Google Search Console** — verify pubmaxxing.com (DNS TXT via Cloudflare), submit
   sitemap once S1 ships. Same for **Bing Webmaster Tools** (ChatGPT search reads Bing).
2. Approve the Pint Index methodology page copy before first press pitch.
3. Press pitching itself (founder voice lands; I draft, you send).
4. Reddit account + posting (must be genuinely you; I draft data + links).

## Measurement

- Search Console: impressions/clicks per lane (price / crawl / historic queries).
- `discovery_viewed` sessions with organic referrer (existing analytics, privacy-safe).
- AI citation spot-checks: monthly scripted queries to Claude/ChatGPT/Perplexity
  ("cheapest pint in hackney") logging whether pubmaxxing.com is cited.
- Backlink count on Pint Index page per quarter.

## Sequencing & lanes

S1 → S2 → S3 ship in that order (S1 unblocks indexing; S2/S3 parallelizable after).
All are L-DATA/L-SHEET-adjacent but touch none of Codex's plan/crew files — safe to run
now. S4 starts the day S3.3 (Pint Index) is live.

Non-negotiables carried over: no invented facts, no fake freshness, keyless parity,
no dark-pattern SEO (doorway pages, scraped content, schema for things we can't prove).
