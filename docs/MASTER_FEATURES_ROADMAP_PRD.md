# PUBMAXXING — Master Features & Roadmap PRD (Historical)

> **SUPERSEDED (2026-07-16)** by [`MASTER_PRD.md`](./MASTER_PRD.md). Retained for
> historical feature provenance only.

**Date:** 2026-07-07 (post latest pull)  
**Status:** Superseded historical roadmap.

This document combines:
- Current implemented state (after `ea05b9d` pull)
- First-principles analysis (X/TikTok/Instagram lens)
- Generational bridge vision (The Spill / Ledger / Lock-In)
- New opportunities from latest commits (all-drinks, realtime, Space Grotesk, lazy-load map)
- Fresh feature ideas from live site + codebase inspection

---

## 1. Current Live Site vs Latest Code Gap

**Live (pubmaxxing.com):** Beautiful landing, "Loading London pub map..." on /map, demo-grade social surfaces. Map loading and Spill creation are not yet at TikTok/Instagram quality.

**Latest local code (after pull):** Map stability fixes, lazy-load venue detail, realtime CSP, all-drinks expansion PRD, Space Grotesk typography pivot, hydration fixes. These have **not yet shipped** to production.

**Opportunity:** The gap between the polished landing and the map/social experience is the highest-leverage area to close.

---

## 2. First-Principles + Platform Lessons (X / TikTok / Instagram)

**Core truths:**
- Attention in a pub = 3–8 seconds.
- Creation friction kills everything.
- Visual beauty = trust.
- The map/feed must feel alive instantly.
- Provenance is our differentiator (make it as visible as a verified badge).

**What to copy:**
- TikTok: Camera-first, vertical media, algorithmic "For You", live/FOMO.
- Instagram: High-quality cards, Stories (ephemeral Tonight), profile grids (Bar Tab).
- X: Real-time updates, threaded conversations, Following graph.

**What we already have that they don't:** Grounded heritage + multi-generational memory.

---

## 3. The Spill — Unified Social Primitive (Updated)

**The Spill** remains the atomic unit (photo + price + note + voice + visibility).

**New rendering modes (post all-drinks + Gen-Z pivot):**
- **The Lock-In** — Tonight / live / Chaos Score / vertical 9:16 cards (Gen Z + TikTok energy)
- **The Ledger** — Large text, high contrast, era filters, provenance-first (Boomer + Gen X)
- **The Golden Thread** — Curated nostalgia + Then vs Now photo comparisons
- **The Round** — Group shared crawl with live Spills from friends
- **The Family Table** — Legacy visibility + voice audio notes
- **The Dry Spill** — New (all-drinks): mocktails, coffee, food, non-alcoholic filters, "Dry Crawl" mode

**New creation features:**
- Camera-first composer (TikTok/IG style)
- Voice-to-text + 60-second audio Story Mode (Boomer-friendly)
- AR photo filters / stamp overlays (Space Grotesk typography, Gen-Z visual identity)
- One-tap "Add to Tonight / Round / Family / Dry"

---

## 4. Map Experience Upgrades (Leveraging Latest Fixes)

**Already in latest code:** Zero MapLibre console errors, lazy-load venue detail, realtime CSP.

**Next features to add:**
- Beautiful pitched-London skeleton + Suspense boundary on /map (fixes current "Loading..." jank).
- Live pulsing pins when new Spills arrive (realtime).
- "Saved only" filter (already shipped) + new "Dry only", "Quiet", "Accessible", "With Garden" filters.
- AR "View in your room" mode for heritage pubs (fun, Instagram-style).
- "Pint Passport" stamps on the map (gamification — collect stamps for visited venues).

---

## 5. New Feature Ideas (Post-Inspection)

### 5.1 All-Drinks Expansion (from latest PRD `ea05b9d`)
- **Dry Crawl** mode: non-alcoholic, coffee, food, mocktail filters + routes.
- "Sober Curious" and "Designated Driver" badges.
- Venue attributes for mocktails, great coffee, late-night food.
- "Then vs Now" extended to non-alcoholic drinks and food prices.

