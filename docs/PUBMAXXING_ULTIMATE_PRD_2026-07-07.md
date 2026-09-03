# PUBMAXXING — The Ultimate Product Requirements Document (Historical)

> **SUPERSEDED (2026-07-16)** by [`MASTER_PRD.md`](./MASTER_PRD.md). Retained for
> historical vision and persona evidence only.
**Version:** 2026-07-07 (Consolidated Master)  
**Authors:** Grok (synthesizing Fable, Opus, GLM 5.2, all prior agents, first-principles analysis)  
**Status:** Superseded historical vision.

---

## 0. Executive Vision (First Principles)

**Elon Musk lens (first principles):**
- Attention is the scarcest resource in a pub (3–8 seconds).
- Creation friction is the enemy of virality.
- Visual beauty and instant feedback create trust.
- Provenance (who said what, when, with what evidence) is PUBMAXXING’s moat.

**Brian Chesky / Airbnb lens:**
- People don’t just want information — they want to *belong*.
- The best products make users feel “I am home here.”
- Photography, typography, and micro-interactions are not decoration; they are the product.
- Trust is built through beautiful, consistent, human-centered design.

**Combined North Star:**
PUBMAXXING is the place where every generation feels they belong — the 18-year-old on their first legal pint, the 45-year-old chasing nostalgia, the 70-year-old passing down family stories — all using the same map, the same Spills, and the same beautiful interface that feels like X for conversation, TikTok for creation, Instagram for visual delight, and Airbnb for emotional belonging.

---

## 1. Current State of the Repository (Post 2026-07-07 Pull)

After the massive pull (`611c40ff`), the codebase now contains:

**Core Implemented Areas:**
- **Drinks expansion** — Full drink categorization, price refresh pipeline, Wetherspoons integration, non-alcoholic support, new `lib/drinks.ts`, `components/drinks/`.
- **Ratings** — Star ratings, drink ratings, optimistic UI; venue context stays in Visit Reports.
- **Messaging** — Private messages, realtime, `app/messages/`, `lib/messages.ts`.
- **Rounds & Presence** — Group rounds, ambient presence, round presence.
- **Social primitives** — The Spill, optimistic posting, reactions, comments, saved lists, follow graph.
- **Map** — MapLibre fixes, lazy loading, realtime CSP, zero console errors.
- **Typography** — Space Grotesk pivot for Gen-Z visual identity.
- **New routes** — `/activity`, `/messages`, `/rounds`, `/bar-tab`, `/ledger`, saved list detail pages.
- **Many new tests** and migrations up to 0020.

**Gaps still visible on live site:**
- Map loading experience remains janky (“Loading London pub map...”).
- Spill creation is not yet camera-first or TikTok/Instagram quality.
- Generational modes (Ledger vs Lock-In) and accessibility toggles are not yet surfaced.
- Visual design, while improved, does not yet feel like a cohesive “home” across all surfaces.

---

## 2. User Personas (Multi-Generational)

**Gen Z (18–28) — “The Lock-In Crew”**
- Wants: Speed, camera, FOMO, virality, group play, vertical video, Chaos Score, meme export.
- Pain: Keyboard input, small text, no live indicators, slow creation.

**Gen X (40–55) — “The Golden Thread”**
- Wants: Nostalgia, reliability, heritage depth, “Then vs Now”, quiet planning, beautiful print/PDF exports.
- Pain: Noisy feeds, lack of provenance, no offline mode.

**Boomers (60+) — “The Family Table”**
- Wants: Voice input, large text, high contrast, legacy storytelling, simple family sharing, emotional connection to the past.
- Pain: Tiny tap targets, no voice, dense UI, no clear “this is for me” signal.

**Universal Needs**
- Trust (provenance visible on every Spill).
- Belonging (the map feels like “my pubs”).
- Frictionless creation (camera + voice in < 3 taps).
- Beautiful shareable artifacts (OG images, vertical cards, stamp-style visuals).

