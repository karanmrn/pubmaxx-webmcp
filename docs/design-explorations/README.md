# PubMax color direction explorations

Static desktop mockups (~1440×900) that apply **three color directions to the same product composition**: map-first crawl planner with brand chrome, Plan CTA, stop list, and friends.

Open [`index.html`](./index.html) in a browser to compare directions side by side.

| File | Direction | One-line thesis |
|------|-----------|-----------------|
| [`direction-a-candle-coral.html`](./direction-a-candle-coral.html) | Candle Coral | Refine the current warm paper + coral into clearer hierarchy and a louder Plan CTA |
| [`direction-b-night-out.html`](./direction-b-night-out.html) | Night Out | Deep ink nightlife with amber / neon-pint accents — energy without purple glow |
| [`direction-c-field-guide.html`](./direction-c-field-guide.html) | Field Guide | River blue + pint green + brass amber as a colorful, structured guidebook system |

## Shared composition (held constant)

Every mockup is **one desktop composition**, not a dashboard collage:

1. **Brand** — `PUBMAXXING` as a hero-level mark in the top chrome  
2. **City + search** — London switcher and crawl search  
3. **Primary CTA** — `Plan tonight` (one clear action)  
4. **Map plane** — full-bleed simplified map with colored pins + route  
5. **Stop sheet** — 4-pub crawl list + friend avatars / Invite friends  

Hierarchy on purpose: brand → map (the product) → Plan CTA → stops/friends. No floating badge overlays on the map hero, no card grids in the first viewport.

---

## What each direction teaches

### A — Candle Coral (refined current)

**Scene:** Planning at a kitchen table under warm lamp light, phone propped beside a paper map.

- **Color strategy:** *Restrained → committed accent.* Candle-lit paper neutrals tinted toward coral (not beige-by-default cream). Coral (`#ff5a5f` family) owns hierarchy: CTA fill, active pin, selected stop.
- **Teaches:** Warmth can live in **accent + type + light**, not only in a sand body background. Stronger coral hierarchy makes “what do I do next?” obvious without adding chrome.
- **Risk if shipped raw:** Still close to warm-paper AI defaults — keep paper chroma intentional and coral contrast high.

### B — Night Out

**Scene:** Saturday 9pm outside the first pub; phone brightness fights street amber and window light.

- **Color strategy:** *Committed dark.* Deep ink base, high-contrast map chrome, amber route + neon pint pins. Explicitly **not** purple mesh / neon glow SaaS dark.
- **Teaches:** Nightlife energy comes from **contrast + one warm accent + one live green**, not from glow stacks. Dark mode can feel like a night out without looking like a crypto dashboard.
- **Risk if shipped raw:** Over-saturating pins; keep amber for route/CTA and pint-green for “cheap / go” semantics.

### C — Field Guide

**Scene:** Annotated guidebook page — river walks, stamped prices, brass margin notes — colorful but ordered.

- **Color strategy:** *Full palette* with named roles: **river** (heritage / water / info), **pint** (go / cheap / positive), **brass amber** (accent / mid-price / CTA). Cool off-white ground tinted toward river, not cream DTC.
- **Teaches:** Multi-hue systems work when each hue has a **job**. Playfulness comes from role color on pins/stops, structure from consistent chrome and typography.
- **Risk if shipped raw:** Treating every hue as decoration — then the map becomes confetti.

---

## Skill mapping

These comps are meant to be read through the design-skills stack researched in [`.firecrawl/design-skills/PUBMAX-DESIGN-SKILLS-REPORT.md`](../../.firecrawl/design-skills/PUBMAX-DESIGN-SKILLS-REPORT.md).

### Impeccable — `/impeccable colorize` (+ typeset / layout / critique)

| Direction | Colorize lesson |
|-----------|-----------------|
| A | Retune existing warm paper: deepen candle tint, concentrate coral on CTA + selection, lift ink contrast |
| B | Pick a physical night scene first; commit to ink base; amber + pint as accents; refuse purple glow |
| C | Build a 3-role semantic palette (river / pint / brass) with OKLCH-friendly ramps, not 5 random hexes |

Also relevant: `critique` for hierarchy (brand vs CTA vs map), `typeset` for display/body pairing (no Inter/Roboto/Arial as display), `audit` for contrast on coral-on-paper and amber-on-ink.

### Taste dials (`design-taste-frontend`)

Held across all three (product register, map shell):

| Dial | Setting | Why |
|------|---------|-----|
| `DESIGN_VARIANCE` | ~5 | Asymmetry via map + side sheet, not collage heroes |
| `MOTION_INTENSITY` | ~4–5 | Pin pulse, route draw, CTA hover — presence, not cinematic scroll |
| `VISUAL_DENSITY` | ~6 | Planner density: stops + friends visible without dashboard clutter |

**Locks:** one accent system per direction; one radius language; no mid-composition light/dark flip.

Anti-slop applied: no purple-on-white, no cream+terracotta default trio as the “safe” craft look, no floating promo badges on the map, no equal feature-card grids.

### Refactoring UI — build color palette

Each direction sketches the Refactoring UI shape:

- **Greys / neutrals** — paper↔ink or ink↔chrome ramps with enough steps for chrome, labels, muted copy  
- **Primary** — coral (A), amber (B), brass (C)  
- **Accents / semantics** — price/status hues (pint green, brick for expensive) without stealing the primary job  

Direction C is the clearest “full palette” example; A/B are restrained/committed with fewer competing hues.

### Layers — conceptual model (`Plan` / `Stop` / `Venue` / `Friend`)

The mockups keep the **same objects** so color can change without muddying the model:

```
Plan  ──contains──▶  Stop  ──references──▶  Venue
  │                    │
  └──includes──▶  Friend (invitees / attendees)
```

| Object | Visible in comps as |
|--------|---------------------|
| **Plan** | “Tonight · Borough crawl”, Plan tonight CTA, route on map |
| **Stop** | Ordered list items (1–4) with time + price stamp |
| **Venue** | Map pins + stop titles (The George, etc.) |
| **Friend** | Avatar stack + Invite friends |

Vocabulary stays singular: *Plan* (not “trip”/“itinerary” mixed), *Stop* (not “leg”), *Venue*/*pub* on the pin, *Friend* for people. Color differentiates **state and semantics** (selected stop, price band) — it does not invent new objects.

---

## How to use these

1. Open `index.html`, pick a direction gut-feel for “PubMax at night with friends.”  
2. Run Impeccable `colorize` / Taste critique against the winner before tokenizing into `app/globals.css`.  
3. Preserve the Layers objects when restyling — map chrome and sheet chrome should still read Plan / Stop / Venue / Friend.  
4. Prefer shipping **one** direction’s accent system; don’t blend A’s coral paper with B’s neon and C’s river in one theme.