### 5.2 Gen-Z Visual & Typography Pivot (from `e21a318`)
- Space Grotesk as primary display font, stamp-style caps for provenance badges and "Pint Passport" stamps.
- Vertical 9:16 Spill cards optimized for TikTok/IG Stories sharing.
- "Spill Reel" — 15-second video Spills with trending sound overlays (pub sounds, cheers, lock-in chants).

### 5.3 Realtime & Live Presence (from `9359580`)
- /activity bell + live "X people spilling right now" indicator.
- Ephemeral "Tonight" Spills that auto-expire after 12 hours (Stories-style).
- Group live location sharing (opt-in, privacy-first) during a Round.

### 5.4 Gamification & Retention
- **Pint Passport**: Collect digital stamps for venues, crawls completed, eras visited. Shareable passport image.
- **Chaos Score** + meme export for every Round.
- **Rejected historical proposal:** streaks and drinking-frequency anniversaries are
  not part of PUBMAXX; see [`MASTER_PRD.md`](./MASTER_PRD.md).
- Leaderboards: Cheapest pint found this month, Most Spills in a borough, Best Passed-Down Note.

### 5.5 Accessibility & Boomer Legacy
- Global "Legacy Mode" toggle: large text, high contrast, voice input default, reduced motion.
- Voice Story Mode: 60-second audio attached to a venue (grandad's table story).
- One-tap "Email this Round to family" that generates a clean, accessible HTML summary with photos and notes.
- "Then vs Now" photo upload (users can add old photos of the pub).

### 5.6 Group & Social Mechanics
- **The Round** creation with split-bill link (generate a simple payment request for the group).
- Friend suggestions based on overlapping saved pubs or similar taste in eras/price.
- "Invite via WhatsApp" deep link that pre-fills the handle and crawl.

### 5.7 Discovery & Editorial
- Borough pages (`/borough/shoreditch`) with live cheapest pint, trending Spills, heritage deep-dive.
- "Quiet Hours" filter (low music, good for conversation, sensory-friendly).
- "Coding Pint" routes: sockets, Wi-Fi, quiet tables, late afternoon work pints.
- "First Legal Pint" onboarding flow for 18-year-olds (special badge + guided heritage crawl).

### 5.8 Trust, Moderation & Ops (Hardening)
- Stronger actor-scoped reporting + admin queue (already partially built).
- EXIF stripping + magic-byte validation on uploads (still needed before public launch).
- Structured logging + error boundaries on all write paths.

---

## 6. Updated Priority Roadmap (Next 6 Weeks)

**Week 1–2: Map & Creation Foundation**
- Map loading skeleton + Suspense (leveraging lazy-load work).
- Camera-first Spill composer with voice + AR stamp filters.
- Vertical beautiful Spill cards in feed.

**Week 3: Realtime & Live Presence**
- Live pulsing pins + /activity bell.
- Ephemeral Tonight Spills.
- The Lock-In lane (real-time, Chaos Score).

**Week 4: All-Drinks + Dry Mode**
- Dry Crawl filters, mocktail attributes, non-alcoholic routes.
- The Dry Spill mode.

**Week 5: Generational Polish**
- Legacy Mode toggle + large text / voice defaults.
- The Ledger view (large text, provenance-first).
- Voice Story Mode + family email share.

**Week 6: Gamification + Viral**
- Pint Passport stamps + shareable passport image.
- Chaos Score + meme export.
- One-tap WhatsApp/IG Story share with production OG images.

---

## 7. Success Metrics

- Map interactive load time < 1.5s (p95).
- Spill creation completion rate > 70%.
- % of Spills shared externally > 25%.
- Cross-generational interaction on Spills > 15%.
- Dry Crawl usage > 10% of new crawls within 30 days of launch.

---

## 8. Out of Scope (This Master Plan)

- Native mobile apps
- Payments / pub subscriptions
- Pub owner dashboards
- Multi-city launch
- Complex ML recommendations

---

This document records the roadmap proposed on 2026-07-07 and is not an execution
contract. Use [`MASTER_PRD.md`](./MASTER_PRD.md) for current priorities, vocabulary,
gates, and implementation authority.
