# PUBMAXXING — Current Implemented State PRD (2026-07-06)

> **SUPERSEDED SNAPSHOT (2026-07-16):** use [`MASTER_PRD.md`](./MASTER_PRD.md)
> for roadmap authority and the repository plus production evidence for current state.

**Historical purpose:** A 2026-07-06 snapshot of what appeared shipped or in demo mode.

**Last Updated:** After reviewing git log (durable saved-pubs, Friends feed, mobile polish, E2E social loop) + full code inventory.

---

## 1. What Has Shipped (Durable + Demo)

### Core Map & Planner (Production)
- 3-D MapLibre rotating view of London with price-coloured pins.
- Suggested Crawl (greedy nearest-good-neighbour) and Build-your-own modes.
- "Saved only" filter on the map (recently landed).
- VenueInspector with tabs, The Landlord (grounded heritage Q&A), Pint Drop composer.
- Shareable URL state for any crawl.
- Curated / Featured routes loaded from `lib/curatedCrawls.ts`.

### Social Layer — Partially Durable (Recent Landings)
- **Pint Drops** (`visit_reports` + Storage): Fully durable when Supabase is configured. Photos, price, vibe tags, Passed-Down Notes, provenance. Moderation with actor-scoped reports and hide threshold. Rate limiting (durable + in-memory fallback).
- **Saved Pubs** (`saved_pubs` table): Durable lists ("Want to Visit", "Cheap Pint", etc.) on profile. Toggle works via API. Falls back to localStorage when Supabase absent.
- **Feed** (`/feed`): "Latest" lane is the default (never empty). "Friends" lane wired to real follow graph. Other lanes (Tonight, Near Me, Cheap Legends, Crawls, Golden Days) exist with demo data or partial wiring.
- **Profiles & Follows** (`/u/[handle]`): Profile pages exist. Follow / unfollow API exists and uses the follow graph. Stats (pints logged, crawls posted) are partially implemented.
- **Crawl Stories** (`crawl_stories` + `crawl_story_stops`): Creation and retrieval exist (both in-memory and Supabase paths). Slug generation, visibility (public/unlisted/draft). Not yet the primary shareable surface on live site (URL-encoded `?s=` still dominant).
- **Reactions & Comments**: API routes exist (`/api/pint-drops/comments`, reactions). In-memory stores for demo; Supabase path ready when migration 0006 is applied.
- **Admin Moderation** (`/admin`): Token-gated console for reviewing hidden drops. Works with durable reports.

### The Landlord & Heritage
- Retrieval-grounded answers only. +10 new sourced London pub-history records recently added.
- Rate-limited, cost-protected OpenRouter calls with in-memory fallback.

### Mobile & Visual Polish (Recent)
- Mobile 375px + light/dark theme polish across social surfaces.
- Consistent mobile tab bar / navigation.
- E2E test coverage for read-only social loop (feed names, permalink, share, crawls).

### Data & Backend
- Migration 0006 (`profiles`, `follows`, `saved_pubs`, `pint_drop_*`, `crawl_stories`) exists and is the source of truth for durable social.
- Consistent "seam" pattern: every store (`savedPubsStore`, `followStore`, `crawlStoryStore`, `pintDropsStore`, etc.) selects Supabase when `SUPABASE_URL` + service key are present, otherwise falls back to in-memory. Never silent failure in production.
- Rate limiting, IP hashing, and provenance are enforced on all write paths.

---

## 2. What Is Still Demo / LocalStorage Only

- Most reactions, comments, and follow counts on the live site are still driven by localStorage or synthesized data.
- Crawl Stories are still primarily shared via base64 `?s=` URLs (not durable `/crawls/[slug]` yet).
- Live presence ("Who's here tonight"), Chaos Score, video Pint Drops, voice input, Golden Thread / Ledger views do **not** exist yet.
- Real Supabase Auth (Magic Links) and profile claiming are not wired (handles are still self-asserted localStorage values).
- "Then vs Now" price charts, accessibility mode, Family Table visibility, meme export, and group Round threads are not implemented.
- Venue name resolution in feed/profile is incomplete (some raw IDs still visible).

---

## 3. Architecture That Is Now Proven

- **Dual-store seam** (`isSupabaseConfigured()` + `requiresSupabaseStore()`) is the correct pattern and is used consistently across `lib/*Store.ts` files.
- **Provenance never flattens** — Sourced / Contributor / Anecdote / Demo badges are respected in merging and display.
- **Graceful degradation** — the app works fully keyless for local dev and degrades cleanly when Supabase or OpenRouter is unavailable.
- **Mobile-first surfaces** — recent polish landed for 375px viewports and theme consistency.

---

## 4. Recommended Next PRD Focus (for Fable / Next Agent)

Based on what is actually built, the highest-leverage remaining work is:

1. **Make Crawl Stories the primary durable shareable object** (Phase 1 of previous PRDs) — this turns every user into a distributor.
2. **Surface real durable reactions + comments** on the live feed and Pint Drops.
3. **Finish venue name resolution** everywhere (quick win, high trust impact).
4. **Add The Spill composer enhancements** (voice, visibility, "with") as the foundation for generational modes.
5. **Apply migration 0006 to production Supabase** if not already done, then flip the seam to durable for follows, saved pubs, and crawl stories.
6. **Build the first generational view** (The Ledger or The Lock-In) on top of existing Pint Drops.

---

## 5. Historical-snapshot boundary

This file is read-only historical evidence from 2026-07-06. Do not use it to direct
implementation, infer current production state, or record later delivery. Use
[`MASTER_PRD.md`](./MASTER_PRD.md) for current roadmap authority and verify all
implementation claims against the repository and production evidence.

---

*Generated 2026-07-06 from git history, code inventory, and live site at pubmaxxing.com.*
