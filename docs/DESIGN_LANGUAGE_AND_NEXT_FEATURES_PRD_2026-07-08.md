# PUBMAXXING — Design Language & Next Features PRD

**Date:** 2026-07-08  
**Focus:** Design system cohesion + the next set of features that feel like a natural, high-taste evolution of the current implementation.

After reviewing the live site and the latest code (including `MapLoadingSkeleton`, `PintDropComposer`, new CSS, and the camera-first mobile approach), this PRD prioritizes **design language refinement** first, then features.

---

## 1. Current Design State Assessment

**Strengths:**
- The landing page remains elegant, emotionally resonant, and restrained.
- The new `MapLoadingSkeleton` is well-executed — it uses existing design tokens, respects reduced motion, and creates a cohesive pitched-London impression.
- The `PintDropComposer` shows strong product thinking (camera-first on mobile, voice support, generational visibility options, honest copy).
- Space Grotesk + stamp-style provenance is a smart visual direction.

**Gaps in Design Language:**
- The new social and map surfaces (feed, venue sheet, composer) have more visual density and different spacing/typography scales than the landing.
- Provenance badges are conceptually strong but visually understated.
- Micro-interactions in the Spill composer are still minimal.
- There is no clear “Legacy / Ledger” visual treatment yet, even though the composer already supports Legacy visibility.
- The overall product does not yet feel like one cohesive design system across marketing and product surfaces.

---

## 2. Design Language Principles (Going Forward)

We will treat these as non-negotiable for all new work:

1. **One Design System** — The elegance and restraint of the landing page must extend to every product surface (map, feed, composer, venue sheets, ratings, messages).
2. **Provenance as Delight** — Every provenance badge should feel like a beautiful, physical stamp, not a small text label.
3. **Generational Clarity** — Legacy Mode and the Ledger view must feel premium and warm, not like a separate “accessibility mode.”
4. **Camera-First Creation** — On mobile, the photo/voice step comes first. Text and metadata are secondary.
5. **Quiet Belonging** — Subtle, tasteful signals (brass bookmarks, soft glows, stamp animations) make users feel the map is “theirs.”
6. **Consistent Breathing Room** — Spacing, typography scale, and visual density should feel consistent across all surfaces.

---

## 3. Recommended Design System Updates

### 3.1 Provenance Stamp Component
- Create a reusable `<ProvenanceStamp>` component.
- Use Space Grotesk caps, subtle paper texture, and slight rotation.
- Apply it consistently on Spills, ratings, and messages.

### 3.2 Typography & Spacing Scale
- Audit and lock a single type scale + spacing system (rooted in the landing page values).
- Apply it to the new `spillComposer.css`, `venueSheet.css`, `feed.css`, and `globals.css` updates.

### 3.3 Legacy / Ledger Visual Treatment
- Define a distinct but cohesive visual treatment for Legacy Mode (warmer paper background, larger text, more generous line-height, prominent stamps).
- This should feel like a beautiful old pub logbook, not a stripped-down version.

### 3.4 Micro-Interaction Language
- Define a small set of tasteful animations:
  - Stamp “imprint” when selecting visibility or destination.
  - Soft brass highlight when price changes.
  - Gentle waveform for voice input (warm, not clinical).

---

## 4. Next Features (Only After Design Language Work)

Only after the design language feels cohesive should we add these features:

### 4.1 Spill Composer Polish
- Finish camera-first mobile flow with instant preview.
- Add the stamp micro-interactions and voice waveform.
- Support 15-second video Spills (only after photo + voice feel excellent).

### 4.2 Ledger View (High Priority)
- Build the first large-text, high-contrast, provenance-first “Ledger” view of a venue.
- Trigger it from Legacy visibility or a dedicated toggle.
- This gives older users an immediate emotional home.

### 4.3 Map Belonging Signals
- Subtle brass bookmark pins for saved pubs.
- Soft warm glow on venues with recent Legacy/Family stories.
- “Your pubs” filter already exists — make the visual treatment more personal.

### 4.4 Ratings Surface (Tasteful Treatment)
- Star ratings with a very light stamp animation on submission.
- Keep ratings visually secondary to Spills and heritage.

### 4.5 All-Drinks & Dry Mode
- Extend the existing drink categorization work into the map filters and Spill composer.
- Add “Dry Crawl” as a first-class destination option.

---

## 5. 4-Week Focused Roadmap

**Week 1: Design Language Foundation**
- Create `<ProvenanceStamp>` component.
- Lock typography + spacing scale across all surfaces.
- Define Legacy / Ledger visual treatment.

**Week 2: Spill Composer & Map Polish**
- Add micro-interactions to the composer.
- Add quiet belonging signals on the map.
- Finish camera-first mobile flow.

**Week 3: Ledger View**
- Build the first Ledger view (large text, warm, stamp-forward).
- Wire Legacy visibility to it.

**Week 4: Ratings + All-Drinks**
- Tasteful ratings surface.
- Dry mode filters and composer integration.

---

## 6. Success Metrics (Design Quality)

- All new surfaces feel like they belong with the landing page (subjective design review).
- Provenance badges are noticeably more delightful and visible.
- Legacy Mode users report that the Ledger view feels “made for them.”
- Spill creation feels premium and instant on mobile.

---

## 7. Restraint Note

We will **not** add:
- Extra visual noise or decorative elements.
- Over-gamification before the emotional core is solid.
- Video or AR until photo + voice + text Spills feel excellent.

This PRD is intentionally focused on **quality and cohesion** over scope.

---

*End of Design Language & Next Features PRD.*