# PUBMAXX — Vibe Layer Spec

_2026-07-19 · owner-grilled + two-fork adversarial panel (skeptic + differentiator), decisions locked. Lanes read this file first. Companion to docs/VOICE_AND_WORDING_SPEC_2026-07-18.md (which stays in force everywhere this spec does not explicitly carve out)._

## Owner decisions (locked, do not relitigate)

1. Register: **British sesh + select global hits**. Base is London drinking idiom; "get lit" is the sanctioned global hit.
2. Placement: **mood chips + concierge quick-asks + push copy ONLY**. Structural copy stays dry-Londoner per the voice spec.
3. Type: **trio stays** (Space Grotesk / Inter / JetBrains Mono). One accent face added: **Bungee** (next/font, Google). Quarantined.
4. **Safety amendment 2026-08-22:** use "Big one tonight" and "Live and loud" on public web and share surfaces. The older labels remain retired because they can promote harmful drinking and create store-review risk. This owner-requested MVP recovery work replaces the 2026-07-19 override.

## Doctrine: chips are the user's voice

Voice spec rule 3 ("no America", no hype) governs the APP speaking. A vibe chip is the USER declaring their night. That is the boundary that admits slang without amending the spec:

- The brand never opens cold in slang. Push copy may only echo a vibe the user picked ("You said big one — it's kicking off in Soho") or lead with facts and let register ride behind (see push lines below).
- No slang in headers, nav, empty states, /pint-index, /discover, or any data surface. Ever.
- Killed terms (cringe/aged, do not use anywhere): "turnt", "no cap", "fr", "bussin", "real ones".
- Safe register pool: on the lash, sesh, cheeky pint, big one, quiet one, get a round in, kicking off, date night, get lit.

## The chip set (7 — every chip answers from live data or does not ship)

| Chip label | Backed by | Concierge preset fired |
|---|---|---|
| Big one tonight | crawl planner + Pint Index cheap pours + `deal` rows + late closes | "Plan a big night near me: four stops, cheap pints, latest close last" |
| Live and loud | `music` rows tonight + lively night-signal bands | "Where's actually loud and alive tonight, live music first" |
| Quiet pint | calm night-calm bands + no-event pubs + heritage snugs | "Somewhere calm for a quiet pint, no quiz, no match" |
| Cheeky one after work | Pint Index nearest-cheapest + TfL get-home strip | "Cheapest decent pint within 10 minutes, and when's my last train" |
| Match on | `sport` fixtures | "Who's showing the match near me and what's a pint there" |
| Big brain energy | `quiz` rows tonight | "Find me a pub quiz tonight worth losing" |
| Date night | NHLE heritage facts + calm bands + weather table | "Impress-a-date pub: somewhere with a story, not somewhere with a DJ" |

Killed for honesty (no backing data): rooftop vibes, karaoke, bottomless brunch. The kill list is the moat: every shipped chip answers with receipts.

Mechanics: chips map onto the EXISTING `CONCIERGE_MOODS` model (`lib/concierge/rank.ts` — 11 grounded moods, regex triggers, kind-weighted ranking). No new ranking data. Zero-match nights show the honest quiet-night line, never filler.

## Surfaces

1. **Tonight vibe picker**: chip row above the kind facets in `app/tonight/TonightClient.tsx`. A chip press sets the matching kind/mood filter composition and is tracked (`tonight_vibe_select`, prop `vibe`). Deselectable. Does not replace the kind facets.
2. **/pal/chat quick-asks**: chips replace/extend `EXAMPLE_PROMPTS` (`components/pal/PalChat.tsx:258`); a press fires the preset question through the existing deterministic ask path.
3. **Share stamp** (smallest loop): vibe pick stamps the existing plan-card OG route (#413 lockup) with an accent-font headline ("BIG ONE TONIGHT") + crew tally when shared from a plan ("3 of the lot voted Big one tonight, 1 person voted Quiet pint"). One stamp layer, zero new infra.
4. **Push copy** (implementation deferred to PRD Lane B/VAPID; lines locked now, no exclamation marks):
   - "World Cup final at 8. Your local's showing it, the pint's £5.20, and the last tube home is 00:34. Sorted."
   - "Thursday. Legally close enough to the weekend for a cheeky one. Three pubs near you are pouring under a fiver."
   - "Big one or quiet one tonight. Either way it's 21 degrees till 9 and we know which gardens catch the sun."
   Facts carry Gen X, register carries Gen Z. Facts are retention, register is the open.

## Accent type: Bungee

- `next/font` Google import, `--font-party` token. Single 400 weight, caps-only usage.
- Usage constraint (verbatim from panel, binding): **2-4 words max, 20px+ only, letter-spaced caps; chips, vibe stamps, share headlines — never body, never navigation, never data.** ≤3 component families total.
- Share cards may use the Bungee Shade layered variant: brass shade under coral face on ink dark; ink on candle paper light.
- Rejected: Unbounded (crypto register), Archivo Black (redundant vs Space Grotesk 700), Shrikhand (wrong city).
- **Amended 2026-08-18: the seven vibe chips left this face, and the browser
  lane went with them.** Bungee draws cap-height glyphs only, so a sentence-case
  chip label still reached the reader as ALL CAPS. The chips now set
  `var(--font-display)` in sentence case; `components/vibe/vibeChips.css` owns
  that skin and the reason. With no consumer left, the `--font-party` token, its
  `next/font` loader and the /tonight and /pal route wrappers were deleted
  rather than left shipping a webfont nothing draws. Share cards keep the Bungee
  stamp and headline through the vendored TTF satori reads (`lib/ogBrand.tsx`),
  which no browser downloads. Re-adopting the face in the app means re-adding
  the loader deliberately, not just naming the token.

## Verification bar

- Chip → result honesty: each chip's preset returns only rows/venues its backing data actually supports; zero-data nights show the honest empty line. Hermetic tests at the mood/preset mapping seam.
- Voice containment: grep gate — killed terms appear nowhere; slang strings appear only in the chip/preset/push modules.
- Type containment: `--font-party` referenced by ≤3 component families; no body/nav/data usage. Since the 2026-08-18 amendment the fence holds it at zero references in app/components/lib.
- Both themes, 390x844 screenshots for Tonight picker + pal chips + share stamp.
- No em dashes in any product copy string.

## Out of scope

Energy/crowd-level data collection, karaoke/rooftop/brunch chips, voice-note input, amending VOICE_AND_WORDING_SPEC rules, any push SENDING work (Lane B owns transport).
