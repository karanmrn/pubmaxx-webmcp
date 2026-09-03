# Night-crawl mid-crawl surface - three prototypes (U7)

Probe for **U7** in [`docs/UNKNOWNS_MAP_2026-07-21.md`](../../UNKNOWNS_MAP_2026-07-21.md):
the night-of context is hostile and undesigned-for. Per the method note ("prototype
for unknown knowns"), this is three throwaway HTML mockups of the mid-crawl surface,
compared by eye, with a recommendation. Design exploration only. No product code, no
routes, no components touched.

## The scenario every mockup is drawn against

User is **at stop 2 of 3**. Outdoors, dark, cold hands, **15% battery**, weak
signal (basement / street), three-plus pints in, one thumb. The screen has to answer,
at a glance and without precision:

1. Where next, and how far.
2. Who is where (crew ahead / with you / lagging).
3. One tap: "we are here" (arrive) or "skip this one".
4. Get-home escape hatch, always visible.

House constraints honoured in all three: ink-dark OLED background (`--paper #070b0a`),
coral accent (`--brass #ff5a5f`), pint-neon green (`--pint #3dff9a`) for done/positive,
amber (`--amber #f0a01a`) for the battery caution, brick-coral (`--brick #ff6b7a`) for
skip. The Bungee display face is **quarantined**, so display type is mimicked with a
letter-spaced, uppercase system stack. Every target is well above 44px (heroes and
action slabs are 62-76px+). All three are fully self-contained: inline CSS, fake data,
inline SVG only, **zero external requests** (verified by grep for `http`).

## The three directions

### Option A - Card stack glance screen ([`option-a.html`](./option-a.html))
A single vertical stack ranked by urgency. The finished stop shrinks to a quiet
done-row (green tick, greyed), the **next stop owns the middle of the screen** as a
hero card (venue name huge, distance in mono, crew "who is where" chips inside it), and
the two actions sit as a 76px pair at the card's foot. Get-home is a persistent 64px
bar pinned last, so it is always the final thing the thumb finds.

- **Strengths:** familiar list mental model; carries full context (done + next + crew)
  without a mode; honest hierarchy - what matters is biggest. Cheapest to extend to
  4-8 stops (the done-rows just stack).
- **Weaknesses:** two similarly-weighted action buttons ask for a (small) target
  decision; densest of the three, so the most reading for a drunk glance.

### Option B - One giant action ([`option-b.html`](./option-b.html))
Radically reduced. The **entire screen is the arrive button** - a coral slab showing
the venue you are walking to, the distance, a crew ribbon, and a giant "tap when here".
Everything you need to *know* lives in a tiny top bar (crawl + 3 dots); everything you
can *do* is the slab plus two 68px rails (skip / get-home) underneath.

- **Strengths:** the most drunk-proof and cold-hand-proof - one dominant target, no
  scanning, hardest to misfire. Reads correctly at arm's length and in one blink.
- **Weaknesses:** thinnest on spatial context (no "how far along am I", no map); the
  crew ribbon and distance are display-only, so "who is where" is a glance not a drill.
  The full-bleed coral is a lot of lit pixels on a 15% battery.

### Option C - Map strip hybrid ([`option-c.html`](./option-c.html))
Top ~46% is a stylised dark route map (CSS + inline SVG, no tiles): the done leg drawn
in pint-green, the next leg in dashed coral, a glowing "you are here" marker, three
labelled pins, and crew mini-avatars sitting on the route. The bottom control deck
repeats the next-stop name, distance, crew chips, the two actions, and get-home.

- **Strengths:** answers "where next / how far / who is where" **spatially** in one
  look - the single most information-dense glance, and the truest to PUBMAXX's
  map-first north star. Best for a crew spread across a few streets.
- **Weaknesses:** the map is the least legible element on a weak-signal, cold-glass,
  three-pints night (it wants focus the context denies); more surface to render/repaint
  on a dying battery; and it duplicates the next-stop info in two places (map + deck).

## Comparison against the U7 constraints

| Constraint | A - Card stack | B - Giant action | C - Map strip |
|---|---|---|---|
| Glanceable "where next" | Strong (hero) | **Strongest** (is the screen) | Strong (deck + pin) |
| "How far" | Clear (mono) | Clear (in slab) | Clear (deck pill) |
| "Who is where" | **Good** (chips) | Weak (ribbon, static) | **Best** (pins on route) |
| One-tap arrive / skip | Good (76px pair) | **Best** (giant + rail) | Good (weighted pair) |
| Get-home always visible | Yes (pinned 64px) | Yes (rail) | Yes (62px) |
| Cold-hands / drunk targeting | Good | **Best** | Good |
| Battery frugality (OLED) | **Best** (mostly black) | Weakest (coral bleed) | Weak (map lit) |
| Weak-signal resilience | **Best** (no map) | Best (no map) | Weakest (map) |
| Scales to 8 stops | **Best** | Weak (one at a time) | Medium |
| On-brand (map-first) | Medium | Low | **Highest** |

## Recommendation: **ship Option A, steal Option B's arrive slab**

Option A is the one to spec, for three reasons the hostile context makes decisive:

1. **It survives the battery and the signal.** A is almost entirely black pixels with
   one coral hero - cheapest to light on a 15% OLED - and it carries zero map, so it
   never waits on a tile or a fix in a basement. C's map is the prettiest and the most
   on-brand, but it is exactly the element that fails when the night is at its most
   hostile, and it is the most expensive to render. Design for the 15% moment, not the
   showroom.
2. **It holds all the context without a mode.** A shows done + next + crew in one
   honest, urgency-ranked stack, and it is the only direction that extends cleanly to
   the real `PLAN_STOP_MAX` of 8 (done stops just stack and shrink). B is beautifully
   drunk-proof but too thin on "who is where" and "how far along the night am I"; C is
   information-rich but splits the same fact across map and deck.
3. **It loses little to B and can borrow B's best move.** A's only real weakness versus
   B is the two-similar-buttons decision. The fix is to steal B's idea directly:
   make the **arrive action the dominant slab** and demote skip to a smaller secondary
   (as Option C already weights them 1.5 : 1). That gives A the one-giant-target
   drunk-proofing without giving up A's context and battery wins.

**So: Option A as the skeleton, with B's weighted single-arrive-slab grafted on.** Fold
C's map in later as an *optional* expand ("show on map"), never the default surface, so
the map-first brand promise is kept for the calm moments and dropped for the 15% ones.

### Open questions to settle before spec
- **Arrive = whole-crew check-in or just me?** All three copy it as "checks the crew
  into stop 2" - that is a `plan.ts` action-model question (host vs guest), not a visual
  one, and it changes what the button promises.
- **Screen-off resilience** (a live-activity / lock-screen widget for next-stop +
  arrive) is named in U7 but out of scope for a static mock; flag it for the spec.
- **Skip confirmation.** Skip is destructive-ish (`type: "skipped"` in `plan.ts`); on a
  drunk thumb it may want a hold-to-confirm rather than a single tap.