---

## 3. Product Architecture & Information Architecture

**Single Source of Truth:** The Map + The Spill.

**Primary Surfaces:**
1. **The Map** — The “For You” page (TikTok + Airbnb home).
2. **The Spill Composer** — Camera-first creation (TikTok + Instagram Reels).
3. **The Feed** — Dual-mode timeline (Lock-In vs Ledger).
4. **The Venue Page** — Bar Tab (Instagram profile grid) + Ledger (X thread) + Ratings.
5. **The Round** — Group shared experience (Airbnb “trip”).
6. **Messages & Activity** — Private conversation + live bell (X DMs + notifications).
7. **Profile & Passport** — Identity + gamification (Airbnb profile + collected stamps).

---

## 4. Design System & UI Principles (X + Airbnb + Generational)

**Typography (from latest pull):**
- Space Grotesk as primary display (Gen-Z energy).
- Stamp-style caps reserved for provenance badges, Pint Passport stamps, and “Pint Talk” highlights.
- System sans for body; large, readable sizes by default with easy scaling.

**Color & Atmosphere:**
- Warm pub palette (brass, amber, river blue, paper, ink).
- High contrast mode for Legacy users.
- Subtle textures (coaster, beer mat, receipt paper) used sparingly — never decorative noise.

**Component Language (X-inspired for “Pint Talk”):**
- Spill cards feel like X posts: clean, readable, with visible provenance chip, price stamp, photo, and threaded replies.
- Camera button is the primary action (floating, always accessible).
- Vertical 9:16 Spill cards optimized for mobile and TikTok/IG Stories sharing.
- Optimistic posting with instant preview (already partially built in `optimisticSpillPost.ts`).

**Airbnb-style Emotional Design:**
- Every venue page should feel like “this is my local.”
- Beautiful photography (user Spills + sourced heritage photos) is first-class.
- Micro-interactions (stamp animation on new badge, gentle map orbit, “cheers” reaction) create delight.
- “You belong here” moments: first legal pint badge, family story surfaced, “your saved pubs” on the map.

**Generational Accessibility (non-negotiable):**
- Global “Legacy Mode” toggle: Large text, high contrast, voice input default, reduced motion, bigger tap targets.
- Voice Story Mode: 60-second audio notes (Boomer killer feature).
- Keyboard + screen-reader support on every surface.

---

## 5. The Spill — The Atomic Social Object (X + TikTok + Instagram)

**Fields:**
- Photo (pint or venue) or 15-second video
- Observed price (required for map honesty)
- Text or voice note (Passed-Down Note)
- Vibe / Era / Drink Category tags
- Visibility (Public / Friends / Legacy / Anonymous)
- Location (venue or crawl)
- Provenance badge (always visible)

**Creation Flow (Camera-First, < 3 taps):**
1. Tap floating camera (or “Spill” in composer).
2. Camera opens (rear/front toggle).
3. Live price stepper or quick chips.
4. Voice-to-text or audio recording (default for Legacy mode).
5. One-tap targets: Tonight / Round / Family Table / Dry / Ledger.
6. Instant beautiful preview card (matches final OG image).
7. Post with optimistic UI.

**Rendering Modes:**
- **The Lock-In** — Vertical scroll, live reactions, Chaos Score, FOMO (Gen Z).
- **The Ledger** — Large text, chronological, provenance-first, era filters (Boomer/Gen X).
- **The Golden Thread** — Curated nostalgia + Then vs Now photo comparisons.
- **The Dry Spill** — Non-alcoholic, coffee, food, mocktail focus.
- **The Family Table** — Legacy visibility + voice audio.

---

## 6. Map Experience (The “Home” Screen)

**Loading (P0 fix):**
- Beautiful pitched-London skeleton with pulsing price dots.
- React Suspense + `loading.tsx`.
- Progressive hydration (cached pins first).

