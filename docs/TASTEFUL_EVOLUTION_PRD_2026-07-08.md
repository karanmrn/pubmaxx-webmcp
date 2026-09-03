# PUBMAXXING — Tasteful Evolution PRD

**Date:** 2026-07-08  
**Tone:** Restrained, thoughtful, high-taste.  
**Purpose:** Review what has been built and suggest only the refinements that make the product feel more cohesive, more human, and more loved across generations.

I have reviewed the live site, the full codebase (including the latest pull with map skeleton and Spill composer), and the design direction. This PRD contains only suggestions that feel like natural, high-taste evolutions of what already exists.

---

## 1. What Currently Feels Right (Good Taste Already Present)

- The landing page remains elegant and emotionally resonant.
- The new `MapLoadingSkeleton` is excellent — it uses existing tokens (`--pint`, `--amber`, `--brick`), respects reduced motion, and creates a pitched London impression with paper grain. It feels like it belongs.
- The `PintDropComposer` shows strong intent: clear visibility options (Public / Friends / Legacy / Anonymous) with honest helper text, generational presets (“Tonight”, “Old memory”, “Family story”), camera + mic + price stepper. This is already thinking about all generations.
- Space Grotesk + stamp-style caps for provenance is a smart Gen-Z visual direction without clashing with the heritage tone.
- The dual-store seam and graceful degradation remain one of the most tasteful technical decisions in the codebase.

---

## 2. What Still Feels Slightly Off (Areas for Tasteful Refinement)

After careful review, these are the areas where the current implementation feels slightly less cohesive or less delightful than it could be:

### 2.1 Visual Density & Breathing Room
- Some new surfaces (especially feed and discover CSS updates) feel slightly more crowded than the original landing. The elegant restraint of the landing has not yet fully propagated to the social surfaces.
- Spacing and typography scale could be more consistent between the map inspector and the feed.

### 2.2 Provenance Visibility
- The provenance badges are conceptually strong but visually understated in many places. They should feel like beautiful stamps, not small text tags.

### 2.3 Spill Composer Micro-Interactions
- The composer is functionally rich, but the transition from camera → preview card → post lacks some of the delightful micro-feedback seen in high-quality apps (gentle stamp animation, price chip “snap”, voice waveform that feels pub-like).

### 2.4 Legacy Mode Surface
- The “Legacy” visibility option exists in the composer, but there is still no dedicated large-text, high-contrast “Ledger” view of a venue. Boomers and Gen X users do not yet have a clear “this is for me” surface.

### 2.5 Emotional Belonging
- The map is becoming very functional, but it still lacks the quiet “this is my local” moments that Airbnb does so well (subtle brass bookmark on saved pubs, soft glow on venues with recent family stories, etc.).

---

## 3. Tasteful Evolution Suggestions (Only High-Signal Ideas)

These are the only refinements I recommend pursuing in the next wave. Each one respects what already exists and aims to make it feel more cohesive and loved.

### 3.1 Make Provenance Beautiful (Stamp Treatment)
- Turn every provenance badge into a small, elegant stamp (using the Space Grotesk caps already chosen).
- Apply a very subtle paper texture and slight rotation so it feels like it was physically stamped on the card.
- This single change would make trust feel delightful rather than administrative.

### 3.2 Refine the Spill Composer Transitions
- Add a gentle “stamp” animation when a visibility or destination chip is selected.
- When the price stepper changes, the preview card should softly update with a brass-tinted highlight.
- Voice input should show a simple, warm waveform (not a generic one) that feels like it belongs in a pub.

### 3.3 Create the First “Ledger” View
- Build a dedicated large-text, high-contrast, provenance-first view of recent Spills for a venue (triggered by Legacy Mode toggle or from the composer’s Legacy option).
- This view should feel like a beautiful, old pub logbook — generous line-height, warm paper background, stamps prominent.
- This gives older users an immediate emotional home without changing the experience for younger users.

### 3.4 Add Quiet Belonging Moments on the Map
- Saved pubs should have a very subtle brass bookmark pin (not a loud icon).
- Venues that have recent “Family story” or “Legacy” Spills should show a soft, warm glow on the pin (respecting reduced motion).
- These are quiet signals that make the map feel personal.

### 3.5 Consistent Breathing Room
- Audit the new feed, discover, and venue sheet CSS for spacing and typography scale.
- Bring the elegant restraint of the landing page into these surfaces so the entire product feels like one thoughtful whole.

### 3.6 Micro-Delight on Ratings (New Feature)
- When a user leaves a star rating, show a small, tasteful animation (perhaps a tiny brass star stamp or a soft “cheers” reaction).
- Keep ratings visually light — they should support the story, not dominate it.

---

## 4. What We Should *Not* Do (Taste Check)

- Do not add more visual noise (extra icons, gradients, or decorative elements) just because other social apps have them.
- Do not make the Legacy / Ledger view feel like a separate “old person mode” — it should feel like a beautiful, premium experience that anyone can enjoy.
- Do not rush video Spills or AR until the core photo + voice + text Spill feels delightful and trustworthy.
- Do not over-gamify (Pint Passport, Chaos Score) until the emotional core (provenance, belonging, story) is rock solid.

---

## 5. Recommended Next Steps (Tasteful Order)

1. **Provenance stamp treatment** — highest impact on trust and delight with relatively low effort.
2. **Ledger view** — gives older users a clear home and demonstrates generational care.
3. **Spill composer micro-interactions** — makes creation feel premium.
4. **Quiet belonging signals on the map** — makes the product feel personal.
5. **Spacing & typography audit** across new surfaces — makes everything feel like one cohesive, thoughtful product.

---

## 6. Closing Thought

The codebase already shows good taste in many places (the map skeleton, the thoughtful visibility options, the generational presets in the composer). The next wave should not be about adding more features, but about making what already exists feel more cohesive, more human, and more loved.

Every suggestion above was chosen only after careful review of the live site, the new components, and the emotional intent of the original landing page.

This is the restrained, high-taste path forward.

---

*End of Tasteful Evolution PRD.*