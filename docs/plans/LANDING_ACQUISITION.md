# cursorplan.md

> New-user acquisition through taste: landing + first map open.
> Drafted from a live computer-use review of pubmaxxing.com (2026-08-07).
> Status: **SUPERSEDED.** Retained as historical design reasoning. Current
> landing hierarchy lives in
> `docs/superpowers/plans/2026-08-14-permanent-one-tap-landing.md` and its tests.
> Do not implement the flag decisions below.

---

## 0. Why this plan exists

A live walk of [pubmaxxing.com](https://pubmaxxing.com) at desktop and ~390px found a product that already has teeth (map bands, honest price disclosure, planner) sitting behind a landing that undersells it. Cold visitors bounce before they feel the map. Regulars who already hunt cheap pints will click through. That gap is a taste and hierarchy problem, not a missing feature.

**Verdict from the review:** Partially ready to attract new users. Average score ~4.7/10 across first impression, clarity, polish, trust, conversion, mobile.

This plan is the smallest sequence of taste-led changes that make a stranger stay, without inventing fake social proof or fighting `docs/VOICE.md`.

---

## 1. Non-negotiables (read before editing)

| Fence | Authority |
|---|---|
| Voice: no em dashes, no exclamation marks, British spelling, no banned marketing words, no fake counts | `docs/VOICE.md`, `__tests__/emDashLaw.test.ts`, `__tests__/landingPriceHonesty.test.ts` |
| Only people-logged price lanes may be dated per row; curated index shares one stamp | AGENTS.md price-lane rules |
| Community price authority vs provisional mark stay separate | `lib/communityPrice.ts`, `components/map/communityPriceSignals.ts` |
| Map density / collision / pin figure honesty are contracts | `buildScene.ts`, `formatPinPriceLabel`, related tests |
| Landing CTA hierarchy already has a flag path (`landingFindMyPint`) and source locks | `__tests__/landingFindMyPintHierarchy.test.ts` |
| Do not invent user counts, "real-time", unverifiable testimonials, or paid-acquisition copy | Voice + taste doctrine |
| Design system continuity over generic AI redesign | Existing tokens, `landing.css`, prior taste waves in `docs/` |

**Taste bar:** Brand first. One composition in the first viewport. One job per section. Show the product, do not decorate around it. Jokes stay off figures, dates, sources, and accessible names.

---

## 2. Problem statement (grounded in what was on screen)

### Landing hero (desktop)
- Brand wordmark is present but the H1 ("Listed pint prices for nights out.") is soft and does not name the outcome.
- Subcopy is honest about publishers, but reads as policy before desire. Footer pitch ("A pint in London can cost eight quid…") already has the better desire rhythm.
- Three actions compete: **Find my pint** (coral primary → `/near`, location-gated), **Open the map**, **Plan with friends**. Final CTA already prefers the map when the flag is off — hero and footer disagree.
- Right plane is a photo with drink-shape pins (`ThamesHero`) — strong DrinkGlyph IP, but illustrative £ tags read as listed prices and do not teach map-band truth.
- Stats chips (pubs / prices / boroughs) are honest and useful; do **not** invent a freshness cue beside them.

### Landing hero (mobile ~390–400)
- H1 + policy lede + primary CTA + secondary + stats fill the first ~844px; product frame (`.lpHeroMap`) starts ~y 772 — effectively below the fold.
- Bottom tab bar and header cluster (bell, messages, theme, Sign in) steal chrome budget.
- Empty Today is **out of scope** for this wave; funnel is land → map.

### Map first open
- Full London density + dual chrome + weather + list + Pub Pal + city chip = power-user surface.
- Price key / `mapPriceLegend` already exists and is VOICE-correct — but easy to miss (mobile key often under Layers).
- Orientation is **not missing**: `FirstRunTour` (4 steps), `MapOnboardingOverlay` ("Start with a story"), optional `BandOnboardingChip`. The bug is **three competing overlays**, and the tour is blocked until analytics consent (`promptBudget`). Tour teaches Map / Moment / Social, not band colours.

### Plan
- Intake is clear and paced (Step 1 of 5), VOICE-clean. Correctly secondary for cold acquisition.

---

## 3. Goals and non-goals

### Goals
1. A cold visitor understands, in one glance, that this is **listed pint prices on a map of London pubs**, with an obvious next step.
2. The primary conversion path is **browse the map without permissions**.
3. First map open feels inviting, not chaotic: one orientation beat, then the tool.
4. Trust reads as honesty (publisher / none, counts that are real), never as invented social proof.
5. Mobile first viewport shows product + one clear CTA, not chrome theatre.

### Non-goals
- Full visual rebrand or new colour system (cream/paper + brass stay; escape the AI-warm cluster by showing product, not by recolouring).
- Fake testimonials, inflated user counts, "real-time" / "updated daily" claims the data path cannot support.
- Replacing `ThamesHero` DrinkGlyph IP with a live MapLibre embed or stock map screenshot.
- Changing community-price authority / corroboration policy.
- Native app or install-prompt growth loops in this wave.
- Rewriting Plan, Social, Tonight, Today, or `/pubs` (not linked from landing).
- A third first-map modal on top of FirstRunTour + MapOnboardingOverlay + analytics consent.

---

## 4. Design principles for this wave

1. **Map is the hero product.** Landing must show map truth (bands, a readable price, empty-as-honest) more than pub atmosphere alone.
2. **One primary CTA.** Browse map first. Location and Plan are secondary.
3. **Desire, then honesty.** Lead with the night-out outcome; keep publisher disclosure close, not as the first sentence.
4. **Orientation, not onboarding theatre.** One dismissible beat on first map open. No multi-step tutorial.
5. **Ship inside existing taste.** Extend `landing.css` / tokens / voice fences; do not invent a new aesthetic lane.
6. **Prove with screenshots and source locks.** Every visible claim stays behind tests already in the tree (`landingPriceHonesty`, `landingFindMyPintHierarchy`, friction voice, em-dash law).

---

## 5. Proposed workstreams (locked by dual-model review)

### W1 — Landing hierarchy and copy (must) — PR1
**Owner surfaces:** `LandingPage.tsx`, `landing.css`, `app/page.tsx`, L19 / honesty / chrome tests, `e2e/mobile-landing-entry.spec.ts`.

**Decisions locked**
- **Default (flag-off) primary = Open the map** (`primaryCtaHref`: preferred city map or `/choose-city`). No geo gate.
- **Find my pint** and **Plan with friends** = secondary text links.
- Keep `landingFindMyPint` **on** as the geo-primary experiment arm (current flag-on layout). **Do not invert the flag** — change the default-off branch and update L19.
- Reuse flag-on CSS stack (`lpHeroActions--findMyPint`) as the visual template for the new default hierarchy (one primary + text secondaries).
- Rewrite H1 / lede: desire first, then one honesty breath. Steal footer pitch rhythm. No banned words, no exclaims, no em dashes, ≤2 lines at 1440.
- **No freshness / collected-month chip on hero stats.** Counts stay as they are.
- Align final CTA with hero (both map-primary when flag off).
- Fix `e2e/mobile-landing-entry.spec.ts` in the same PR (retired H1/CTA expectations).

**Copy direction (not final — VOICE-check before ship)**
- H1 candidates: "See what a London pint actually costs." / "Listed pint prices on the map." / "See pint prices on the map before you set off."
- Lede shape: expensive London pint → open the map → pick a drink / cheaper pours → publisher when named, none when not (second breath, not first sentence).

**Acceptance**
- First viewport: brand, one H1, one short lede, one primary CTA, one product visual.
- Primary opens map with **no** geolocation prompt.
- L19, `landingPriceHonesty`, em-dash law green.

### W2 — Hero product frame (must, taste-critical) — PR1 with W1
**Owner surfaces:** `ThamesHero.tsx`, `landing.css`.

**Decision locked: hybrid ThamesHero (option 1+3).** Keep DrinkGlyph IP. Ground the plane toward map truth (warm basemap / Thames wash / soft grid scrim). Restyle pin chrome with **decorative** band-colour rims from the real price key vocabulary — not authority claims. No live MapLibre. No stock map screenshot card.

**Illustrative price honesty (trust landmine)**
- Figures are coded "illustrative only" but UI reads them as listed. Fix: figcaption must say examples are not live listed prices, and accessible names must not say "about £X" as if authoritative — either drop figures from `aria-label` or label them as examples.

**Mobile fold gate**
- Product frame must enter the first ~390×844 viewport. Current `.lpHeroMap` at ~y 772/844 **fails**. Reorder / tighten copy+CTA+stats so the frame is visible without scroll.

**Acceptance**
- Stranger can parse "drink → map filter with a price cue" without reading a long caption.
- Mobile: product frame in first viewport (measured).
- No pin figure that claims community/corroborated authority.

### W3 — First map open orientation (must) — PR2
**Owner surfaces:** `FirstRunTour.tsx`, `lib/firstRunTour.ts`, `MapPriceControl.tsx` / mobile `MapKey`, `MapOnboardingOverlay`, `lib/explicitMapIntent.ts`, prompt budget.

**Decision locked: consolidation, not addition.**
1. After analytics consent is resolved, one-shot auto-expand existing desktop `MapPriceControl` / mobile key (sessionStorage gate), then collapse. Reuse `mapPriceLegend` strings only.
2. Collapse `FirstRunTour` to **one** band-colour beat (legend title + four swatches); dismiss → `markTourSeen()`. Demote Moment/Social from first session.
3. Defer `MapOnboardingOverlay` until tour/legend dismissed (align dismiss keys with `shouldShowCuratedOnboarding`).
4. **No new modal pattern.** Respect `PROMPT_ORCHESTRATION` / analytics budget.
5. **Camera / named-neighbourhood default: deferred.** Optional later, only when `explicitMapIntent` is false; high regression risk vs Pint Index / deep links. Default `zoom: 11.5` city view stays for PR2.

**Acceptance**
- Visitor can state green / amber / dear / grey within ~5 seconds on first clean open.
- At most one orientation surface after consent; never three.
- Intentional arrivals still skip tour (existing `explicitMapIntent` behaviour).

### W4 — Trust without fiction (defer unless PR1 feels thin)
- Hero chips: **no date.**
- Optional month-only dataset line from `freshness_registry` / `PINT_DATASET_OBSERVED_AT` only in footer or `/about`, worded as listed-dataset collection ("Price records last checked July 2026"), never "updated", never per-row.
- Empty "No price logged yet" stays; no begging CTAs.

### W5 — Mobile chrome restraint (mostly absorbed by PR1)
- One full-width primary + text secondaries (flag-on stack as default).
- Trust captions never ellipsis (existing mobile chrome contracts).
- **Cut Today-tab empty-state work** from this wave.

### W6 — Measurement (PR2 with W3)
- Add `landing_cta_clicked` `{ target: "map" | "near" | "plan" }`.
- Superseded 2026-08-19: `map_legend_dismissed` and the W3 legend one-shot are
  retired. The price key folded into Layers, which nothing auto-opens, so the
  event had no emitter and would have read zero for ever.
- `discovery_viewed` and `tour_complete` already exist.
- Funnel: land → map open → pin select / search. No vanity metrics.

---

## 6. Sequencing (locked)

```
PR1 (one landing composition):
  W1  CTA flip + H1/lede rewrite
  W2  Hybrid ThamesHero + mobile fold fix + illustrative £ honesty
  Tests + proof shots (1440 / 390, light + dark)

PR2 (fast follow):
  W3  Legend one-shot + FirstRunTour collapse + defer curated onboarding
  W6  landing_cta_clicked

Defer:
  W4  freshness/footer note unless PR1 trust still feels thin
  W5  absorbed by PR1
  Camera / neighbourhood default — only after legend beat; explicitMapIntent-safe
```

Do not ship copy that promises map-band literacy until ThamesHero shows band language.

---

## 7. Risks and traps

| Risk | Mitigation |
|---|---|
| Fighting L19 Find-my-pint flag / tests | Change flag-off default only; keep flag-on as geo experiment; update L19 + `e2e/mobile-landing-entry.spec.ts` in PR1 |
| Illustrative hero £ reading as listed | Figcaption + accessible-name fix in W2; honesty tests |
| "Freshness" / "live" beside curated counts | No hero date chip (locked) |
| New map modal on top of analytics + tour | W3 consolidates only; no third overlay |
| Generic map screenshot hero | Hybrid ThamesHero only; no stock map card |
| Palette reboot to escape cream+coral | Locked: continuity; escape via product frame |
| Neighbourhood camera vs deep links | Deferred; must respect `explicitMapIntent` |
| Concurrent next-dev / build clobber | Use `NEXT_DIST_DIR=.next-prod` for proof builds |

---

## 8. Proof checklist

- [ ] Desktop landing first viewport (light + dark)
- [ ] Mobile 390 landing first viewport (light + dark)
- [ ] Desktop map first open (orientation visible once)
- [ ] Mobile map first open
- [ ] `npm run lint` + targeted vitest for landing hierarchy / honesty / voice
- [ ] Manual: primary CTA opens map without geolocation prompt
- [ ] Manual: Find my pint / Plan still reachable as secondary

---

## 9. Open questions — RESOLVED

| # | Question | Decision |
|---|---|---|
| 1 | Open the map vs Find my pint / flag invert? | **Open the map** = flag-off default primary. Keep `landingFindMyPint` on as geo experiment. Do not invert the flag. |
| 2 | ThamesHero vs true map frame? | **Keep DrinkGlyph.** Hybrid evolve (map ground + band rims). No live MapLibre / stock map card. |
| 3 | Lightest first-map orientation? | **Consolidate:** one-shot existing price key + collapse FirstRunTour to one band beat; defer curated onboarding. No new modal. |
| 4 | Freshness beside stats? | **None on hero.** Optional registry month line only in footer/about if needed later. |
| 5 | Escape cream/coral AI cluster? | **Brand continuity.** Escape via product frame in hero, not palette reboot. |

---

## 10. Dual-model review log

> Grok 4.5 and Composer 2.5 each: (a) walked the live site with computer use, (b) read landing/map/voice/taste code, (c) challenged the draft, (d) locked joint decisions in §10.3. Plan body (§2–§9) rewritten to those decisions.

### 10.1 Grok 4.5 — 2026-08-07

**Method:** Live chrome walk of pubmaxxing.com (desktop 1440 and mobile ~390): landing first viewport, map first open (with and without analytics consent), plan intake Step 1 of 5. Screenshots under `/opt/cursor/artifacts/screenshots/grok-review/` (`*-live.png`). Deep read of `LandingPage.tsx`, `ThamesHero.tsx`, `landing.css`, `docs/VOICE.md`, taste PRDs, `lib/firstRunTour.ts`, `lib/explicitMapIntent.ts`, `lib/aboutStats.ts`, `lib/dataFreshness.ts`, `lib/promptBudget.ts`, `FirstRunTour.tsx`, `MapPriceControl` / `mapPriceLegend`, L19 / honesty / chrome tests, wordmark.

#### Verdict

**Approve the plan's direction with firm amendments.** The draft correctly diagnoses hierarchy, desire-before-policy, map-as-product, and VOICE fences. It underweights three live facts: (1) production already ships Find-my-pint as the coral primary while the final CTA prefers the map; (2) ThamesHero prices are coded as "illustrative only" yet read as listed figures; (3) a first-run tour already exists and is blocked behind analytics consent, so inventing a second modal is the wrong W3 path.

Taste score agreement: landing is elegant but policy-led; cold acquisition is underserved. Ship W1+W2 as one composition. Treat W3 as amplify-existing-key + retarget-tour, not a new overlay pattern.

#### What to keep

- Goals 1–5 and non-goals (no fake proof, no rebrand, Plan stays secondary).
- Desire then honesty; one primary CTA; browse map without geo.
- W1+W2 sequenced together; do not promise a map frame W2 did not ship.
- Honesty fences (`landingPriceHonesty`, em-dash law, no invented counts).
- Proof checklist and risk table shape.
- Flag-on CSS pattern (`lpHeroActions--findMyPint`) as the visual template for the new default hierarchy.

#### What to cut or change

| Draft item | Change |
|---|---|
| W2 option 2 (true live/static map frame as default) | Demote to fallback. Prefer evolve/hybrid ThamesHero; a stock map card is the generic-AI trap this brand already escaped. |
| W3 "one new first-visit beat" as if nothing exists | Replace: retarget `FirstRunTour` step vocabulary + first-show amplify of existing `MapPriceControl` / price key. No third interruptive surface. |
| Soft "prefer neighbourhood camera" | Narrow: optional first-open zoom toward a named patch (e.g. Soho / Camden density) only on clean arrivals with no `explicitMapIntent`; never fight deep links or Pint Index arrival freeze. Default London `mapView` is already `zoom: 11.5` city-wide (`lib/cities.ts`) — that is the scream. |
| W4 "freshness phrase if real stamp" as vague | Prefer omit on hero chips. If anything ships, bind only to `PINT_DATASET_OBSERVED_AT` / `formatObservedDate`, worded as listed-dataset collection, never live or per-row community dating. |
| W5 Today-tab softness | Cut from this wave. Landing handoff should open Map, not Today; do not rebuild Tonight/Today empty states here. |
| Three-way CTA competition left half-decided | Make Open the map the unconditional default primary; keep `landingFindMyPint` as opt-in experiment that promotes `/near`. Do not invert flag semantics into a double-negative. |

#### Live findings that must drive the wave

**Landing desktop:** Wordmark is strong. H1 "Listed pint prices for nights out." is accurate but soft; lede leads with publisher policy before desire. Coral **Find my pint** owns the fold; Open the map / Plan are quiet. Stats (953 / 2,788 / 33) are honest and useful. Right plane is pub-interior photo + drink glyphs with £ tags — charming IP, not map-band truth. Footer pitch ("A pint in London can cost eight quid…") is better voice than the hero; steal its rhythm.

**Landing mobile ~390:** Measured: H1 + policy lede + primary CTA + secondary links + stats fill the first ~844px; `.lpHeroMap` starts ~y 772, so the product visual is effectively below the fold. Tab bar and header cluster (bell, messages, theme, Sign in) steal chrome budget. Confirmed draft diagnosis.

**Map first open:** Full London density, weather, city suggestion, news chip, Pub Pal, Plan tonight, and the price key all compete. Price key copy is already plain and correct (£5.50 / £7 / dear / grey). `FirstRunTour` (4 steps) appears on mobile after analytics is decided; it orients to Map / Moment / Social, not to band colours. Prompt budget (`lib/promptBudget.ts`) blocks the tour until analytics consent is decided — cold opens often see the consent card, not orientation. Desktop "Start with a story" is suppressed when Tonight lane has rows (`shouldShowCuratedOnboarding`).

**Plan:** Intake Step 1 of 5 is clear, paced, VOICE-clean. Correctly secondary for cold acquisition.

#### Answers to §9 open questions

**1. Open the map vs Find my pint / L19 flag**

**Recommendation:** Make **Open the map** the unconditional default primary (href `primaryCtaHref` / preferred city or `/map` when preferred). Keep **Find my pint** as secondary text → `/near`. Keep **Plan with friends** as tertiary text only. Retain `landingFindMyPint` as an opt-in experiment that restores Find-my-pint as primary (current flag-on layout). Do not invert the flag into "flag means map" — update L19 tests and prop comments so flag-off = acquisition default (map), flag-on = geo-primary test.

**Rationale:** Goal 2 is browse without permissions. Live primary hits `/near` (location-gated). Final CTA already prefers the map when the flag is off — hero and footer disagree. Flag-on CSS is already the right one-primary pattern; flip which action owns it.

**2. ThamesHero drink IP vs true map frame**

**Recommendation:** Keep DrinkGlyph IP (sacred, on-brand). Ship **W2 hybrid**: ground the photo plane in a map-like field (Thames / warm basemap wash or soft street texture) and restyle pin chrome toward map truth — price-band rim colours from the real key, fewer sticker-glass cards, one clearly labelled pint that does not pretend authority. Do not mount live MapLibre in the hero (LCP and density scream). Illustrative £ tags must either (a) lose the figure and keep drink+place, or (b) be captioned as examples and never use "about £X" in accessible names that sound listed. Code already marks prices "illustrative only" (`ThamesHero.tsx`); the UI lies by omission.

**Rationale:** Brand test fails if the first viewport is only atmosphere. A detached map screenshot is the other failure mode. Hybrid keeps IP and teaches the product.

**3. Lightest first-map orientation**

**Recommendation:** No new modal pattern. Three coordinated moves:

1. After analytics consent is resolved (or if already decided), let `FirstRunTour` run once — but rewrite steps so beat 1–2 teach **green / amber / dear / grey** using `mapPriceLegend` vocabulary, then one beat for browse. Cut or demote Moment/Social until later; four product-surface beats are acquisition waste.
2. On first clean map open, auto-expand or pulse the existing desktop price key / mobile `MapKey` once (session flag), then collapse. Reuse legend strings; do not invent a second vocabulary.
3. Optional: nudge default cold camera one zoom step into a named central patch only when `explicitMapIntent` is false. Never mark tour seen on intentional arrivals (already correct).

**Rationale:** Live tour already claims prompt budget and wordmark-brands the card. Stacking another overlay violates "orientation not theatre" and `docs/PROMPT_ORCHESTRATION.md`. The price key already answers the acceptance criterion if it is noticed.

**4. Real freshness signal beside "prices on record"**

**Recommendation:** Prefer **none on the hero readout chips.** Optional quiet note only via `PINT_DATASET_OBSERVED_AT` (`formatMonthYear` / `formatObservedDate` from `lib/dataFreshness.ts`, registry literal `2026-07-03…`). Candidate: "Listed prices collected July 2026", never "updated", never "live", never as if each of the 2,788 rows were dated. Do not put community/drink_price_updates language on the curated count. If the stamp ages past the registry budget, omit rather than show a stale "fresh" cue. `aboutStats` has no stamp — do not fake one inside it.

**Rationale:** Honesty tests forbid dating the curated lane per row. The registry stamp is the one real signal borough pages already use. Composer’s safer "footer/about only" answer is also acceptable; do not invent a hero freshness theatre.

**5. Cream / paper + coral AI-cluster risk**

**Recommendation:** Brand continuity wins. Do not recolour the system in this wave. `--paper` `#f8f2ec` / `#faf8f5` plus `--brass` `#ff5a5f` does sit near the banned cream+terracotta cluster, but the wordmark XX, drink glyphs, map bands (pint/amber/brick), and dry VOICE already differentiate. Escape the cluster by **showing map product in the hero**, not by a palette reboot. Micro-ok: slightly cooler paper wash or less brass glow on the primary button only if W2 still feels brochure-like after the product frame lands. Dark theme is already a separate night language — do not force dark as the acquisition fix.

#### Concrete copy / CTA / hero / map recommendations

**H1 candidates (pick one, VOICE-check):**
- "See what a London pint actually costs."
- "Listed pint prices on the map."
Avoid banned words; avoid exclaims; keep ≤2 lines at 1440 (wave-1 clamp still applies).

**Lede:** Lead with desire, then one honesty breath. Example shape: "London pints can cost eight quid. Open the map, pick a drink, and see which pubs pour it cheaper. When a price names a publisher we show it; when none is recorded, the price says so." Move the long publisher paragraph out of the first sentence; keep the signal section / footer provenance for the full contract.

**CTA stack (default):**
1. Primary button: Open the map
2. Text: Find my pint
3. Text: Plan with friends

**Hero:** Hybrid ThamesHero as above; figcaption should say the shapes are drink filters into the map, and that example figures are not live listed prices if figures remain.

**Map:** Retarget tour + first-show key; suppress competing ambient chips until orientation dismisses if needed (city suggestion / news can wait one beat). Keep Pub Pal secondary.

#### File-level touch list

- `components/landing/LandingPage.tsx` — H1, lede, CTA hierarchy defaults, optional collected-month note, final CTA alignment
- `components/landing/landing.css` — mobile fold: pull product frame into first viewport; default hierarchy uses findMyPint stack styles for map-primary
- `components/landing/ThamesHero.tsx` + `landing.css` hero pin chrome — hybrid ground, band colour language, illustrative price honesty
- `app/page.tsx` — thread observed-date only if a non-hero freshness note ships; keep flag wiring
- `__tests__/landingFindMyPintHierarchy.test.ts` — rewrite flag-off/on expectations
- `__tests__/landingPriceHonesty.test.ts` — lock any new dating / publisher sentences
- `__tests__/landingChromeCss.test.ts` — fold / pin visibility contracts as needed
- `e2e/mobile-landing-entry.spec.ts` — fix retired H1/CTA expectations (Composer catch; agree)
- `components/onboarding/FirstRunTour.tsx` + `firstRunTour.css` — retarget STEPS; bump `pubmax-tour-v1-done` key suffix if content changes enough
- `lib/firstRunTour.ts` — storage key bump; document analytics-budget dependency
- `components/map/MapPriceControl.tsx` / mobile key host — first-show expand once
- `lib/cities.ts` or map cold-start camera helper — optional named-patch zoom (explicit-intent aware); defer behind legend beat
- `lib/analyticsEvents.ts` + funnel docs — hero CTA + orientation dismiss (W6)
- Proof shots under `docs/proof/` after implement

Do not touch: AuthProvider token paths, RLS, community corroboration, pin collision constants, Pint Index archive.

#### Taste risks

- Illustrative hero £ figures read as listed prices (trust landmine).
- New map modal stacked on analytics + tour = nagging.
- Generic map screenshot hero = AI brochure.
- "Prices updated" / "live" / "real-time" beside curated counts = honesty failure.
- Palette reboot to escape cream+coral = loses brand continuity for no acquisition gain.
- Neighbourhood camera that ignores `explicitMapIntent` breaks Pint Index / deep-link arrivals.
- H1 that overpowers the wordmark or drops "pint prices" fails brand-first and clarity.
- Keeping Find my pint coral-primary after this review = shipping the diagnosed defect.

#### Grok amendments (for Composer merge)

- Default primary CTA = Open the map; `landingFindMyPint` stays opt-in Find-my-pint primary; update L19 accordingly.
- W2 = hybrid ThamesHero (keep DrinkGlyph; map-ground; band colour language); demote live/static map frame.
- Fix illustrative price honesty on hero pins (caption or remove figures from accessible claims).
- W3 = retarget existing FirstRunTour + first-show MapPriceControl/key; no new modal.
- Optional cold-open camera nudge only when `explicitMapIntent` is false; defer behind legend beat.
- Prefer no hero freshness chip; if any, only via `PINT_DATASET_OBSERVED_AT` collected-month wording.
- Keep cream/coral system; escape AI cluster via product frame, not recolour.
- Cut Today-tab work from this wave; land → map is the funnel.
- Steal footer pitch rhythm for hero desire line.
- Mobile: product frame must enter the first viewport (current map y≈772/844 fails).
- Agree with Composer: fix `e2e/mobile-landing-entry.spec.ts` in the same PR as W1.

### 10.2 Composer 2.5

**Live walk (2026-08-07).** Screenshots: `/opt/cursor/artifacts/screenshots/composer-review/` (landing desktop + 390, map first open desktop + 390, plan desktop). `/pubs` exists but is not linked from landing; skip for this wave.

**Score adjustment.** The draft’s ~4.7/10 is fair for cold acquisition, but the codebase is further along than the plan admits. Landing already has honest `aboutStats` chips, L19 flag plumbing, AVIF LCP preloads, and a mature map key (`lib/mapPriceLegend.ts` → `MapKey`). The gap is hierarchy and composition, not missing infrastructure.

#### What the draft gets right

- **Desire before disclosure.** The lede opens on publisher policy (`LandingPage.tsx` `heroLede`) while the H1 is abstract. Voice allows honesty; it does not require leading with it.
- **One primary CTA for cold traffic.** Shipped hero defaults to **Find my pint** → `/near` (geo gate). Final CTA already uses **Open the map** as primary when `landingFindMyPint` is off — the page contradicts itself.
- **ThamesHero is product-adjacent, not product truth.** Drink glyphs + illustrative prices (`ThamesHero.tsx`: "illustrative only") do not teach band semantics. Mobile pushes the photo below stats (`landing.css` ≤700px column stack).
- **Map first open is crowded.** Desktop: full London + dual chrome rows + weather + list count + small key card. Mobile: analytics consent + Describe-your-night + tab bar before any band explanation. The price key on phone lives under Layers → Key (`PubMap.tsx`), not first paint.

#### What the draft gets wrong (implementability traps)

| Draft assumption | Code reality | Fix |
|---|---|---|
| "No first-visit orientation" | **FirstRunTour** (4-step modal, map-only, `lib/firstRunTour.ts`) + **MapOnboardingOverlay** ("Start with a story", `MapOnboardingOverlay.tsx`) + optional **BandOnboardingChip** for `?band=` | **Do not add a third modal.** Extend or replace an existing surface. |
| W3 "one dismissible beat" | FirstRunTour is **four** beats and competes with prompt budget (`docs/PROMPT_ORCHESTRATION.md`), analytics consent, and curated onboarding | Collapse tour to **one** band-colour beat, or fold band copy into tour step 1 and cut steps 2–3 from the first session |
| "Prefer named neighbourhood camera" | No simple default-centre constant; `explicitMapIntent` freezes deep links; whole-city view is intentional for cold `/map` | Defer camera work unless we add a **non-deep-link** first-open centroid (e.g. Soho/Camden at z≈14) behind a new localStorage gate — do not fight `explicitMapIntent` |
| W2 "live map frame" | `app/page.tsx` preloads hero AVIF; `ThamesHero` uses `priority` night photo | **Static/hybrid only.** Live MapLibre in hero would blow LCP and tracing budgets |
| Flip CTA "update flag semantics together" | `landingFindMyPint` **on** = Find my pint even more dominant (actions before lede, `lp--findMyPint`) | Change **flag-off default**, keep flag **on** for geo-primary A/B — do not invert flag meaning |
| Freshness beside stats | `aboutStats` has counts only; curated index is one shared stamp (`landingPriceHonesty.test.ts`) | **No date on hero chips.** Month-level dataset note only if wired to `freshness_registry` literal stamp, with copy that never implies per-row dates |
| `e2e/mobile-landing-entry.spec.ts` | Expects retired H1 + "How it works" CTA | Update or delete in same PR as W1 — spec drift is a merge hazard |

#### Open question answers (§9)

1. **Should Open the map become the unconditional default primary?** **Yes.** Make **Open the map** (`primaryCtaHref` → `/choose-city` or preferred city map) the brass primary in the **flag-off** hero. Keep **Find my pint** as secondary text link (or quiet button). Preserve `landingFindMyPint` **on** as the experiment arm that restores Find-my-pint-primary — do not invert the flag; change the default-off branch and update `__tests__/landingFindMyPintHierarchy.test.ts` snapshots accordingly.

2. **ThamesHero sacred vs true map frame?** **Keep drink-shape IP; evolve, do not replace.** Rank **W2 option 1 (evolve ThamesHero)**: subtle band-colour rim on glyphs (decorative, not authority), optional faint map-grid scrim under the photo, keep illustrative price tags labelled as examples in figcaption. Reject live map embed. Pin prices must stay clearly non-authoritative (existing figcaption + `docs/evidence/mobile-hidden-qualifier-audit.md` contract).

3. **Lightest first-map orientation?** **Piggyback `mapPriceLegend` on first open — no new modal pattern.**
   - **Desktop:** auto-open `MapPriceControl` once (`MapPriceControl.tsx` `useState(false)` → sessionStorage gate) using existing `activePriceLegend` rows.
   - **Mobile:** same one-shot, or a single-line chip above the tab bar quoting legend hint text — not a fourth overlay.
   - **FirstRunTour:** replace welcome stack with **one** card: title from `legend.title`, four swatches from `legend.rows`, dismiss → `markTourSeen()`. Drop Moment/Social steps from first session (they duplicate tab bar).
   - **Suppress** `MapOnboardingOverlay` until tour/legend dismissed (`shouldShowCuratedOnboarding` already respects `onboardingDismissed` — align keys).
   - Respect `explicitMapIntent` and prompt budget; never stack over analytics consent.

4. **Which freshness signal beside "prices on record"?** **None on the hero readout.** Safest honest addition: optional footer or `/about` line sourced from `data/freshness_registry.json` `pint_prices` literal stamp, phrased as dataset refresh month ("Price records last checked July 2026"), never "each dated". Community lane dating stays in wedge copy only (`landingPriceHonesty` scoping).

5. **Cream/paper vs escaping AI-warm cluster?** **Brand continuity wins.** `--paper` / brass / ink-deep are load-bearing (nav glass matches `siteNav.css`, memory section, final CTA). Design taste wave 1 already invested here. W2 adjusts **composition and band language**, not palette. Avoid stock-map-dashboard beige.

#### Sharpest minimal sequence (Composer)

```
PR1 (ship together — one composition):
  W1  Flip hero CTA + H1/lede rewrite (desire → disclosure)
  W2  ThamesHero band rim + mobile grid reorder (product frame in first 390px viewport)
  Tests: landingFindMyPintHierarchy, landingPriceHonesty, landingChromeCss, fix mobile-landing-entry drift

PR2 (fast follow):
  W3  One-shot legend open + FirstRunTour collapse to band beat; defer MapOnboardingOverlay
  W6  `landing_cta_clicked` { target: "map" | "near" | "plan" } + `map_legend_dismissed`

Defer:
  W4  unless PR1 still feels thin on trust (footer provenance already strong)
  W5  mostly satisfied once PR1 makes one full-width primary on mobile
  Camera/neighbourhood default — only after legend beat ships; high regression risk
```

**Copy direction (not final).** H1 toward concrete outcome: e.g. "See pint prices on the map before you set off." Subline: one sentence on the map + cheapest nearby; move publisher sentence to second line or wedge #01 (already there). Ban list unchanged (`docs/VOICE.md`).

**Proof.** Re-run shots at 1440 + 390 light/dark; add `docs/proof/landing-acquisition-wave/` mirroring design-taste-wave-1 pattern. Manual: primary opens map with **no** geolocation prompt.

#### Agreements / disagreements with Grok (§10.1)

**Strong agreement.** Both reviews: flip default CTA not the flag; keep DrinkGlyph / no live MapLibre hero; W3 consolidates FirstRunTour + MapPriceControl rather than adding a modal; brand continuity over palette escape; Plan stays secondary; W1+W2 as one composition.

**Grok adds / sharpens (Composer should absorb):**
- Measured mobile fold failure (`.lpHeroMap` ~y 772 of 844) — treat as acceptance gate, not soft CSS wish.
- Illustrative hero £ / "about £X" accessible names are a trust defect, not only a figcaption polish.
- Analytics consent prompt-budget gate is why cold map opens often miss orientation — W3 must sequence after consent, not ignore it.
- Steal footer pitch rhythm for hero desire copy.
- Optional camera nudge is allowed but deferred and `explicitMapIntent`-safe (Composer already defers; keep it deferred).

**Minor tension (resolve in 10.3):** Grok allows an optional registry-backed collected-month note near stats; Composer prefers none on hero. **Default to Composer's stricter none-on-hero** unless PR1 still feels thin on trust after copy rewrite.

---

### 10.3 Joint synthesis — LOCKED (Grok 4.5 × Composer 2.5)

Both models walked the live site with computer use, read landing/map/voice/taste code, and converged. Sections 5–9 above are rewritten to these decisions. Implementers should treat this subsection as the executive order.

#### Shared verdict
The draft’s acquisition diagnosis is right. The codebase is further along than the first draft admitted: L19 flag plumbing, honest stats, mature `mapPriceLegend`, and a real `FirstRunTour` already exist. Cold users bounce because **hierarchy and composition** undersell the map, and because **three first-map overlays compete** instead of teaching band colours once.

#### Locked decisions (no further debate needed to start PR1)

1. **CTA:** Open the map = default primary. Find my pint + Plan = text secondaries. Flag-on stays Find-my-pint experiment. Update L19; do not invert flag semantics.
2. **Copy:** Desire then honesty. Steal footer pitch rhythm. VOICE fences absolute.
3. **Hero visual:** Hybrid ThamesHero — keep DrinkGlyph, map-ground, decorative band rims. Fix illustrative £ honesty in caption + accessible names. No live map embed.
4. **Mobile:** Product frame in first viewport is an acceptance gate (measured fail today at ~y 772/844).
5. **Map orientation:** Consolidate FirstRunTour + one-shot MapPriceControl/MapKey; defer curated onboarding; respect analytics prompt budget. No new modal. Camera nudge deferred.
6. **Freshness:** No hero date chip. Stricter Composer rule wins over Grok’s optional near-stats note.
7. **Palette:** Brand continuity. Escape cream/coral cluster by showing product, not recolouring.
8. **Cut from wave:** Today-tab softness, `/pubs` expansion, live hero MapLibre, fake social proof, palette reboot.
9. **Ship shape:** PR1 = W1+W2+tests+proof. PR2 = W3+W6. Fix `e2e/mobile-landing-entry.spec.ts` in PR1.
10. **Taste bar unchanged:** Brand first, one composition, one primary CTA, show the product, jokes off figures/dates/sources.

#### Tension resolved
| Topic | Grok | Composer | Joint |
|---|---|---|---|
| Hero freshness note | Optional collected-month near stats | None on hero; footer/about only | **None on hero** |
| Camera nudge | Allowed, deferred, intent-safe | Defer; high regression risk | **Defer to after PR2 legend** |
| W2 naming | "Hybrid" | "Evolve option 1" | **Hybrid evolve** (same artefact) |

#### Evidence
- Grok live shots: `/opt/cursor/artifacts/screenshots/grok-review/`
- Composer live shots: `/opt/cursor/artifacts/screenshots/composer-review/`
- Prior acquisition walk: `/opt/cursor/artifacts/screenshots/` (landing/map/plan set)

#### Implementation file list (PR1)
- `components/landing/LandingPage.tsx`
- `components/landing/landing.css`
- `components/landing/ThamesHero.tsx`
- `__tests__/landingFindMyPintHierarchy.test.ts`
- `__tests__/landingPriceHonesty.test.ts`
- `__tests__/landingChromeCss.test.ts` (as needed)
- `e2e/mobile-landing-entry.spec.ts`
- Proof: `docs/proof/landing-acquisition-wave/` (mirror design-taste-wave-1 pattern)

#### Implementation file list (PR2)
- `components/onboarding/FirstRunTour.tsx` (+ css); bump storage key if steps change enough
- `lib/firstRunTour.ts`
- `components/map/MapPriceControl.tsx` / mobile key host
- `MapOnboardingOverlay` dismiss-key alignment
- `lib/analyticsEvents.ts` + funnel docs

---

## 11. Out of scope reminders

Do not touch AuthProvider token-fragment paths, RLS policy shape, community price corroboration thresholds, pin collision constants, or Pint Index archive rules in this wave. Do not add a third first-map modal. Do not invent user counts, testimonials, or "real-time" freshness.
