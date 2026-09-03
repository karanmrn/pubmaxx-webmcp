# PUBMAXX — Voice & Wording Spec

_2026-07-18 · docs/voice-and-wording · a spec with the rewrites already written; the implementation lane just applies them._

Evidence: live text Firecrawl-scraped from pubmaxxing.com (`/`, `/map`, `/tonight`, `/feed`, `/crawls`, `/pubs`, `/pint-index`, `/discover`, `/pal`) on 2026-07-18, cross-checked against source strings in `components/landing`, `app/tonight`, `components/moment`, `components/auth`, `components/onboarding`, `components/map`, plus the guardian/nudge copy sitting on open PR branches. Credits used: **9** (one v2 scrape per page).

---

## 0. The problem in one line

PUBMAXX already owns some of the best consumer copy in London nightlife — `Saved. Still yours.`, `Time in hand — no rush yet.`, `handed down from the old hands who drank them first`, the feed lore (`Nan's shift, 1950s`), the reaction chips (`Cheers / Bargain / Chaos / Proper / Legendary`). That voice is **buried under a layer of engineering and marketing copy** that leaks the plumbing (`from our scrapes`, `the upstream`, `evidence gate`, `0 eligible public observations`) or reaches for SaaS uplift (`Make tonight worth remembering`, `side quests nearby`, `The city, with signal.`). The fix is not new voice. It is **promoting the voice we already have to every surface, and deleting the two registers that fight it.**

---

## A. The voice, defined

### The five rules

**1. Talk like a Londoner who knows the pub — not a brand that owns one.**
Dry, specific, understated. State the useful thing; skip the adjective in front of it. A regular says "cheap pints, five minutes' walk," never "unforgettable nights with your people." Kill hype words: _worth remembering, unexpected, grounded, seamless, curated, elevate, effortless._

**2. Never show the user the plumbing.**
The words `scrape`, `upstream`, `observation`, `evidence gate`, `snapshot contract`, `point-in-polygon`, `provenance`, `Night Area`, `Crawl Route`, `renderer` belong in code and on the one methodology page — nowhere a 6pm Londoner reads. Say what they _get_, in pub words. (One exception: `/pint-index` methodology is deliberately citable and technical — keep it, but give its empty state a human line.)

**3. No begging, no exclaiming, no America.**
Zero `!` in product copy (the tour's `DROP a pint` shouting excepted only if it's a stamp graphic). No `explore / discover / unlock`. No `side quest`, no `For You`. One confident line per screen — a Londoner doesn't oversell.

**4. Name the user's world and hand it to them.**
Their borough, their local, their crew, their round, their streak, their Thursday. Ownership verbs do the work: _yours, your usual, kept, still yours, on record._ Generic `the city` / `a plan` / `moments` become _your city / your night / your local's record._

