# PUBMAXXING — Next Wave Features & Design Principles PRD

> **SUPERSEDED (2026-07-16)** by [`MASTER_PRD.md`](./MASTER_PRD.md). Retained as
> design research; its streak proposals are explicitly rejected by the master contract.

**Date:** 2026-07-08 (post latest pull `67a587a2`)  
**Focus:** Forward-looking features, UI/UX design principles, and the next major iteration after the massive 2026-07-07 foundation.

This PRD is intentionally **new and additive** — it assumes the Ultimate PRD and Security PRD are already accepted and focuses on what to build next.

---

## 1. What Just Landed (Latest Pull Analysis)

The most recent commit (`67a587a2`) delivered exactly the high-leverage items we prioritized:

- **Map Loading Experience** — `app/map/loading.tsx` + `components/map/MapLoadingSkeleton.tsx` (beautiful pitched-London skeleton).
- **Spill Composer** — `components/map/PintDropComposer.tsx` + `spillComposer.css` (major camera-first work).
- **Image Safety** — New test `imageSafety.test.ts` (progress on EXIF/magic-byte validation).
- **Venue Detail Index** — `app/api/venue/[id]/route.ts` and related tests.
- **Visual Polish** — Large CSS updates to `globals.css`, `feed.css`, `discover.css`, `landing.css`, `venueSheet.css`.

This is strong validation that the first-principles direction (map loading + camera-first creation) is being executed.

---

## 2. Design Principles for the Next Wave

We will follow these principles on every new surface:

### 2.1 X + TikTok + Instagram + Airbnb Hybrid
- **X**: Clean text + media posts, threaded replies, provenance chips visible like verified badges.
- **TikTok**: Camera opens first, vertical 9:16 cards, live/FOMO indicators, low creation friction.
- **Instagram**: High-visual-quality photo grids (Bar Tab), beautiful share cards, stamp-style micro-interactions.
- **Airbnb**: Every venue feels like “my local.” Photography and micro-delight create emotional belonging.

### 2.2 Generational Accessibility as Default
- Legacy Mode (large text, high contrast, voice-first, bigger targets) is a first-class toggle, not an afterthought.
- Voice input is the default for older users; camera + speed is the default for younger users.
- The same Spill can be experienced beautifully in any mode.

### 2.3 Provenance is the Trust Signal
- Every Spill, rating, and message must show its provenance badge (Sourced / Contributor / Anecdote / Demo) in a beautiful, stamp-like way.
- Never flatten or hide where information came from.

### 2.4 Optimistic & Instant Feedback
- Every action (Spill, rate, save, message) must feel instant with optimistic UI.
- Errors are handled gracefully with clear recovery paths.

### 2.5 Mobile-First, Thumb-Friendly, One-Handed
- All primary actions reachable with one thumb on 375px–414px viewports.
- Bottom sheets, floating actions, and large tap targets are the norm.

---

## 3. New Feature Areas (Next Wave)

### 3.1 Spill Composer 2.0 (Build on what just landed)
- AR stamp overlays using Space Grotesk typography (Gen-Z visual identity).
- 15-second video Spills with optional trending pub sounds.
- “Add to Tonight / Round / Family Table / Dry” one-tap targets with smart defaults.
- Instant preview that exactly matches the final OG image.

### 3.2 Map 2.0 (Build on the new skeleton)
- Live pulsing pins when new Spills arrive (realtime).
- “Your pubs” brass bookmark pins + “First Legal Pint” and “Family Table” special markers.
- AR “View in your room” mode for heritage pubs (fun, Instagram-style).
- “Quiet Hours”, “Coding Pint”, “Accessible”, “With Garden” filters as first-class chips.

### 3.3 The Ledger & Legacy Mode (Boomer / Gen X killer feature)
- Large-text, high-contrast, provenance-first chronological view of a venue.
- Voice Story Mode — 60-second audio notes attached to a venue or Spill.
- One-tap “Email this Round / Ledger to family” that generates a clean, accessible HTML summary with photos and stamps.

