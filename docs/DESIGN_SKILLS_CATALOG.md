# PubMax Design Skills Catalog

Agent skills under `/workspace/skills/` for Cursor. Skills + docs only — not app UI.

**How they fit together**

| Concern | Prefer |
|---------|--------|
| Product objects, flows, jobs | Layers |
| Craft direction, audit, anti-slop detector | Impeccable |
| Visual taste (landing / redesign pixels) | Taste (`design-taste-frontend`) |
| Motion / micro-interaction craft | Emil Kowalski skills |
| Atomic UI fixes (hierarchy, type, color…) | Refactoring UI plugin |

Do **not** load Impeccable together with Anthropic’s generic frontend-design skill (vocabulary collision). Prefer product register for the map planner; brand register for marketing.

---

## Installed / refreshed

### Impeccable

| Path | Source | When to use for PubMax |
|------|--------|------------------------|
| `skills/impeccable/` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) · [impeccable.style](https://impeccable.style) | Impeccable v4.0.4. Design / redesign / polish / audit / critique / harden / Live Mode. Run `/impeccable init` (product register for planner). Pre-ship: audit + clarify + harden. Detector scripts under `skills/impeccable/scripts/`. Local Cursor hooks: `npx impeccable install --providers=cursor --scope=project` (`.cursor/` is gitignored). |

### Layers (product design depth)

| Path | Source | When to use for PubMax |
|------|--------|------------------------|
| `skills/layers-intro/` | [jamiemill/layers-skills](https://github.com/jamiemill/layers-skills) · [layers.jamiemill.com](https://layers.jamiemill.com) | Load first — framework context. |
| `skills/layers-orient/` | same | Diagnostic: which layer is the bottleneck. |
| `skills/layers-observed-behaviour/` | same | Research → confidence-rated job stories. |
| `skills/layers-domain/` | same | Domain map / terminology (pub vs venue vs stop). |
| `skills/layers-user-needs/` | same | Prioritised needs/pains/desires. |
| `skills/layers-product-strategy/` | same | Opportunity Solution Tree / bets. |
| `skills/layers-conceptual-model/` | same | Objects/states: Plan, Stop, Venue, Friend, Area, Route. |
| `skills/layers-interaction-flow/` | same | Breadboard flows + empty/error edges. |
| `skills/layers-surface/` | same | Surface audit vs lower layers (map/list consistency). |

Install: `npx skills add jamiemill/layers-skills`. Pack note: `skills/layers-SOURCE.md`.

### Taste (visual anti-slop)

| Path | Source | When to use for PubMax |
|------|--------|------------------------|
| `skills/design-taste-frontend/` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) · [tasteskill.dev](https://www.tasteskill.dev) | Landing / marketing / pixel craft. Dials + bans + pre-flight. Verified = upstream on 2026-07-11 (no local forks). |
| `skills/redesign-existing-projects/` | same | Audit-first redesign of existing PubMax UI; preserve routes/nav. |

Install: `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`.

---

## Already present (pre-existing)

### Emil Kowalski — motion & design engineering

| Path | Source | When to use for PubMax |
|------|--------|------------------------|
| `skills/emil-design-eng/` | [emilkowalski/skills](https://github.com/emilkowalski/skills) | UI polish, component craft, invisible details. |
| `skills/apple-design/` | same | Fluid, physical motion patterns on the web. |
| `skills/animation-vocabulary/` | same | Name a motion effect from a vague description. |
| `skills/review-animations/` | same | Review motion code against a high craft bar. |
| `skills/emilkowalski-skills/` | same (vendored pack) | Full pack mirror, including newer `find-animation-opportunities`, `improve-animations`, `pick-ui-library`, and `prototype`. |

### Refactoring UI (atomic)

| Path | Source | When to use for PubMax |
|------|--------|------------------------|
| `skills/gnurio-refactoring-ui-plugin/` | [gnurio/refactoring-ui-plugin](https://github.com/gnurio/refactoring-ui-plugin) (Refactoring UI principles) | Targeted hierarchy / type / color / spacing / buttons / clutter / empty states / shadows / contrast / grouping. Meta: `skills/gnurio-refactoring-ui-plugin/skills/meta-refactor-ui/`. |

---

## Suggested PubMax workflow

1. `/layers-orient` (or jump to conceptual model + interaction flow for the map planner).
2. `/impeccable` with **product** register for app chrome; **brand** for marketing.
3. Taste dials for marketing heroes; denser dials for map/planner product UI.
4. Emil skills when shipping motion (pin popovers, timeline, friend RSVP).
5. Refactoring UI atoms for focused visual fixes; Impeccable `audit`/`polish` before ship.

---

## Install notes

- Repo commits skills under `skills/` (`.agents/` and `.cursor/` are gitignored).
- Impeccable CLI also writes local `.cursor/skills/impeccable` + `hooks.json`; re-run install on a fresh machine for hooks.
- This copy of Impeccable uses `skills/impeccable/...` script paths so agents work from the committed tree.
