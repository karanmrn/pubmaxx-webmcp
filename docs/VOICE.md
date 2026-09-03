# PUBMAX voice

_The one doc that decides how every string in the app reads. If copy fights this, the copy is wrong._

PUBMAX sounds like a Londoner who knows the pub, not a brand that owns one. Dry, warm, direct, a bit funny, never salesy. We're for the commoners: the people getting mugged £7.20 for a lager who just want a good pint without thinking about it. The whole point of the app is in the voice: **a pint shouldn't cost a day's lunch, so we show listed prices with honest publisher status, and nobody ever pays to rank.**

---

## The mission, said plainly

Say it the way you'd say it to a mate, not the way a startup says it in a deck.

- London pints cost a fortune. We show you what every pub actually charges, so you stop guessing and stop overpaying.
- Every price says exactly what its own record supports. When the record names a publisher, name and link it. When no publisher is recorded for that price, say so plainly beside the figure. Never infer one from venue notes, image credits, or unrelated metadata. The ones logged by drinkers carry the day they were seen; only the people-logged lanes carry per-row dates. No made-up numbers.
- Nobody buys their way to the top. There's a hard wall in the code (`lib/sponsorship.ts`) between paid placements and the prices you see. A sponsored thing says "Sponsored" and sits in its own slot. Prices are never for sale.

Never write the mission as a mission. No "we're on a journey to democratise fair pricing." State the problem, hand the reader a choice, move on.

---

## The rules

Distilled from the brands that sound human and mean it: early Monzo, early BrewDog, Tony's Chocolonely, Liquid Death, Oatly.

