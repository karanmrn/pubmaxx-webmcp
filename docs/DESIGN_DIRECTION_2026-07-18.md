# PUBMAXX Design Direction — 2026-07-18

Author: Fable (design-direction study). Grounded in the #328 token system v2 (brass
price plaques, neutral dark elevation ladder, wash removal, role accents), the taste PR
wave (#307/#311/#328/#333–#335), and `DESIGN.md` / `docs/DESIGN_SYSTEM.md`. This is a
**PRD for the next implementation wave** — read the thesis, then execute the Top-8
lane-by-lane. Every delta names where it lives in our code, its effort, and its collision
risk against the ~44 open PRs.

Research: 8 live references studied via Firecrawl `branding` extraction (colours, type,
radii, button/shadow treatments) + the local `apple-design` skill as the physics baseline.
Firecrawl credits used this pass: ~18.

**Implementation status:** Wave 2 now implements D1-D8. Current acceptance
evidence lives in [`design-craft-d1-d8-evidence.md`](./design-craft-d1-d8-evidence.md);
the gap analysis below remains the dated baseline that defined the work.

---

## 1. The thesis (one paragraph)

**PUBMAXX is a London bar-mat you can plan a night on: warm candle paper by day, lit
street-glass by night, with the numbers stamped in like a till receipt.** Three forces
hold it together and none of them is decoration. *London pub warmth* is the surface —
peach candle paper, not SaaS white; a coral that reads like a pub sign, not a brand
gradient. *Data honesty* is the structure — every price is a physically-stamped brass
plaque with provenance, because the moat is real observed pints and the UI should look
like it costs something to earn a number. *Night energy* is the mode-flip — dark isn't a
dimmed light theme, it's a different room: deep ink, coral action, amber route light,
pint-neon reserved for "go". The craft bar is Apple's physics
(gesture-driven, interruptible, spring-settled) applied to one honest map and a stack of
sheets - **one action accent across themes, one signature gesture (the tilted price stamp), and
nothing on screen that a 9-to-5 leaving the office at 6pm can't turn into a cheap pint in
two taps.** We are not a dashboard, not a cream DTC brand, and not purple-glow dark.

---

## 2. Reference observations — what specifically earns the quality read

Studied across three lenses. Each note is a concrete, borrowable mechanic, not a vibe.

### Lens A — map / local / nightlife products

**Citymapper** (London-native; `#37AB2E` Go-green, `#407394` blue, `#B6241C` red;
Proxima Soft rounded; pill "Go" at 96px radius)
- **Colour *is* the transit line, not brand paint.** Green/blue/red are semantic wayfinding
  hues that map to real lines — the palette is legible *because* each hue has one job.
  This is exactly our `--pint`/`--river`/`--brick` role model, proven at London scale.
- **The primary action is a single fully-round green "Go" pill** — one verb, one shape,
  maximum tap confidence. No competing CTAs in the first viewport.
- Soft rounded grotesque (Proxima Soft) keeps a utilitarian transit app *friendly* — warmth
  from letterforms, not from illustration.

**DICE** (nightlife, ticket-native; near-pure `#000`/`#fff`; `Favorit` body + `Foggy`
display; **h1 = 106px**; pill buttons 20px)
- **The hero headline is enormous and confident** (106px) on a black/white ground — the
  type *is* the hero, event photography supplies the only colour. Restraint that reads
  as expensive because it trusts one big move.
- **Monochrome chrome + photographic colour**: the UI never competes with the artwork.
  Lesson for us: let venue/night imagery and the map carry colour; keep chrome quiet.
- Ticket-native dark: black is a *stage*, not a dimmed page.

**Resy** (reservations; `Beatrice` display + `GT America` body; h1 48px, **h2 12px**;
4px radius; blue primary + red link)
- **Display/body type split with a tiny uppercase label tier** (12px h2) — the small caps
  read as editorial stamps over the editorial serif-grotesque headline. This is our
  "caps-are-stamps" policy, done by a taste leader.
- **Crisp 4px radius** — restaurants read as precise/premium, not bubbly. Sharpness = taste.

**Airbnb** (`Cereal VF`; primary `#FF385C`; **16px radius**; restrained hero h1 28px)
- **One warm coral accent** (`#FF385C` — within a hair of our `#ff5a5f`) carries the whole
  brand against neutral. Validates our one-accent rule and the coral choice specifically.
- **Generous 16px radius + a restrained hero** — friendly and calm; the product photography,
  not the chrome, does the selling.

### Lens B — taste leaders (why they read as *crafted*)

**Linear** (dark `#08090A`; SF Pro Display headings + Inter body; **8px base grid, 2px
radius**; near-white pill primary with a **layered micro-shadow stack**)
- **The near-black is `#08090A`, not gray** — a specific, slightly-blue near-black. Precise
  neutrals are the whole dark-mode game; "charcoal" is the tell of a template.
- **Buttons carry a *stack* of micro-shadows** (`0 8px 2px`, `0 5px 2px`, `0 3px 2px`… at
  1–4% alpha) — depth from many faint layers, not one blurry drop. This is *the* crafted-
  button mechanic and it's cheap to copy.
- **2px radius on a strict 8px grid** — tight, engineered, deliberate. Discipline reads as
  competence.

**Vercel** (`Geist Sans` + `Geist Mono`; off-white `#FAFAFA` ground, `#171717` ink, one
blue; **h1 64px**; pill buttons)
- **A monospace in the core type system** (Geist Mono for code/technical) — a second
  texture for "machine truth". We already do this with JetBrains Mono for prices; Vercel
  proves it's a taste signal, not a dev-tool quirk.
- **Off-white `#FAFAFA`, never pure `#fff`** — even the "white" theme is tuned warm/soft.
- **Near-monochrome + one blue**: extreme colour restraint = extreme confidence.

**Family.co** (Inter + custom display; **h1 68px**; warm off-white button `#F6F4EF`;
32px pill radius)
- **Motion is the entire brand.** Family's reputation is built on spring-physics
  transitions and interruptible gestures (the app is the demo). Their web hero leans on a
  video because *the motion can't be shown in a static frame* — that's the bar.
- Warm off-white surfaces (`#F6F4EF`) even in a fintech context — warmth is a taste lever,
  not a category rule.

**Arc** (cream `#FFFCEC` ground; saturated blue `#2702C2`/`#3139FB`; `Marlin Soft SQ`
display + `ABC Oracle` body; 8px grid)
- **Warm cream paper + one saturated accent** — the closest structural cousin to our Candle
  Coral. Proves warm-paper-plus-vivid-accent is a premium, current combination, not DTC.
- Custom display face over a workhorse body — personality up top, legibility below. Our
  Space Grotesk / Inter split, validated.

### Lens C — Apple HIG (the physics baseline)

From the `apple-design` skill (Designing Fluid Interfaces, WWDC 2018):
- **Respond on pointer-*down*, not release** — feedback the instant a control is touched.
- **Interruptibility is the single most important principle** — every transition must be
  grabbable and reversible mid-flight; animate from the *current on-screen value*, never the
  target. CSS `transition`/`@keyframes` **cannot** do this — springs can.
- **Springs, two params**: damping ratio (overshoot) + response (speed). Ship `damping 1.0`
  (no bounce) by default; add bounce (~0.8) **only** when a gesture carried momentum
  (a flick, a sheet drag-release).
- **Velocity handoff + momentum projection** — a drag that ends must continue at the
  finger's exact velocity and settle where the throw was *going*. This is the seam between
  "fine" and "fluid".
- **Depth via translucency and a consistent elevation ladder**; motion decomposed into
  independent X/Y springs.

---

## 3. Gap analysis — where PUBMAXX still falls short of that bar

Ranked by user-perceived impact (persona: the 9-to-5 leaving the office who wants a cheap
good pint in two taps). "Have" reflects the #328 wave already merged/queued.

| # | Gap | Have today | Bar (proof) | Impact |
|---|---|---|---|---|
| G1 | **Motion is not physical.** Sheets, drawers, the venue inspector, route panel all run CSS `transition`/`@keyframes` — no spring library anywhere (`grep framer-motion/motion` = 0 hits). Sheets can't be grabbed mid-open, don't track the finger 1:1, don't hand off velocity. | CSS easing tokens (`--ease-drawer`, `--ease-spring`) | Apple: interruptible spring gestures; Family: motion *is* the brand | **Highest** — the venue sheet is the core interaction; it's where "AI slop" is felt |
| G2 | **The hero is timid.** Landing `--text-3xl` = 2.6rem (~42px). Peers ship 64–106px heroes (DICE 106, Family 68, Vercel 64, Citymapper 44). Our one big brand move is under-scaled. | 8-step type scale, but components keep literal sizes | DICE/Vercel/Family confident hero | **High** — first-touch confidence; SEO landing |
| G3 | **Type hierarchy is unenforced.** Scale exists but "existing components keep literal font-size values" — 35+ one-off sizes. Hierarchy outside prices is weak (the exact slop complaint in #328's diagnosis). | `--text-*` tokens defined, opt-in | Linear/Resy strict tiers | **High** |
| G4 | **Buttons are flat.** `.planBtn` uses a single `--shadow`. No layered micro-shadow depth; press feedback is scale-only. | `--press-scale`, one shadow | Linear's stacked micro-shadows | **Medium-High** — cheapest craft win per pixel |
| G5 | **Light "white" is pure `#ffffff`.** `--panel-raised` = `#ffffff`. Peers tune even white warm/soft (Vercel `#FAFAFA`, Family `#F6F4EF`, Arc `#FFFCEC`). Our raised cards break the candle warmth. | Warm `--paper`/`--panel`, pure-white raised | Vercel/Family/Arc off-white | **Medium** |
| G6 | **Pointer-down latency.** Feedback lives on `:active`/click, not verified on pointer-down across controls; no audit of the 300ms/transition-wait path on the map+sheet loop. | `:active` scale exists | Apple: respond on press | **Medium** |
| G7 | **No radius conviction.** Mixed 7/10/18px. Taste leaders commit — crisp (Linear 2px, Resy 4px) *or* soft-round (Airbnb 16px, Family 32px pill). We're in the mushy middle. | 4-step radius scale | Linear/Resy crisp vs Airbnb/Family soft | **Low-Medium** |
| G8 | **The signature stamp is under-deployed & inconsistent.** #328 shipped brass price *plaques* but the tilt/press signature isn't the consistent hero moment across map pins, venue sheet, feed, and recap; caps-are-stamps is documented but not audited. | `.ink-stamp*` utility, plaques in feed/borough | One confident signature (DICE's single big move) | **Medium** |

Dark mode is **no longer** a top gap — #328 already replaced the "muddy brown wash / flat
inverted light" with a true-neutral 4-step elevation ladder (paper `0a` → panel `14` →
raised `1c` → overlay `24`) and Apple-neutral shadows. The deltas below *extend* that
system; they do not redo it.

---

## 4. Top 8 implementable deltas (the PRD)

Each: **what · why (which reference proves it) · where in our code · effort · collision
risk**. Ordered for execution; lanes are non-colliding where possible.

### D1 — Spring-physics sheet & drawer engine *(the flagship)*
- **What:** Introduce one small spring primitive (adopt `motion`/Framer Motion, or a ~40-line
  `useSpring` on Pointer Events) and route the venue sheet, route panel, and bottom drawer
  through it: 1:1 finger tracking on drag, velocity handoff on release, momentum-projected
  snap points, fully interruptible (grab a closing sheet → it follows the finger). Default
  `damping 1.0`; bounce ~0.8 only on drag-release.
- **Why:** Apple — interruptibility is *the* principle; CSS transitions structurally can't do
  it. Family — motion is the brand. This is G1, the top slop signal.
- **Where:** `components/ui/sheet.tsx`, `components/map/VenueInspector.tsx`,
  `components/map/venueSheet.css`, `RoutePanel.tsx`. New `lib/useDragSheet.ts`. Gate behind
  `prefers-reduced-motion`.
- **Effort:** **L**
- **Collision:** **HIGH.** VenueSheet/PubMap surfaces are touched by #297/#304/#306/#309 and
  the recap set (#333–#335). Land the sheet primitive as a standalone `lib/` + `sheet.tsx`
  seam first (additive, no behaviour change), migrate surfaces one PR each *after* the map
  PRs merge. Do **not** open this against an unmerged PubMap.

### D2 — Enforce the type hierarchy (3-tier, real sizes)
- **What:** Apply `--text-*` tokens to the display/headline/title/body tiers app-wide, not
  opt-in. Bump the landing hero to `--text-3xl`≈3.2–3.5rem and add a `--text-4xl` for the
  single landing hero. Tighten tracking on Space Grotesk headlines per the caps policy.
- **Why:** Linear/Resy strict tiers; DICE/Vercel/Family confident hero. Fixes G2+G3, the
  named #328 slop diagnosis ("weak type hierarchy outside prices").
- **Where:** `app/globals.css` type scale + the landing hero (`app/page`/landing components),
  section titles across `components/`. Add `--text-4xl` token.
- **Effort:** **M**
- **Collision:** **MEDIUM.** `#311` (header consistency) and `#307` (feed slim) touch headings.
  Scope this to the landing hero + a shared heading utility class; coordinate with header-lane
  so the wordmark/H1 idiom is set once.

### D3 — Layered micro-shadow button depth
- **What:** Replace `.planBtn`'s single `--shadow` with a stacked micro-shadow token
  (`--shadow-btn`: 3–4 layers at 1–5% alpha, e.g. `0 1px 1px, 0 2px 2px, 0 4px 4px, 0 8px 8px`).
  Add a pressed variant that collapses the stack on `:active` (the button physically sinks).
- **Why:** Linear's primary button — depth from many faint layers is the single cheapest
  "crafted" tell. Fixes G4.
- **Where:** `app/globals.css` (`.planBtn`, new `--shadow-btn`/`--shadow-btn-pressed` tokens),
  mirror in `app/theme.css` dark (black-based layers, per #328's neutral ladder).
- **Effort:** **S**
- **Collision:** **LOW-MEDIUM.** Token-only; `#328`/token-lane owns globals.css. Add as new
  tokens in the E-block append region to avoid diff overlap; announce to token-lane.

### D4 — Warm the "white": off-white raised surfaces
- **What:** Retune light `--panel-raised` from `#ffffff` to a candle-warm off-white
  (~`#fffdf9`) so raised cards stay in the paper's tonal family. Keep dark unchanged.
- **Why:** Vercel `#FAFAFA`, Family `#F6F4EF`, Arc `#FFFCEC` — taste leaders never ship pure
  white. Fixes G5, reinforces "candle not cream/white".
- **Where:** `app/globals.css` `--panel-raised` (one value). Verify contrast on
  `--ink`/plaques holds (it will — delta is tiny).
- **Effort:** **S**
- **Collision:** **LOW.** One token value; coordinate with token-lane; run the a11y contrast
  matrix (#339) after.

### D5 — Pointer-down response audit on the core loop
- **What:** Guarantee every control on the open→answer loop (Near-me chip, map pins, plan
  CTA, sheet handles) paints feedback on `pointerdown`, not click/`:active`-after-delay.
  Remove any tap-delay/transition-wait on the input path. Add `touch-action`/`:active`
  press-scale where missing.
- **Why:** Apple — respond on press or directness "falls off a cliff". Fixes G6; directly
  serves the two-tap persona.
- **Where:** map pin handlers in `components/PubMap.tsx`/`PubMapCanvas.tsx`, Near-me
  (`#309`), `.planBtn`, sheet handles. Audit, then targeted fixes.
- **Effort:** **M**
- **Collision:** **HIGH** on PubMap (same hot file as D1). Do the non-map controls (CTA,
  chips, sheet handles) now; fold map-pin response into D1's post-merge sheet migration.

### D6 — Commit the radius (crisp precision register)
- **What:** Pick a lane and hold it: tighten default `--radius` 10px→8px and `--radius-sm`
  7px→6px for the "engineered/honest-data" read, keep `--radius-lg` 18px for sheets and
  `--radius-pill` for Plan CTAs. One decision, documented.
- **Why:** Resy 4px / Linear 2px precision vs the mushy middle; Citymapper/Airbnb prove the
  soft-pill lane works *when committed*. Fixes G7. (We keep pills for CTAs → the Citymapper
  "Go" confidence; crisp elsewhere → the Resy/Linear precision.)
- **Where:** `app/globals.css` radius tokens; visual regression on cards/inputs/chips.
- **Effort:** **S**
- **Collision:** **LOW.** Token values; broad visual reach → land when the token-lane/#328
  migration is quiet to avoid churny diffs against every card.

### D7 — Make the price stamp the *consistent* signature
- **What:** Audit every price surface (map pins, venue sheet, feed cards, borough, recap
  card/page) so the brass plaque + `ink-stamp--tilt` reads identically everywhere, and the
  tilt appears on the **price only** (never a second element). Enforce caps-are-stamps
  (sentence case everywhere else). One memorable move, everywhere it belongs.
- **Why:** DICE — one confident, repeated signal reads as expensive; our own DESIGN_SYSTEM
  "one signature, held with restraint". Fixes G8, ties the #328 plaque work off.
- **Where:** `PriceBadge.tsx`, `app/feed/feed.css`, `app/borough/[slug]/borough.css`,
  recap card/page (#333/#335), `PubMapCanvas` price labels. Consistency pass + a shared
  `PricePlaque` component if drift is bad.
- **Effort:** **M**
- **Collision:** **MEDIUM.** Recap set (#333–#335) and feed (#307) own some surfaces; do the
  shared component + non-recap surfaces now, recap surfaces after that set merges.

### D8 — Sheet depth via translucent material (dark-first)
- **What:** Give the elevated sheet/overlay a thin translucent material over the map (a
  restrained `backdrop-filter: blur()` + the `--panel-overlay` neutral, per the existing
  narrow glass exception) so sheets read as *lifted glass over the night street*, not a flat
  card — reinforcing the 4-step elevation ladder #328 built.
- **Why:** Apple — depth via translucency + consistent elevation ladder; DICE dark-as-stage.
  Extends #328's overlay step (`--panel-overlay` `#242427`) into a felt material.
- **Where:** `app/theme.css` (dark overlay), `components/ui/sheet.tsx`, `venueSheet.css`.
  Stay inside the documented "functional glass on floating chrome" exception — no decorative
  glass elsewhere.
- **Effort:** **M**
- **Collision:** **MEDIUM.** Pairs naturally with D1 on the same sheet files; sequence D8
  *with* D1's migration, not before.

**Suggested execution order:** D3 → D4 → D6 (token-only S/S/S, land while token-lane quiet)
→ D2 (type) → D7 (stamp consistency) → D5 (non-map response) → **D1 → D8** (the sheet
flagship, after the map PR queue drains). D1 is the highest-impact and highest-risk; its
seam (`lib/useDragSheet.ts` + `sheet.tsx`) can land additively today, migrations follow.

---

## 5. Non-goals — what we deliberately will NOT copy

- **DICE/Vercel monochrome.** Their black/white restraint suits ticketing/dev-tools; our
  warmth (candle paper, pub coral) *is* the brand. We borrow the *confidence* (one big move,
  quiet chrome), not the greyscale.
- **Arc's saturated blue / any second brand accent.** Coral is the one branded
  action accent in both themes; amber stays semantic. `pint`/`river`/`brick`/`cat-*`
  stay semantic. No new hero hue.
- **Airbnb/Family soft 16–32px radius *everywhere*.** We keep pills for CTAs only; the rest
  commits to crisp (D6). No universal bubbly rounding.
- **Marketing-illustration warmth.** Warmth comes from paper tone, letterforms, and the
  stamp — not 3D blobs, mascots, or hero illustration.
- **Any purple-glow / mesh-gradient dark, glassmorphism as decoration, or a second signature
  gesture.** #328's neutral ladder stands; glass is functional-only; the tilt is price-only.
- **A full motion-brand rebuild à la Family.** We add spring physics to the *sheets that
  already exist* (D1), not a motion showreel. Restraint over spectacle.
- **Redesign-the-world.** No layout rewrites — layouts live in #305/#307/#311. Every delta
  above is a token, a primitive, or a consistency pass that composes with the open queue.

---

## 6. Collision summary (composing with the ~44 open PRs)

| Hot surface | Owned by (open PRs) | Deltas that touch it | Rule |
|---|---|---|---|
| `PubMap.tsx` / `PubMapCanvas.tsx` | #297, #304, #306, #309 | D1, D5, D7 | Land seams additively; migrate map surfaces only after these merge |
| `app/globals.css` / `theme.css` tokens | #328, token-lane | D2, D3, D4, D6, D8 | New tokens in append-block; announce to token-lane; no in-place edits to their diff regions |
| Feed (`feed.css`) | #307 | D7 | Non-recap plaque pass now; coordinate headings |
| Header idiom | #311 | D2 | Set H1/wordmark once with header-lane |
| Recap set | #333, #334, #335 | D1, D7 | Recap surfaces last, after the set merges |
| Sheets (`sheet.tsx`, `venueSheet.css`) | (shared w/ map PRs) | D1, D8 | The flagship pair; sequence after map queue drains |

Token-only deltas (D3/D4/D6) are the safe first wave. The sheet flagship (D1/D8) is
gated on the map PR queue — highest impact, so worth the wait rather than a conflict-storm.
