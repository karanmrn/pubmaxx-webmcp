# Add a Community Heritage Layer Behind a Single Write-Path Seam

PubMaxing's differentiator is not price — pint-prices.com already has price. It is the human layer around a venue: pint photos, observed prices, and Passed-Down Notes (memory and inherited local knowledge). This is the content a competitor cannot scrape, and the mechanic that lets the 30–50s who hold pub knowledge and the Gen Z who discover it meet on the same map.

Adding user contributions forces an architectural decision the app has so far deferred: the product is a static, client-only dataset (`public/data/pint_prices_app_dataset.json`) and cannot accept writes or photos.

## Decision

Introduce a **community heritage layer** — the Pint Drop — persisted through a **single write-path seam**, not through Supabase calls scattered across components.

- All contribution writes go through **one server route handler** backed by Supabase (`visit_reports` table + Supabase Storage for photos). Components never call Supabase directly.
- On read, contributed data (prices, heritage, story flags) merges into the **existing per-venue `curation` object** already consumed by the map and side panel. The map's existing `story` / `writer` pin glyphs light up from real Pint Drops the same way they light up from editorial seeds — no new render path.
- **Provenance is a typed, first-class field** on every claim: `Sourced` (editorial, with a source link), `Contributor` (a Pint Drop), or `Anecdote` (an unverifiable Passed-Down Note). It is always shown.
- Identity in v1 is a lightweight **Contributor Handle** (no full accounts); real auth is deferred.
- Because contributions are user-generated content, the seam owns the **trust boundary**: a hide/report path, server-side validation, no inline user HTML, and image handling via Storage — these are not optional even in the MVP.

## Consequences

- The deferred Supabase backend now earns its place, scoped to exactly this feature — not a general rewrite.
- "Log a price" (an original goal never built) and the pint photo become the **same object**: a Pint Drop carries a price, and the photo is the evidence that makes the price trustworthy.
- The existing crawl (a Crawl Route) is unchanged; it remains the "list" primitive that a future social loop can build on.
- One seam means one place to test contributions, one place to enforce moderation, and one place to reason about abuse.