**1. Say it out loud. If you wouldn't say it to a mate at the bar, cut it.**
The tell for AI/corporate copy is a Latin-root word where a plain one would do: _locate, purchase, require, provide, utilise, commence, verify, obtain._ Swap for _find, get, need, check._ (Monzo's single hardest rule.)

**2. Never show the reader the plumbing.**
The words `capture`, `evidence gate`, `snapshot`, `provenance`, `observation`, `upstream`, `Night Area`, `Crawl Route`, `route-ready gate`, `renderer` belong in code, not on a screen a thirsty person reads at 6pm. Say what they _get_, in pub words.

**3. Concrete nouns and real numbers do the work. Empty adjectives don't.**
"£4.80 pints in Zone 2, 37 of them tonight" beats "great-value drinks near you" every time. Reach for _quid, round, pint, local, mates, patch, the walk_. The specifics are the personality.

**4. Second person for them, confident "we" for us.**
"You" keeps it about the reader's problem. "We" gives us a spine: _we check them every week, we won't push you to drink more, we only list what's really on._ Lead with what matters to them, then our reason.

**5. Contract everything. Start sentences with And, But, So.**
It's how people talk. "It's not cheap being thirsty in London. But it doesn't have to cost £7.20 either."

**6. One dry aside, not a pile of jokes.**
A pinch, not a dollop. Pick your best line, drop it in, move on. "The Crown, Camden. £5.10 a pint. (Yes, in this economy.)" Skip any pun you've heard before.

**7. Punch up, never down.**
Take the swing at the enemy (rip-off pricing), never at the user, never at our own reliability. "Some pubs charge £8 for a lager. We think that's a crime. Here's where it isn't one."

**8. Reward the regular at every seam.**
Empty states, errors, the morning after, the return visit: each earns a human line, never a dead `No results` or a status token. This is where the app is loved or dropped.

---

## House law (non-negotiable)

- **No em dashes. Anywhere in product copy.** Use a full stop, a comma, or a colon. (Enforced tree-wide by `__tests__/emDashLaw.test.ts`, the em-dash law below. Never reintroduce one.)
- **No exclamation marks.** A Londoner doesn't oversell. One confident line beats a shouted one.
- **No fake counts, no invented data.** If a number isn't real, don't show it. "No price logged here yet" beats "0 observations". (Taste doctrine.)
- **Name alcohol-free choices in words.** Controls and prose say "alcohol-free", never bare "0.0" category shorthand that reads like broken number formatting. A real drink name may keep its branded wording.
- **British spelling.** _colour, favourite, realise, licence, metre, cancelled._ Never _color, favorite, realize._
- **No begging.** No "please try again", no "check back later", no "don't miss out".

## The em-dash law

An em dash in product copy is the single loudest tell that a machine wrote it. So the ban is not a style note, it is a fence: `__tests__/emDashLaw.test.ts` reads the source of every user-facing surface and fails the build if a reader could ever see one.

**What it scans.** Every `.tsx` under `app/` and `components/`, plus the `lib` files that export copy a person reads (API errors, the freeze wall, TfL disruption phrasing, weather nudges, the OG card). It parses each file to an AST and inspects only JSX text, string literals, and template literals, so the words on a screen are judged and nothing else.

**What it fails on.** A literal em dash (U+2014), its HTML entity (`&mdash;`, `&#8212;`, `&#x2014;`), and an en dash used as a clause separator (a space on each side, ` – `), which is just an em dash in a smaller coat.

**What it allows.** Code comments, because they are not copy and the AST never sees them. Decorative glyphs inside an `aria-hidden` element, because a screen reader skips them. Module specifiers in imports. Number and date ranges written with an en dash and no spaces (`2019–2024`, `28A–28B`), which is correct typography. And an explicit exceptions list, which is empty today and should stay that way: if a string seems to need a dash, the sentence around it is the problem, not the punctuation.

The fix is never a mechanical swap. When you find one, rewrite the sentence so it does not want the dash. The dash is a symptom; the sentence built around it is the disease.

## Banned words

Hard bans in product copy. These are the AI/marketing tells:

> experience, discover, elevate, seamless, curated, unleash, empower, vibrant, delve, dive into, whether you're X or Y, look no further, game-changer, unlock, journey, effortless, immerse, robust, leverage, so much more, revolutionary, at your fingertips, take it to the next level

Plus the plumbing words from Rule 2 (`capture`, `evidence gate`, `snapshot`, `provenance`, `Night Area`, etc.) and the corporate Latinate list from Rule 1.

---

## Ten before / after, from the actual codebase

Some of these are lines we already own and should copy the rhythm of. Others are the plumbing-and-clinical copy this sweep replaced.

| # | Before | After | Where |
|---|--------|-------|-------|
| 1 | Areas near you, with the gate visible | Where you can plan a crawl tonight | `NightAreaCoverage` heading |
| 2 | London capture | Across London | `NightAreaCoverage` eyebrow |
| 3 | The evidence gate is not complete yet; no route is promised. | Not enough fresh prices here yet to plan a crawl. | `NightAreaCoverage` detail |
| 4 | Capture has not started; browse-only for now. | Haven't got to this one yet. Have a browse. | `NightAreaCoverage` detail |
| 5 | The review window expired; browse-only until a fresh snapshot lands. | Prices here have gone stale. Have a browse while we recheck them. | `NightAreaCoverage` detail |
| 6 | Capture and review are evidence stages, not routes. Only an area with a complete, live gate can produce a Crawl Route. | We only call an area crawl-ready when its prices are fresh and checked. The rest are yours to browse. | `NightAreaCoverage` intro |
| 7 | Reviewed nearby food recommendations are not available for this route yet. | No late food worth pointing you to round here yet. | `NightModeCard` |
| 8 | No grounded nearby extension is available without widening the route. | Nothing close enough to add without dragging the night out. | `NightModeCard` |
| 9 | Nearest rail signal: {station}. | Nearest station: {station}. | `NightModeCard` |
| 10 | Kitchen hours can change; verify tonight before leaving the last pub. | Kitchens can shut early. Check tonight's hours before you leave the last pub. | `NightModeCard` |
| 11 | After a hard day's work you want a cheap pint nearby — without bouncing between Google Maps, other maps, and ChatGPT. | You finish work, you want a good pint nearby. So you open Google Maps, then another map, then reviews, then you're asking ChatGPT, and an hour later you're back at the same place as last time. | `/about` lede |
| 12 | Karan Manoharan &mdash; X | Karan Manoharan · X | `/about` press-kit founder line (no dash construction) |

## Where the jokes live

Rule 6 says one dry aside, not a pile. This is where an aside is allowed to be an
actual joke, because nothing is at stake on the screen: **the 404, empty states,
loading lines, and a couple of easter eggs.** Everywhere else the aside stays a
pinch.

The bar a candidate has to clear, in order:

1. It lands for a 22-year-old and a 45-year-old at once. One voice, no youth mode.
2. It survives the hundredth viewing. Funny once and grating twice is worse than nothing.
3. It does not date inside six months. No current news, no format of the moment.
4. A British drinker recognises it. Pub language, not internet-comedy cosplay.
5. You could defend it to a stranger. If you cannot, cut it.

**Never within sight of** a price, a date, a source, an attribution, a
corroboration status, a legal term, an error the reader has to act on, or an
accessible name. The whole product rests on prices reading as honest, and a witty
line beside a figure cheapens the figure.

The accessible-name rule has a working example: the map's held loading frame shows
`Loading London pubs…` while its `aria-label` says only `Loading the London pub
map.` The visible line is free to carry an aside and the announced one never is,
because a joke in an accessible name is a joke at someone's expense. This frame's
visible line stays plain on purpose - it is the first thing a cold arrival reads
and it says which city is loading - so the split here is one of shape rather than
of wit. `__tests__/mapLoadingFrame.test.ts` pins the accessible name and
`__tests__/mapLoadingCopy.test.ts` pins the visible line.

The lines under **The north star** are settled. Each already carries its aside on
a surface that allows one, so a later sweep copies their rhythm and leaves the
lines themselves alone rather than reopening them.

## The north star (lines we already own)

Copy the rhythm of these. They are the voice at its best.

- `Saved. Still yours.`
- `Every pint has a story.`
- `You've reached the bottom of the barrel.`
- `The city's having a quiet one tonight.`
- `handed down from the old hands who drank them first`
- `Be the first to drop one. Snap your pint, log the price, pass down a story.`
