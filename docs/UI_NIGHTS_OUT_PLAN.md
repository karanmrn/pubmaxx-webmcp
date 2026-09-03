# PubMax UI Plan — Nights Out with Friends

**Audience:** PubMax owner (Karan)  
**Branch context:** `cursor/design-skills-plan-fdb7`  
**Sources:** [DESIGN_SKILLS_CATALOG.md](./DESIGN_SKILLS_CATALOG.md), [design-explorations/README.md](./design-explorations/README.md), [.firecrawl/design-skills/PUBMAX-DESIGN-SKILLS-REPORT.md](../.firecrawl/design-skills/PUBMAX-DESIGN-SKILLS-REPORT.md), live product (map planner + Rounds)

---

## North star

Every user can open PubMax, see a beautiful map, and plan a day or night out with friends in one clear flow — Plan → Stops → Invite — without leaving the map or hunting for a disconnected Round.

---

## Skills stack (what we installed and how we use each site/repo)

Skills live under `/workspace/skills/` (committed). Do **not** load Impeccable together with Anthropic’s generic `frontend-design` skill (vocabulary collision). Prefer **product register** for the map planner; **brand register** for marketing/landing.

### 1. Impeccable ([impeccable.style](https://impeccable.style))

**What it is**  
Agent design skill + CLI + anti-slop detector. Shared craft vocabulary for humans and agents: `/impeccable` with ~23 commands (`init`, `shape`, `craft`, `critique`, `audit`, `polish`, `colorize`, `typeset`, `harden`, `live`, …), `PRODUCT.md` / `DESIGN.md` context files, and deterministic detectors (46 rules). Repo: [pbakaus/impeccable](https://github.com/pbakaus/impeccable). Local path: `skills/impeccable/`.

**What it looks like in practice for PubMax**

- `/impeccable init` → write **product-register** `PRODUCT.md` + `DESIGN.md` for the planner (social UK night-out energy; anti-refs: purple glow, cream DTC default, Inter-only, nested map+list cards).
- `colorize` / `typeset` / `layout` against the chosen direction mockup before tokenizing into `app/globals.css` + `app/theme.css`.
- Pre-ship gauntlet: `audit` → `clarify` → `harden` on long pub names, emoji friend handles, empty neighbourhoods, map tile failures.
- Live Mode for iterating pin popovers and the Plan sheet without a full redesign.
- Optional local hooks: `npx impeccable install --providers=cursor --scope=project` (`.cursor/` is gitignored; re-run on fresh machines). Detector scripts: `skills/impeccable/scripts/`.

**When to invoke**

- Starting any design/redesign wave (`init` / `document`).
- Before shipping UI (`audit` + `polish` + `harden`).
- When palette, type, or hierarchy drift (`colorize` / `typeset` / `critique`).
- Not as the first step for product-object confusion — Layers first.

---

### 2. Taste Skill ([tasteskill.dev](https://www.tasteskill.dev))

**What it is**  
Open-source visual anti-slop framework: dials, locks, hero discipline, ban lists, redesign protocol. Primary skill: `design-taste-frontend` (`skills/design-taste-frontend/`). Companion: `redesign-existing-projects` for audit-first restyles that preserve routes/nav. Repo: [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill).

**What it looks like in practice for PubMax**

| Dial | Planner (map) | Landing / Discover |
|------|---------------|--------------------|
| `DESIGN_VARIANCE` | ~5 — asymmetry via map + side sheet, not collage | ~7–8 — brand-led heroes |
| `MOTION_INTENSITY` | ~4–5 — pin pulse, route draw, CTA hover | ~5–6 — presence, not cinematic scroll jacking |
| `VISUAL_DENSITY` | ~6 — stops + friends visible without dashboard clutter | ~4 — airier marketing |

**Locks:** one accent system per theme; one radius language; no mid-composition light/dark flip.  
**Hero bans applied:** no stats strips, no 3 equal feature cards, no floating promo badges on the map.

**When to invoke**

- Landing (`app/page.tsx`), Discover (`app/discover/`), and any marketing surface polish.
- Pixel critique of mockups vs live chrome (pre-flight checklist before ship).
- Redesign of existing screens — load `redesign-existing-projects`, preserve map/crawls/rounds routes.
- Soft / minimalist / brutalist variants only if intentionally scoped (brutalist fits admin, not friend planning).

---

### 3. Layers ([layers.jamiemill.com](https://layers.jamiemill.com))

**What it is**  
Product-design depth pack — decisions, not pixels. Seven layers + orient + intro. Skills don’t “generate UI”; they force correct objects, jobs, and flows. Repo: [jamiemill/layers-skills](https://github.com/jamiemill/layers-skills). Paths: `skills/layers-intro/`, `layers-orient/`, `layers-domain/`, `layers-conceptual-model/`, `layers-interaction-flow/`, `layers-surface/`, etc. Pack note: `skills/layers-SOURCE.md`.

**What it looks like in practice for PubMax**

- Settle ubiquitous language: **Plan / Stop / Venue / Friend / Route** (see Conceptual model).
- Breadboard: Plan on map → add Stops → Invite Friends → optionally mint/join a **Round** from the same Plan drawer or member-only Plan route.
- Surface audit: same Venue in pin, list row, and detail; no shapeshifter cards; empty/error edges designed.
- Orient when stuck: which layer is the real bottleneck (usually conceptual model or interaction flow, not color).

**When to invoke**

- **First** on any “nights out with friends” feature work (`/layers-orient` or jump to conceptual model + interaction flow).
- Before renaming UI chrome or inventing a fifth synonym for “crawl/trip/itinerary”.
- When map, Discover, Crawls, and Rounds disagree about what an object is.
- Never as a substitute for Taste/Impeccable when the model is already clear and only craft remains.

---

### 4. Refactoring UI plugin ([gnurio/refactoring-ui-plugin](https://github.com/gnurio/refactoring-ui-plugin))

**What it is**  
Atomic UI craft skills from Refactoring UI principles: hierarchy, typography, color palette, spacing, buttons, clutter, empty states, shadows, contrast, grouping. Meta entry: `skills/gnurio-refactoring-ui-plugin/skills/meta-refactor-ui/`. Local path: `skills/gnurio-refactoring-ui-plugin/`.

**What it looks like in practice for PubMax**

- Targeted passes: louder **Plan tonight** CTA hierarchy; declutter map chrome; stop-list grouping; empty “no pubs nearby” / “invite a friend”.
- Color palette skill aligns with directions A/B/C: neutrals ramp + one primary + semantic accents (pint / brick / river) that don’t steal the primary job.
- Use for surgical fixes inside a phase — not for inventing product strategy.

**When to invoke**

- Mid-implementation visual bugs (“CTA too quiet”, “sheet too busy”, “contrast fail on coral-on-paper”).
- After Impeccable `critique` flags a specific atom.
- Empty-state and button hierarchy hardening in Phase 6.

---

### 5. Emil Kowalski skills ([emilkowalski/skills](https://github.com/emilkowalski/skills))

**What it is**  
Motion and design-engineering craft: `emil-design-eng`, `apple-design` (fluid physical motion), `animation-vocabulary`, `review-animations`. Also mirrored under `skills/emilkowalski-skills/`.

**What it looks like in practice for PubMax**

- **Route draw** when stops lock into a Plan (polyline teaches order).
- **Sheet** open/close and stop reorder — ease-out, no bounce/elastic; respect `prefers-reduced-motion`.
- **Invite / RSVP** presence: friend joins, avatar stack updates — motion that confirms social state.
- Review pass before ship: name the effect (`animation-vocabulary`), then `review-animations` against a high craft bar.

**When to invoke**

- Phase 5 motion craft (after hierarchy and color exist — motion on slop amplifies slop).
- Any new micro-interaction on map pins, planner drawer, Round live page.
- Not for first-pass layout or color direction selection.

---

### Suggested load order (recap)

```
Layers (model + flow) → Impeccable (init / product register) → Taste dials (pixels)
  → Refactoring UI (atoms) → Emil (motion) → Impeccable audit/polish/harden (ship)
```

---

## Color directions (desktop mockups)

Static comps (~1440×900) in [`docs/design-explorations/`](./design-explorations/) — same composition, three palettes. Open [`index.html`](./design-explorations/index.html) to compare.

| Direction | File | Thesis |
|-----------|------|--------|
| **A — Candle Coral** | `direction-a-candle-coral.html` | Refine current warm paper + coral: coral owns CTA, active pin, selected stop |
| **B — Night Out** | `direction-b-night-out.html` | Deep ink nightlife; amber route + neon-pint pins — energy without purple glow |
| **C — Field Guide** | `direction-c-field-guide.html` | River blue + pint green + brass amber as a colorful, role-bound guidebook system |

**Shared composition (held constant):** brand (`PUBMAXXING`) → full-bleed map → **Plan tonight** CTA → stop sheet + friends. One composition, not a dashboard.

**Today’s live system** (`docs/DESIGN_SYSTEM.md`, `app/globals.css` / `theme.css`) already leans Field Guide–adjacent (paper, brass accent, river/pint/brick semantics) with a dark theme override. Direction A is a refinement of warm paper with a louder coral primary; B is a committed nightlife dark; C is the fullest multi-hue semantic system.

### Decision process (pick before pixel work on the live app)

1. Open the side-by-side comps; gut-check “PubMax at night with friends.”
2. Pick **one primary light (or default) theme**: A, B, or C — do **not** blend A’s coral paper + B’s neon + C’s river into one theme.
3. Optionally keep **Night Out (B)** as a **theme toggle** for “tonight mode” if the primary is A or C (Taste page-theme lock: one theme at a time; toggle is fine, mid-page flip is not).
4. Run Impeccable `colorize` + Taste critique on the winner; then tokenize (Phase 3).
5. Hybrid rules only if explicit, e.g. “C semantics for price/heritage pins; A coral for primary CTA” — write the rule down in `DESIGN.md` before coding.

**Ask:** see [Immediate next decision](#immediate-next-decision-for-the-human).

---

## Conceptual model (Layers)

Unify vocabulary across map, Discover, crawls, and Rounds. Color differentiates **state and semantics** (selected stop, price band); it does not invent new objects.

```
Plan  ──contains──▶  Stop  ──references──▶  Venue
  │                    │
  │                    └── ordered on Route (walking sequence)
  └──includes──▶  Friend (invitees / attendees / Round participants)
```

| Object | Meaning | Surfaces today | Target language |
|--------|---------|----------------|-----------------|
| **Plan** | A night/day out being built or live (date, area, vibe, status: drafting → locked → live → done) | Map planner drawer, curated crawls, URL `pubs=` / `crawl=` | Always **Plan** in chrome (“Plan tonight”); avoid mixing trip/itinerary/session |
| **Stop** | Ordered visit slot (time window, venue ref, optional RSVP) | `builtIds` list in `PubMap.tsx` planner | **Stop** (not “leg”); numbered 1…n |
| **Venue** | Place identity (pub/bar) — same object in pin, row, detail | Map pins, list, landmark cards | **Venue** / **pub** on pin; never a shapeshifter “card that is sometimes a plan” |
| **Friend** | Person on the Plan (invite / going / maybe / out) | Sparse on map; stronger on Round live page | **Friend** + Invite; Round participants = Friends on a shared Plan |
| **Route** | Walking sequence / polyline between Stops | MapLibre route line | **Route** — drawn when ≥2 stops; teaches order |

**Plan and Round boundary:** Rounds are the social live layer for a Plan. Both Plan surfaces reuse the shared `RoundStarter`, so one handoff path feeds the Round model.

---

## Phased attack plan (technical, not calendar)

### Phase 0: Skills + DESIGN.md / PRODUCT.md via impeccable init

**Goal**  
Lock agent context so every later phase shares register, anti-refs, and vocabulary.

**Key files**

- `skills/` (already installed — catalog in `docs/DESIGN_SKILLS_CATALOG.md`)
- New/updated: `PRODUCT.md`, `DESIGN.md` (Impeccable init; Stitch-compatible DESIGN.md)
- Reference: `.firecrawl/design-skills/PUBMAX-DESIGN-SKILLS-REPORT.md`, `docs/DESIGN_SYSTEM.md`

**Success criteria**

- `PRODUCT.md` states nights-out-with-friends job, UK social voice, product vs brand register.
- `DESIGN.md` records chosen color direction (or “pending decision”), type pairing, density dials, ban list.
- Agents load Layers → Impeccable → Taste in that order for planner work.

**Skills to load:** `impeccable` (`init` / `document`); `layers-intro` (once).

---

### Phase 1: Conceptual model + Plan-with-friends bridge (Round from Plan drawer)

**Goal**  
Make “plan with friends” a first-class path from the map planner — Rounds no longer feel like a separate app.

**Key files**

- `components/PubMap.tsx` (planner drawer, `builtIds`, Plan CTA)
- `lib/rounds.ts`, `lib/roundsStore.ts`, `app/api/rounds/`
- `app/rounds/[code]/`, `app/crawls/page.tsx` (`RoundStarter`)
- `components/map/usePintDrops.ts` (already appends stops to an active Round — extend the inverse: Plan → Round)

**Success criteria**

- From Plan drawer with ≥1–2 stops: user can **Invite friends / Start a Round** without navigating to `/crawls` first.
- Vocabulary in UI copy: Plan, Stop, Venue, Friend (audit Discover/Crawls for conflicts).
- Round live page and map Plan show the same stop order when linked.
- Empty edges: no friends yet, Round create failure — designed, not silent.

**Skills to load:** `layers-conceptual-model`, `layers-interaction-flow`, `layers-domain`; Impeccable `shape` / `clarify` for copy.

---

### Phase 2: Desktop map chrome declutter + Plan tonight hierarchy (match mockups)

**Goal**  
First viewport reads as one composition: brand → map → Plan tonight → stops/friends. Match exploration hierarchy (not necessarily final color yet).

**Key files**

- `components/PubMap.tsx`, `components/PubMapCanvas.tsx`
- Map chrome CSS in `app/globals.css` (planner drawer, `plannerMapButton`, filters)
- City switcher / search chrome (`components/city/`, map header)

**Success criteria**

- Primary CTA **Plan tonight** (or equivalent) is the loudest action; secondary filters don’t compete.
- No card-grid dashboard in the first viewport; no floating badge overlays on the map hero.
- Stop sheet + friend avatars readable on desktop ~1440×900 without hunting.
- Mobile: planner still on-demand; hierarchy preserved (map-first).

**Skills to load:** Impeccable `layout` / `distill` / `critique`; Refactoring UI `01-establish-visual-hierarchy`, `06-eliminate-visual-clutter`, `05-design-button-hierarchy`; Taste product dials (density ~6).

---

### Phase 3: Color system tokenization (chosen direction)

**Goal**  
Ship one primary theme’s tokens into the live system; optional Night Out dark as theme toggle.

**Key files**

- `app/globals.css`, `app/theme.css`
- `docs/DESIGN_SYSTEM.md`
- `components/PubMapCanvas.tsx` (`readTokens()` — map consumes tokens, never a second palette)
- Mockups: `docs/design-explorations/direction-*.html`

**Success criteria**

- CSS variables match the chosen direction’s roles (primary accent, neutrals, semantic pint/brick/river).
- Map pins, route, CTA, and selected stop share the locked accent; semantics don’t steal primary.
- Dark theme either = Direction B or a coherent pair documented in `DESIGN.md`.
- Contrast: body ≥4.5:1; coral-on-paper / amber-on-ink audited.

**Skills to load:** Impeccable `colorize` + `audit`; Refactoring UI `03-build-color-palette`, `09-manage-color-contrast`; Taste locks (one accent).

---

### Phase 4: Discover + landing brand register polish (Taste)

**Goal**  
Marketing and Discover feel like the same brand as the planner — colorful, brand-first, not a different product.

**Key files**

- `app/page.tsx` (landing), `app/discover/` (`DiscoverPageClient.tsx`)
- Shared chrome / nav; OG imagery as needed
- Type wiring: `app/layout.tsx`

**Success criteria**

- Landing hero: brand + one promise + one CTA + full-bleed place atmosphere — no stats/schedules in the first viewport.
- Discover CTAs say **Plan tonight** and deep-link into the map Plan with clear intent.
- No three-equal feature-card grids; Taste pre-flight passes.
- Expressive type (no Inter/Roboto/Arial as display); committed accent from Phase 3.

**Skills to load:** `design-taste-frontend`, `redesign-existing-projects`; Impeccable **brand** register (`typeset`, `critique`); avoid Anthropic frontend-design skill.

---

### Phase 5: Motion craft (Emil) for route draw, sheet, invite

**Goal**  
Motion teaches the Plan: order, sheet state, friend presence — presence, not noise.

**Key files**

- Route polyline draw in map canvas / planner (`PubMapCanvas.tsx`, planner transitions)
- Plan drawer open/close + stop reorder (`PubMap.tsx` + CSS)
- Invite / Round presence (`app/rounds/[code]/`, avatar stack)

**Success criteria**

- ≥2–3 intentional motions: route draw, sheet, invite/RSVP feedback.
- Ease-out only; no bounce/elastic; `prefers-reduced-motion` respected.
- `review-animations` pass; motion dial stays ~4–5 on planner.

**Skills to load:** `emil-design-eng`, `apple-design`, `animation-vocabulary`, `review-animations`; Impeccable `animate` if useful.

---

### Phase 6: Empty/error harden + audit

**Goal**  
Real-world mess: closed pubs, empty boroughs, GPS denied, Round join fail, long names — designed and recoverable.

**Key files**

- Map error/empty paths in `PubMapCanvas.tsx` / `PubMap.tsx`
- Round API error UI; Discover empty states
- Refactoring UI empty-state patterns; Impeccable harden checklist

**Success criteria**

- Every primary affordance has empty + error + recover copy.
- Impeccable `audit` (a11y, responsive, anti-patterns) + `harden` + `polish` green enough to ship.
- Detector / Taste pre-flight clean on touched surfaces.
- No purple glow, nested cards, or dashboard chrome regressions.

**Skills to load:** Impeccable `audit` / `harden` / `polish` / `onboard`; Refactoring UI `07-design-empty-states`; `layers-surface` consistency check.

---

## Anti-goals

What we will **not** do:

- Purple-on-white / purple-to-indigo gradients, neon mesh, crypto-glow dark maps.
- Cream + terracotta “AI editorial” as the safe default look (Direction A must stay intentional candle + coral hierarchy, not beige mush).
- Broadsheet / hairline newspaper layouts; Inter/Geist/Space Grotesk as the display voice.
- Card dashboards in the hero or first map viewport; nested cards; floating promo badges / pills on map media.
- Blending all three palette directions into one theme without written hybrid rules.
- Loading Impeccable + Anthropic `frontend-design` together.
- Decorating before the conceptual model (pretty confusion is still confusion).
- Cinematic scroll-jacking motion on the map; bounce pins; layout-property animation.
- Treating Rounds, Crawls, and Plan as three unrelated products with three vocabularies.
- Shipping pixel polish on the live app **before** a color-direction decision (Phase 3 blocked on human pick).

---

## Immediate next decision for the human

**Pick a color direction before any Phase 2–3 pixel work on the live app:**

1. Open [`docs/design-explorations/index.html`](./design-explorations/index.html).
2. Choose **A (Candle Coral)**, **B (Night Out)**, or **C (Field Guide)** as the **primary** theme.
3. Optionally: keep **B as dark “Night Out” theme toggle** if primary is A or C.
4. Or state **hybrid rules** in one sentence (e.g. “C roles + A coral CTA”) — we will freeze that in `DESIGN.md`.

Until that decision lands, Phase 0–1 (skills context + Plan↔Round bridge + vocabulary) can proceed; tokenization and chrome color polish wait.