### 3.4 Ratings & Social Proof (New from 2026-07-07 pull)
- Star ratings with optimistic UI (already partially built).
- Drink-menu rating detail; venue context stays in Visit Reports, not leaderboards.
- One-rating-per-user-per-venue with anomaly detection.
- “Then vs Now” photo comparisons (user-uploaded old photos vs current Spills).

### 3.5 Messaging & Private Social
- Private messages between users (already in codebase).
- “Message about this pub” deep link from any venue or Spill.
- Ephemeral “Tonight only” message threads that auto-expire.

### 3.6 Gamification & Belonging (Pint Passport)
- Collectible digital stamps for venues visited, eras explored, Dry Crawls completed.
- Shareable “Pint Passport” image (Instagram / X story ready).
- **Rejected historical proposals:** streaks, drinking-frequency anniversaries, and
  consumption-coded Chaos Score progression. Current progression rules live in
  [`MASTER_PRD.md`](./MASTER_PRD.md).
- “Next Badge” progress chips (already partially built in `NextBadgeChips.tsx`).

### 3.7 All-Drinks & Dry Mode (Major expansion)
- Full drink categorization and price tracking (already in codebase).
- Dry Crawl routes, mocktail attributes, coffee-focused filters.
- “Sober Curious” and “Designated Driver” badges and routes.

### 3.8 Realtime & Live Presence
- /activity bell with live “X people spilling right now”.
- Ephemeral Tonight Spills (Stories-style, auto-expire after 12h).
- Group live location sharing during a Round (opt-in, privacy-first).

### 3.9 Discovery & Editorial
- Borough pages (`/borough/shoreditch`) with live cheapest pint, trending Spills, heritage deep-dive.
- “Quiet Hours” and sensory-friendly filters.
- “Coding Pint” and “First Legal Pint” curated onboarding flows.

### 3.10 Trust, Safety & Ops (Security PRD execution)
- EXIF stripping + magic-byte validation (imageSafety.test.ts is a start).
- Private Storage bucket + signed URLs.
- Hardened composite rate limiting (actor + IP + behavioral).
- Structured logging + Sentry on all routes.
- Admin token rotation and scoped JWTs.

---

## 4. 6-Week Next Wave Roadmap

**Week 1–2: Polish What Just Landed**
- Finish MapLoadingSkeleton + integrate with live data.
- Complete camera-first PintDropComposer with voice + AR stamps.
- Add live pulsing pins and realtime Spill updates on the map.

**Week 3–4: Generational Modes + Ratings**
- The Ledger view (large text, provenance-first).
- Voice Story Mode + family email share.
- Drink rating surfaces (StarRating, DrinkRatingRow) with anomaly detection.

**Week 5: Gamification & All-Drinks**
- Pint Passport stamps + shareable passport image.
- Dry Crawl filters and non-alcoholic routes.
- **Rejected historical item:** Chaos Score and its meme export are not delivery
  guidance; current progression cannot reward consumption or drinking frequency.

**Week 6: Security Hardening + Viral Polish**
- EXIF stripping + private Storage enforcement.
- One-tap WhatsApp / IG Story / X share with production OG images.
- Structured logging + error boundaries on all new routes.

---

## 5. Success Metrics (Love & Trust)

- Map interactive load time < 1.2s (p95) after the new skeleton.
- Spill creation completion rate > 80%.
- % of Spills that include voice or video > 25% within 30 days.
- Cross-generational interaction rate > 20%.
- NPS includes phrases like “this feels like home” or “my dad and my mates both use it”.
- Zero unauthenticated writes or public private media URLs.

---

## 6. First-Principles Reminder

Every new feature must answer:
- Does this reduce creation friction to near zero?
- Does this increase visual beauty and emotional belonging?
- Does this make provenance visible and delightful?
- Does this work beautifully for an 18-year-old, a 45-year-old, *and* a 70-year-old?

If the answer is not a clear “yes” to all four, we redesign or deprioritize.

---

This section preserves the forward-looking proposal as it stood on 2026-07-08. It is
not an instruction to continue obsolete Spill Composer or MapLoadingSkeleton work;
use [`MASTER_PRD.md`](./MASTER_PRD.md) for the active execution programme.
