# PRD: Map Color, Taste Skills & Fluidity (Wave J)

Date: 2026-07-09

## Problem Statement

Live UI at https://pubmaxx.vercel.app (desktop + mobile screenshots) shows a
credible product loop, but the map still reads as generic grey GIS: Liberty /
Positron basemap is muted, clusters look ink-black, Cost/Layers FABs are easy
to misread, and chrome stacks frosted glass with generic `0.22s` color
transitions. DESIGN_SYSTEM already defines brass / paper / pint–amber–brick;
the map underuses it.

## Solution

Ship **Wave J** from `origin/main`:

| ID | Deliverable |
| --- | --- |
| J0 | Install Taste + Emil skills into `skills/`; PRD + CURRENT_STATE pointer |
| J1 | Warm basemap paint overrides, colorful price/cluster pins, wire `mapColor.css`, clearer Cost/Layers copy |
| J2 | Skeleton handoff, ease-out motions, less map glass, tab-bar active-state consistency |
| J3 | Taste pass on landing + feed (+ discover display fonts) within DESIGN_SYSTEM |
| J4 | Re-screenshot, tests, draft PR |

## Skills (agent guidance, not runtime)

Committed under `skills/` (CLI installs to `.agents/skills/`, which stays gitignored):

- `design-taste-frontend` (VARIANCE=4, MOTION=5, DENSITY=5)
- `redesign-existing-projects`
- `emil-design-eng`, `review-animations`, `animation-vocabulary`, `apple-design`

Brand constraint: candle-lit field guide — no purple gradients, no cream+terracotta AI default.

## Built And Should Not Be Rebuilt

- #63 Layers FAB + Outer London P0; Wave H Outer London P1; security Phases 1–4
- Slim-first map, `mapWarmup`, `prefetchVenue`, drink-glyph pins (`lib/mapIcons.ts`)
- DESIGN_SYSTEM tokens in `globals.css` / `theme.css`

## Acceptance

- Basemap land/park/water/road paints use DESIGN_SYSTEM token washes after style load
- Clusters use pint/amber/brick (or brass) fills by density — not black discs
- `mapColor.css` imported from a map-owned client component
- Cost FAB reads “Prices” / clear £ range; Layers keeps structure with clear aria
- Map/nav/sheet transitions use `--duration-base` + ease-out; less frosted stacking
- Mobile tab: outline icons; only current tab active; Drop primary without always-selected look
- Landing/feed hierarchy tightened within DESIGN_SYSTEM

## Out Of Scope

Layers rebuild; inventing `dominantCategory` for every venue; paid basemap swap;
heatmap; growing PubMapCanvas scene graph; Legacy T remount.

## Shipped

- **#76** — core Wave J (basemap taste, clusters, Prices/Layers FABs, skills, fluidity).
- **Follow-up polish (this branch):** retarget `mapColor.css` to Layers swatches;
  solid hover/log-intent panels (less frost); theme flip + landing CTA transitions
  on `--duration-base` / `--ease-out`; Prices FAB copy (no “Cost” wording).