**Interaction:**
- Tap pin = Venue Sheet (bottom sheet on mobile, side panel on desktop) with tabs: Spills (Bar Tab grid), Ledger, Ratings, Story, Drinks.
- Long-press or “+” = Add to current Round or start new Spill.
- Live pulsing when new Spills arrive (realtime).
- Filters: Price, Saved, Dry, Quiet, Accessible, Garden, Coding Pint, Era.

**Airbnb-style belonging:**
- “Your pubs” (saved) highlighted with brass bookmark pins.
- “First Legal Pint” and “Family Table” special callouts.

---

## 7. Technical Architecture (Current + Target)

**Already strong:**
- Dual-store seam (Supabase vs in-memory) is consistent and correct.
- Provenance model is respected everywhere.
- Realtime foundations (CSP, presence, messages) are landing.
- Optimistic UI for Spills is partially built.

**Target improvements:**
- Aggressive React Server Components for all shareable pages (`/crawls/[slug]`, `/p/[id]`, `/u/[handle]`, venue pages).
- TanStack Query + Zod for all data fetching.
- Structured logging + error boundaries.
- EXIF stripping + magic-byte validation on uploads (still needed).
- Service Worker + offline cache for map + recent Spills.

---

## 8. Data Model Highlights (Post 0020 Migrations)

- `visit_reports` (Spills) + `pint_drop_*` tables
- `profiles`, `follows`, `saved_pubs`, `saved_lists`
- `crawl_stories`, `rounds`, `round_presence`
- `ratings`, `messages`, `pub_presence`
- `drink_categories`, `drink_price_updates`
- Full RLS + actor-scoped moderation

---

## 9. 8-Week Implementation Roadmap (Prioritized)

**Weeks 1–2: Foundation & Polish**
- Map loading skeleton + Suspense (fix current jank).
- Camera-first Spill composer with voice + AR stamp filters (Space Grotesk).
- Vertical beautiful Spill cards + optimistic posting.

**Weeks 3–4: Realtime & Live Experience**
- Live pulsing pins + /activity bell.
- Ephemeral Tonight Spills.
- The Lock-In lane (real-time, Chaos Score).

**Weeks 5–6: All-Drinks + Ratings + Dry Mode**
- Dry Crawl filters, mocktail attributes, non-alcoholic routes.
- Drink rating surfaces (StarRating, DrinkRatingRow, ratingsClient on the venue menu).
- The Dry Spill mode.

**Weeks 7–8: Generational Polish + Viral**
- Legacy Mode toggle + large text / voice defaults.
- The Ledger view + voice Story Mode + family email share.
- Pint Passport stamps + Chaos Score + meme export.
- One-tap WhatsApp / IG Story / X share with production OG images.

---

## 10. Success Metrics (Love, Not Just Usage)

- Map interactive load < 1.5s (p95).
- Spill creation completion rate > 75%.
- % of Spills shared externally > 30%.
- Cross-generational interaction rate > 20%.
- NPS / qualitative feedback includes “this feels like home” or “my dad and my mates both use it”.
- Dry Crawl usage > 12% of new crawls within 30 days.

---

## 11. Out of Scope (This Ultimate Plan)

- Native iOS/Android apps
- Payments, pub subscriptions, owner dashboards
- Real-time video or voice calls
- Multi-city launch operations
- Complex ML recommendations

---

## 12. Final First-Principles Reminder

Every decision must answer:
- Does this reduce creation friction?
- Does this increase visual trust and belonging?
- Does this make provenance visible and beautiful?
- Does this feel like home to an 18-year-old, a 45-year-old, *and* a 70-year-old?

If the answer to any is “no”, we redesign.

---

This file preserves the complete proposal assembled on 2026-07-07. It is historical,
not the active PRD and not an instruction to begin implementation. Use
[`MASTER_PRD.md`](./MASTER_PRD.md) for product authority and
[`WAYFINDER_MASTER_V1.md`](./WAYFINDER_MASTER_V1.md) for gated execution.