**5. Reward the regular at every seam.**
Empty states, first-time moments, success moments, the morning after, the return visit — each earns a human line or a small in-joke, never a dead `No results` or a status token. This is where love is won or lost (Duolingo's streak, Monzo's tone, Citymapper's easter eggs all live in exactly these gaps).

### Ten word-pairs — say this, not that

| # | Say this | Not that | Where it bites |
|---|----------|----------|----------------|
| 1 | See the pubs | **Inspect pubs** | /discover (×20 buttons) |
| 2 | your local · your patch | **Night Area** | /discover, map |
| 3 | No price logged here yet — yours to set | **0 eligible public observations** | /pint-index empty |
| 4 | from pubs we've walked into | **119 pubs from our scrapes** | /pubs header |
| 5 | we only list what's really on | **we only show what the upstream actually returns** | /tonight empty |
| 6 | your night | **your Night Memory** | homepage, /moment |
| 7 | the good stuff nearby · what's on round the corner | **side quests nearby** · **Find the side quest** | homepage ×2 |
| 8 | How's it work? / Take a look | **How it works** / **Start exploring** | homepage, tour |
| 9 | Cheap pints near you, live | **The city, with signal.** | homepage §2 |
| 10 | The city's having a quiet one tonight | **thin nights stay thin** / **the upstream** | /tonight |

---

## B. The offender table

Every finding quoted from live copy (or source where the string is a hidden state). `→` is the exact rewrite to ship.

### Homepage `/`  · `components/landing/LandingPage.tsx`, `ThamesHero.tsx`, `PintDropStrip.tsx`

| Current (quoted) | Problem | Rewrite → |
|---|---|---|
| `Real prices, live plans and unexpected places—built for better nights with your people.` | SaaS uplift + em-dash glued with no spaces; "unexpected places / better nights with your people" is filler | `Real pint prices on a live map. Plan a crawl your mates will actually walk.` |
| `Side quests nearby` (highlight) / `Find the side quest` (step 01) | Gamer-American; not pub language | `What's on round the corner` / `Start with what's nearby` |
| `The city, with signal.` (§2 h2) | Abstract; a 6pm user can't decode it | `Cheap pints, live.` |
| `PUBMAXX clears away the listings noise and keeps the three things that change your decision.` | Corporate abstraction | `We keep the three things that actually decide your night: the price, what's on, and how you get there.` |
| `Prices you can trust` / `Observed prices carry dates and provenance, so a cheap pint never arrives as a vague promise.` | "provenance" jargon | Price-source wording is now owned by [`docs/VOICE.md`](./VOICE.md); never promise a publisher or day that the price record does not carry. |
| `A city that changes with you` / `Morning calm, after-work energy and late-night events appear when they are useful—not all at once.` | Vague; em-dash glued | `The city, by the hour` / `Morning calm, after-work buzz, late-night lock-ins — shown when they're useful, not all at once.` |
| `One route, every way there` | Cryptic | `One route, every way home` |
| `The map gets better when Pubmaxxers show up.` | Invented jargon "Pubmaxxers" | `The map gets sharper every time someone logs a pint.` |
| `Pint Drops keep prices fresh, Stories reveal the atmosphere, and every useful contribution carries its source.` | "carries its source" jargon | `Log a pint to keep prices honest. Tell its story to show what the room's like.` |
| `Your Night Memory stays private. When the crew is ready, turn approved moments into a Story worth reliving.` | Capitalised product nouns read as SaaS | `Your night stays private. When the crew's happy, turn the best bits into something worth keeping.` |
| `Turn a mood, budget or half-formed idea into a grounded plan—then confirm every change yourself.` | "grounded plan" corporate; over-reassuring | `Give it a mood and a budget, get three real stops back. You approve every one.` |
| `Your city is already happening.` (final CTA h2) | Vague aspiration | `Your night's out there. Go find it.` |
| `How it works` (nav CTA) | Generic SaaS | `How's it work?` |
| **Punctuation split:** `Make tonight worth remembering.` (LandingPage h1, with period) vs `Make tonight worth remembering` (layout.tsx metadata, no period) | Same line, inconsistent across files | Pick one. Ship `Make tonight worth remembering.` everywhere, or (preferred, per Rule 1) retire the hero aspiration for `Sort tonight. Cheap pints, real plans, home safe.` |

### Tour / first-run · `components/onboarding/FirstRunTour.tsx`  _(collides with PR 296)_

| Current | Problem | Rewrite → |
|---|---|---|
| `Log what you're drinking and share the story. It's the signature move.` | "the signature move" is the brand describing itself | `Log what you're drinking. That's the whole game — one pint at a time.` |
| `Start exploring` (final button) | Generic SaaS CTA | `Show me the map` |
| _(keep)_ `Real pint prices on a live map — and the stories behind every round.` · `steal a crawl someone already ran.` | On-voice — do not touch | — |

### `/discover` · **worst clarity failure on the site**

| Current | Problem | Rewrite → |
|---|---|---|
| `Capture and review are evidence stages, not routes. Only a Night Area with a complete, live gate can produce a Crawl Route; everything else stays browse-only.` | Pure internal pipeline jargon; a Londoner learns nothing | `Some areas are ready to plan a crawl. Others we're still checking prices in — you can browse those now.` |
| `Inspect pubs` (×20 CTA) | Clinical | `See the pubs` |
| status token `Route-ready` | pipeline word | `Ready to plan` |
| status token `Captured` / `Reviewed` / `Discovered` / `Paused` | pipeline words exposed | `Prices coming` / `Nearly there` / `New` / `On hold` |
| `The evidence gate is live. A Crawl Route can be planned.` | robotic passive | `Clapham's ready — plan a crawl now.` (name the area) |
| `4 evidence checks remain; no route yet.` | internal | `Still checking a few prices here. Browse for now.` |
| `The review window expired; browse-only until a fresh snapshot lands.` | internal | `Our prices here have gone stale. Browse while we refresh them.` |
| `"Inspect pubs" opens the map for browsing only. It does not turn a captured, reviewed, discovered, or paused area into a planned route.` | explains its own jargon to escape its own jargon | Delete. With the rewrites above it's self-evident. |

### `/pint-index`

| Current | Problem | Rewrite → |
|---|---|---|
| `0 eligible public observations.` `We are keeping this page intentionally empty until source and observation evidence pass the public snapshot contract.` | Cold engineering voice on the empty state | `No prices have cleared our public bar yet. We'd rather show nothing than show a guess — the league table opens the moment cited prices land.` |
| Methodology body (`point-in-polygon`, `versioned Greater London boundary artifact`, `Quarantine`) | Technical | **Keep as-is.** This page is deliberately citable/defensible; jargon earns its place here. Only the empty state above needs a human. |

### `/pubs` · `app/pubs/page.tsx` + `components/pubs/PubsGallery.tsx`  _(collides with PR 305)_

`scraped`/`scrapes` leaks the plumbing in **five** places on this page alone — it's a systemic tic, not one line. Kill it everywhere.

| Current | Problem | Rewrite → |
|---|---|---|
| metadata title `Pubs — scraped menus on the map · PUBMAXXING` | "scraped" in the browser tab / search result | `Pubs — real menus on the map · PUBMAXXING` |
| `Scraped pubs` (h1) | plumbing as a page title | `The pubs` |
| `Young's gardens, Nicholson's historic rooms, and Greene King menus we've scraped into the London map…` | plumbing in body | `…menus we've pulled onto the London map…` |
| `119 pubs from our scrapes` | plumbing | `119 pubs we've checked` |
| `No scraped pubs in this filter yet.` (empty state) | plumbing + dead end | `No pubs match that filter yet.` |
| `Price coming soon` (repeated across ~75 rows) | passive, lifeless at volume | `No pint price yet — be the first to log one` (link to the drop flow; turns dead rows into contribution invites) |

### `/tonight` · `app/tonight/TonightClient.tsx`  _(collides with PR 304)_

| Current | Problem | Rewrite → |
|---|---|---|
| `Nothing confirmed in London tonight yet — we only show what the upstream actually returns. Check back later.` | "the upstream" engineering jargon | `Quiet one in London tonight — we only list what's really on, and right now that's nothing. Try later.` |
| `No invented nights; thin nights stay thin.` (lede) | "thin nights" internal metaphor | `We only show what's really on. A quiet night looks quiet — no filler.` |
| `1 listing tonight` / `Quiet night` | "listing" slightly SaaS | `1 thing on tonight` / `Quiet night` (keep) |

### `/pal`

| Current | Problem | Rewrite → |
|---|---|---|
| `Pub Pal is a companion to a plan, not a gate in front of one.` | internal metaphor ("gate") | `Pub Pal helps once you've got a plan — it never stands between you and the map.` |
| `Optional by design` (badge) | SaaS label | `Skip it if you like` |
| `Route before character` (eyebrow) | cryptic | `Plan first, personality later` |
| `Get three grounded stops, then choose the voice and form that fits you.` | "grounded stops", "voice and form" jargon | `Get three real stops first. Then pick the Pal that suits you.` |
| _(keep)_ `First, describe your night.` | on-voice | — |

### `/map` · WebGL fallback  _(collides with PR 297 / 304)_

| Current | Problem | Rewrite → |
|---|---|---|
| `Could not create a WebGL context, VENDOR = 0xffff, DEVICE = 0xffff, GL_VENDOR = Disabled … BindToCurrentSequence failed …` | **Raw engine error dumped to the user** | Hide behind a `Technical details` disclosure. User sees only the honest line below. |
| _(keep, strong)_ `Map renderer unavailable` → soften to `The map can't load in this browser` · `This browser can't run the map — it needs WebGL. The pub list and crawl planner beside it still work as ever.` | "renderer" is the only leak | `The map can't load here — this browser doesn't support it. The pub list and crawl planner still work fine.` |

### `/feed` and `/crawls` — mostly exemplary

These two carry the target voice. **Do not rewrite the lore.** `handed down from the old hands who drank them first`, `Nan's shift, 1950s`, `Told since the 1960s`, `Cheers / Bargain / Chaos / Proper / Legendary`, `Cheap Legends` — this _is_ the spec. Two small notes:
- Feed filter `For You` → `Your feed` (kill the algorithmic-SaaS label; keep everything else).
- `A Crawl Story is a shareable poster of a London pub crawl` → `A Crawl Story is a poster of a night's route — the stops, the prices, the vibe — made to send to the group.`

---

## C. Attachment moments map — the 8 highest-leverage seams

Ranked by leverage. Each has the exact new copy written out. These are where people start saying _"my"_ PUBMAXX.

**1. The first pint you log (first-drop nudge)** — `lib/firstDropNudge.ts`, PR 326.
The current line is already gold: `No pint on record here. First drop's yours for the taking.` → **Extend it to name the place, so the user founds the record of _their_ local:**
> `No pint on record at The Dove yet. First drop's yours — you'll be the one who started its price.`
Success toast after logging (new): `Logged. You're the first name on The Dove's board.`

**2. The morning after** — `components/moment/MomentCapture.tsx` (+ recap, PR 335).
`Saved. Still yours.` is the model line — keep it. Add the return-visit line the next morning (new, when a saved Moment exists and the user reopens):
> `Last night's kept. Open it when you want to remember why.`

**3. The return visit / the streak** — needs `feat/price-drops-v2` (PR 303, streaks) + a home surface.
Steal Duolingo's ritual naming. When a user opens on a repeat night:
> First return: `Back again. Same crew, or a new one tonight?`
> Streak alive: `Third Thursday running. The usual round?`
> Streak about to break (morning): `Your Thursday streak's still warm. One pint keeps it going.`

**4. Your borough on `/discover`** — `app/discover`.
Replace the status token with a line that hands the area to the user. When their most-visited/nearest area is ready:
> `Clapham's your patch — and it's ready. Plan tonight's crawl.`
When it isn't: `We're still pricing up Dalston, your side of the river. Have a browse while we finish.`

**5. The empty feed / no drops near you** — `components/landing/PintDropStrip.tsx` (`No community drops yet — be the first to log a pint on the map.`).
Make them the founder, not a fallback:
> `No stories on your patch yet. Log the first pint and you write the opening line.`

**6. Last Pint / the guardian close** — `components/map/LastTrainCard.tsx`, guardian on PR 302.
`Time in hand — no rush yet.` is already the best line in the product. The attachment move is to make the _close of the night_ feel looked-after and shareable:
> When time's short: `Last one's on the clock — leave by 11:52 for the Victoria line home.`
> Send-to-crew (PR 302): `Tell the crew when to drink up →`

**7. The empty `/tonight`** — the quiet-night companion, not a dead end.
> `Quiet one in London tonight. Nothing's on that we'd vouch for — so we're not going to pretend. Fancy a crawl instead?` (+ `Plan a crawl →`)

**8. The first-open hero** — make it their night, not a slogan.
Replace `Make tonight worth remembering.` / `Your city is already happening.` with something a Londoner would actually think at 6pm:
> Hero: `Sort tonight.` · sub: `Cheap pints, a plan your mates will walk, and the last train home — on one map.`
> Final CTA: `Your night's out there. Go find it.` → `Open the map`

---

## D. Implementation plan

### Ground truth on collisions
22 copy-adjacent PRs are open. The rewrites in this spec touch files that **six open PRs already edit** — those must be sequenced, not raced. Everything else is free real estate.

| Lane | Files | Collides with (open PR) | Sequencing |
|---|---|---|---|
| **L1 · Homepage voice** | `components/landing/LandingPage.tsx`, `ThamesHero.tsx` | **PR 311** `taste/header-consistency` (edits LandingPage.tsx) | Land after 311 merges, or hand these exact strings to 311's author to fold in. Do **not** open a parallel LandingPage PR. |
| **L2 · Discover de-jargon** | `app/discover/*` | none found | **Ship first — highest impact, zero collision.** |
| **L3 · Tonight empty/lede** | `app/tonight/TonightClient.tsx` | **PR 304** `taste/error-empty-states` (edits same file) | Fold these strings into PR 304 — same file, same intent. |
| **L4 · Pubs header + price rows** | `components/pubs/PubsGallery.tsx` | **PR 305** `taste/list-discipline` (edits same file) | Fold into PR 305. |
| **L5 · Feed `For You` + Crawl Story blurb** | `components/feed/FeedCard.tsx`, `app/crawls` | **PR 307** `taste/feed-card-slim` (edits FeedCard) | Fold the `For You→Your feed` change into PR 307; crawls blurb is standalone. |
| **L6 · Tour copy** | `components/onboarding/FirstRunTour.tsx` | **PR 296** `fix/welcome-modal-once` (edits same file) | Fold into PR 296. |
| **L7 · Map fallback disclosure** | `components/map/*` fallback | **PR 297 / 304** (WebGL watchdog + empty states) | Coordinate with PR 297's author — they own the fallback surface. |
| **L8 · Pal page** | `/pal` page + components | none found | Standalone, ship anytime. |
| **L9 · Pint-index empty state** | `/pint-index` empty branch only | none found | Standalone; touch _only_ the empty state, leave methodology. |
| **L10 · Attachment copy** | first-drop (PR 326), guardian (PR 302), streaks (PR 303), identity/moment (PR 312), recap (PR 335) | all five are unmerged feature PRs | These are **not** rewrites of live copy — they extend features still in flight. Hand each moment's exact line to the owning PR author (see §C for the file per moment). |

### Suggested order
1. **L2 (discover)** and **L8 (pal)** and **L9 (pint-index empty)** — zero collisions, ship immediately, biggest clarity wins.
2. Fold **L3, L4, L5, L6** into their colliding PRs (304, 305, 307, 296) as review comments with exact strings — no new PRs.
3. **L1 (homepage)** after PR 311 lands.
4. **L7** in coordination with the map-fallback owner.
5. **L10** — distribute the eight attachment lines to feature-PR authors (326, 302, 303, 312, 335); these ship with their features, not as a copy pass.

### Guardrail for the whole repo (cheap, high-value)
Add a lint/test that fails on the banned register in user-facing strings: `scrape`, `upstream`, `observation`, `evidence gate`, `Night Area`, `Crawl Route`, `provenance` (outside `/pint-index`), and any `!` in product copy. This keeps the voice from regressing as 20 lanes land.

---

## Appendix — the lines to protect

These already are the voice. Any rewrite that weakens them is wrong:
`Saved. Still yours.` · `Keep this one.` · `One line you will still remember next year.` · `Time in hand — no rush yet.` · `First drop's yours for the taking.` · `Make a memory, not a spreadsheet` · `handed down from the old hands who drank them first` · `steal a crawl someone already ran` · `Cheers / Bargain / Chaos / Proper / Legendary` · `Cheap Legends` · `Nan's shift, 1950s` · `Every pint has a story.`
