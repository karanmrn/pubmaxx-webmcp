# PUBMAXXING — Production Polish + Broad Appeal PRD (for Fable)

**Date:** 2026-07-06  
**Audience:** Fable (and any follow-on agent)  
**Goal:** Take the current live site (pubmaxxing.com) from a beautiful landing + demo-grade social layer to a production-grade, shareable, multi-generational social product. Make it the default app for Gen Z night-crawlers, Gen X planners, and Boomers preserving family pub stories.

**Live Site Observation (via direct fetch of pubmaxxing.com + /map + /feed):**
- Landing is excellent: strong narrative ("Every pint has a story"), clear three pillars (Price/Setting/Story), The PUBMAXXER example, Pint Drops strip, Golden Days, borough picker, inclusive footer language ("Gen Z, Gen X, and everyone between").
- /map shows "Loading London pub map..." — heavy client-side hydration.
- /feed exists with filter tabs (Latest, Tonight, Friends, Near Me, demo, Cheap Legends, Crawls, Golden Days) but still shows "demo" tags and limited real data.
- Many social surfaces (Crawl Stories, profiles, durable reactions) are not yet visible or are still URL-encoded/localStorage.

**Current Local vs Live Gap:** Local has more advanced social schema (migration 0006), crawl story store, profile/follow stores, but they are not yet wired to production Supabase or surfaced on the live domain. The landing has already absorbed some generational language.

---

## 1. Bugs & Defects Visible on Production / in Codebase

### High Impact (Fix First)
1. **Map Pin Tap Mutation** (`components/PubMap.tsx:106-112`): Tapping a pin in Build mode adds/removes it from the crawl. Users destroy their own routes accidentally.
2. **Venue Name Resolution** (`lib/feed.ts`, `FeedCard.tsx`, profile pages): Raw IDs like `venue-16pnwmm` instead of real pub names. Breaks trust and scannability.
3. **Report Race Condition** (historical `pintDropsStore.ts`): Non-atomic read-then-write on `report_count`.
4. **Demo Mode Leakage**: "demo" tags visible on live feed; many actions still localStorage-only (reactions, comments, saved pubs, crawl stories).
5. **Mobile Experience**: No bottom sheet for venue details; composer not camera-first or thumb-friendly.
6. **OG / Share Previews**: Crawls and Pint Drops have no dynamic link previews — shared links look like plain text in iMessage/WhatsApp.

### Medium Impact
- Inline styles in `SaveCrawlStory.tsx` and a few other components.
- No consistent `<SiteNav>` component across all routes.
- Limited ARIA labels and keyboard navigation on map controls.
- Full dataset fetched client-side on every load (performance on slow networks).
- `next-env.d.ts` modified and should be gitignored.
- The Landlord example on landing is static; real grounded answers not yet linked from live Pint Drops.

### Low Impact / Polish
- Theme toggle not discoverable on desktop nav.
- Empty states lack "next action" guidance.
- No structured logging on API routes.
- Playwright E2E not running in CI.

---

## 2. Generational Appeal Gaps (What Keeps People Away)

**Gen Z (18-28) — Viral, Social, FOMO, Mobile-First**
- No live "Who's Here Tonight" presence or heat map.
- No quick camera/video logging (15s PintTok clips).
- No group planning or ephemeral live location sharing.
- No Chaos Score, meme export, or "Add to My Story" branded template.
- Feed feels static; no infinite scroll or real-time updates.

**Gen X (40-55) — Nostalgia, Reliability, Planning, Heritage**
- "Golden Days" and "Then vs Now" price history exist only in seeds, not as first-class filters or venue page sections.
- No offline mode or print/PDF export of crawls.
- No "Quiet Pint" or low-stimulation filters.
- Heritage deep-dives are shallow; no sourced historical photos or era timelines.

**Boomers (60+) — Simplicity, Legacy, Accessibility, Voice**
- No voice-to-text for Passed-Down Notes.
- No large-text / high-contrast / reduced-motion accessibility mode.
- Passed-Down Notes not surfaced as "family legacy" stories.
- No one-tap "Email this to family" that generates a clean, accessible summary.
- Text density and tap targets not optimized for older users.

