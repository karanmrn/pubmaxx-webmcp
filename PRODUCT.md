# Product

## Register

product

## Platform

web

## Users

Friends planning a night out in London — typically 2–6 people deciding where to go for pints tonight. They open PUBMAXX on a phone at a kitchen table or on the pavement outside the first stop, with one shared goal: lock a crawl that feels good, cheap enough, and easy to walk.

Primary job: turn “where shall we go?” into a concrete **Plan** of **Stops** at real **Venues**, with **Friends** invited and a **Route** they can follow.

## Product Purpose

PUBMAXX (PUBMAXXING) helps people discover pubs and plan pub crawls using pint prices, location, and venue context. Success is a group that leaves the app with a tonight plan they trust — ordered stops, prices they can see, and friends who know when to show up — not a saved wishlist of venues they never visit.

## Positioning

The nights-out-with-friends planner: a map-first crawl companion that makes “Plan tonight” the obvious next move, not another discovery feed.

## Vocabulary

Hold these objects singular and consistent across UI, docs, and map chrome:

| Term | Meaning | Avoid mixing with |
|------|---------|-------------------|
| **Plan** | Tonight’s crawl — the outing being built | trip, itinerary, journey |
| **Stop** | One ordered visit inside a Plan | leg, waypoint, step |
| **Venue** | The place a Stop references (pub / bar / restaurant-bar) | place, location (when the concept is the venue record) |
| **Friend** | Someone invited or attending the Plan | user, contact (in crawl UI copy) |
| **Route** | The path connecting Stops (walk / tube) | itinerary, journey |

Color differentiates **state and semantics** (selected stop, price band, heritage). It does not invent new objects.

## Brand Personality

Warm, decisive, local — like a friend who already knows the good pint streets. Confident without shouting; playful without becoming a party app. The product should feel like Saturday evening energy when dark, and candle-table planning when light.

## Color decision (locked)

Explored in `docs/design-explorations/`. **Ship A for light, B for dark — not a blend.**

- **Light default — Direction A Candle Coral:** warm paper with a candle/peach tint + coral primary CTA (`--brass` family). Hierarchy lives in coral on Plan actions and selection, not in sand-beige body alone.
- **Dark theme - Direction B Night Out:** deep ink paper + coral CTA + amber route energy + pint neon for go/cheap. Explicitly **no purple mesh or glow**.
- **Field Guide semantics retained:** `--river` / `--pint` / `--brick` keep their jobs for pins, prices, and heritage. Coral owns the primary CTA in both themes; amber remains a route and price signal.

Token source of truth: `app/globals.css` (light) and `app/theme.css` (dark). Visual detail: `DESIGN.md`.

## Taste dials

Product register (map shell, planner density) with brand-level accent moments on Plan CTAs and map selection:

| Dial | Setting | Why |
|------|---------|-----|
| `DESIGN_VARIANCE` | ~5 | Asymmetry via map + side sheet, not collage heroes |
| `MOTION_INTENSITY` | ~4–5 | Pin pulse, route draw, CTA hover — presence, not cinematic scroll |
| `VISUAL_DENSITY` | ~6 | Stops + friends visible without dashboard clutter |

Locks: one accent system per theme; one radius language; no mid-composition light/dark flip inside a single surface.

## Anti-references

What this must not look like:

- **Purple glow / mesh SaaS dark** — crypto dashboards, indigo nebula backgrounds, violet bloom behind cards
- **Cream DTC default** — warm `#F4F1EA`-ish paper + terracotta accent + high-contrast serif as the “safe craft” look
- **Card dashboards** — equal feature-card grids, stat strips, and chrome that reads as an admin console in the first viewport
- **Inter-as-display** — Inter (or Roboto / Arial / system) used as the hero/display face; Inter stays body only
- Floating promo badges, pill clusters, or sticker overlays on the map hero

## Design Principles

1. **Plan first.** Every primary surface answers “what are we doing tonight?” before it teaches heritage or settings.
2. **Map is the product.** Discovery lives on the map plane; sheets and drawers support the Plan, they don’t replace the map with a feed.
3. **One accent owns the CTA.** Coral in both themes - never compete with pint/river/brick for “what do I tap next?”
4. **Semantic color earns its job.** Pint = go/cheap, brick = dear/destructive, river = heritage/by-water. Don’t decorate with them.
5. **Friends are first-class.** Invitees and attendees appear where the Plan is decided, not buried in a separate social silo.

## Accessibility & Inclusion

Respect `prefers-reduced-motion` for ambient pulses and interface travel. Static
price-stamp tilt remains a shape, not an animation. Keep CTA and price-stamp
contrast readable on both candle paper and night ink. Do not rely on color alone
for price bands - pair hue with label or stamp pattern where space allows.