**Universal Missing Features**
- Non-alcoholic, food, coffee, and mocktail crawl styles + filters.
- Accessibility filters (step-free, seating, accessible toilets, quiet hours).
- Real Supabase Auth + durable profiles (Magic Links).
- Calendar integration ("Add crawl to Google/Apple Calendar").
- Offline resilience (Service Worker + cached map + drops).
- Granular privacy (friends-only, anonymous, public) on every drop/story.

---

## 3. Recommended Changes (Prioritized Backlog for Fable)

### Phase 1 — Production Readiness & Shareability (Week 1)
1. Fix map pin tap mutation bug — separate inspect vs. mutate actions.
2. Ship venue name resolution (generate `public/data/venues-index.json` or server lookup) and use it in feed, profile, and inspector.
3. Implement durable Crawl Stories:
   - `POST /api/crawl-stories` that saves to `crawl_stories` + `crawl_story_stops`.
   - Server-rendered `/crawls/[slug]` page.
   - Dynamic OG image at `/api/crawl-card?slug=...` using `next/og`.
4. Implement Pint Drop permalinks:
   - `/p/[id]` standalone social card.
   - `/api/pint-card?id=...` OG image with photo + giant price stamp.
5. Apply migration 0006 to production Supabase (or confirm it is applied).
6. Add `next-env.d.ts` to `.gitignore` and clean the modified file.

### Phase 2 — Identity + Mobile Social Shell (Week 2)
7. Finish Magic Link auth flow (`lib/authClient.ts` + Supabase Auth) and profile bootstrap on first sign-in.
8. Build mobile bottom sheet for venue inspector (tabs: Pints / Story / Crawls / Details).
9. Add "I'm Here" geolocation preselect in the Pint Drop composer.
10. Wire real reactions + comments to Supabase tables (move off localStorage).
11. Add live presence dots on the map (opt-in `pub_presence` or reaction type) + "Tonight" feed lane.

### Phase 3 — Generational Hooks MVP (Week 3)
12. "Golden Days" + "Then vs Now" price charts on venue pages (sourced historical data + inflation calc).
13. Voice-to-text input for Passed-Down Notes (Web Speech API, one-line addition).
14. Large-text / high-contrast accessibility toggle (persisted in localStorage + CSS variables).
15. Chaos Score + basic meme image export for crawls (Gen Z viral hook).
16. Non-alcoholic / Food / Coffee / Accessibility filters (simple attribute checks + UI toggles).
17. One-tap "Email to family" that generates a clean, accessible HTML summary (Boomer hook).

### Phase 4 — Polish, Hardening & Docs (Week 4)
18. Extract `<SiteNav>` component and use everywhere; move theme toggle into it.
19. Remove all remaining inline styles; move to CSS modules or globals.
20. Add cursor pagination + infinite scroll on mobile feed.
21. EXIF stripping + magic-byte validation on photo uploads.
22. Structured logging + rate limits on all write endpoints.
23. Run Playwright in CI; add visual regression snapshots (landing, map, feed, profile, crawl story).
24. Update `teach.md`, `README.md`, and archive old PRDs.
25. Add offline support (Service Worker + IndexedDB cache for map + recent drops).

---

## 4. Success Metrics (What "Done" Looks Like)
- 30%+ of shared crawls use durable slug URLs with working OG previews.
- D1/D7 retention >25% for authenticated users.
- 20%+ of new Pint Drops come from users 50+ (optional age-range in profile).
- >60% of Pint Drop logs happen on mobile viewports.
- Zero "venue-XXXX" IDs visible in feed or profiles.
- NPS / qualitative feedback includes "my dad and my mates both use it."

---

## 5. Out of Scope (This Handoff)
- Native mobile apps.
- Payments, pub-owner dashboards, event ticketing.
- Real-time chat or video.
- Multi-city expansion.
- Complex ML recommendations.

---

## 6. Handoff Notes for Fable
- Start with Phase 1 items 1–6. The map pin bug and venue names are the fastest visible wins on the live site.
- The durable Crawl Stories + OG cards loop is the single biggest growth lever — it turns every user into a distributor.
- Keep the "demo mode" graceful degradation at every step.
- Preserve the provenance model and grounded Landlord behavior.
- Think Gen Z (fast, camera, viral) + Boomer (voice, legacy, simple) in every UI decision.

**Historical sprint brief:** current execution order and gates live in
[`MASTER_PRD.md`](./MASTER_PRD.md).

---

*Generated after full repo review + live site observation on 2026-07-06.*
