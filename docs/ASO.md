# ASO copy set (App Store + Play)

Cycle 17, Lane D. Canonical app-store copy for PUBMAXXING. Positioning line, per
the PRD (docs/UNIVERSAL_DAY0_PRD.md): **"London runs on its pubs. This is the app
that runs your night."**

Voice rules, non-negotiable: the pub as third place, presence over optimization.
Never anti-health, never a "drink more" framing. No em dashes anywhere. Every
claim is honest: no invented ratings, download counts, or awards. Numbers that
appear in copy come from the same public datasets the app runs on (lib/aboutStats).

The product is PUBMAXX; the shipped app is PUBMAXXING. Store listings use
PUBMAXXING.

---

## App name and subtitle

Character budgets: iOS name and subtitle are 30 characters each; Play title is 30.
Counts below include spaces.

| Field | Copy | Chars |
| --- | --- | --- |
| iOS app name | `PUBMAXXING: London pub nights` | 29 |
| iOS subtitle | `The app that runs your night` | 28 |
| Play title | `PUBMAXXING: London pub nights` | 29 |
| Play short description (80) | `Cheap pints, tonight's plans, and your crew. One app for the whole night out.` | 77 |

Backup name options if the primary is taken:

- `PUBMAXXING: pub crawl planner` (29)
- `PUBMAXXING: pints and nights` (28)

Backup subtitles:

- `Cheap pints and tonight's plans` (30)
- `Find the pint, plan the night` (29)

---

## Keywords (iOS)

The iOS keyword field is one 100-character comma-separated string. Do not repeat
words already in the app name or subtitle (Apple indexes those separately), and
drop the spaces after commas to save characters. Singular terms also match their
plurals, so prefer the singular.

Primary keyword string (94 chars):

```
pint,pub crawl,cheap pint,pub quiz,whats on,beer,bar,drinks,boozer,pub map,round,local
```

Reserve terms to rotate in as ranking data comes back (swap, do not append past
100 chars): `craft beer`, `real ale`, `happy hour`, `night out`, `guinness`,
`gastropub`, `soho`, `camden`, `shoreditch`.

Play uses the long description for keyword surface area rather than a keyword
field, so weave the same terms naturally into the description below.

---

## Play long description (skeleton)

Lead with the positioning line, then the job, then the honesty bar. Keep it under
4000 characters.

> London runs on its pubs. This is the app that runs your night.
>
> PUBMAXXING is one app for the whole night out. See what a pint actually costs
> before you set off, find what is on tonight near you, plan a route your whole
> crew can join with one link, and get there and home. No account needed to look
> around.
>
> What you get:
>
> - The Pint Index: London's pint price league table, ranked by borough, every
>   figure sourced and dated.
> - Tonight near you: quiz nights, sport, live music, and deals, with the source
>   shown on every card.
> - Plan a night: pick the stops, share one link, and mates tap "I'm in" with a
>   name. No sign-up wall.
> - Your lot: add friends at the table and their nights show up. Private by
>   default, nothing public unless you share it.
> - Heritage worth the walk: one sourced fact per historic pub, never invented.
>
> What we stand for: the pub as a third place, not a leaderboard. A great night
> is measured by the life around the drink, never by how much you drank. No ads,
> no paywalls, honest data always.

---

## Screenshot shot-list

Maps to the Gate Z mobile set under `docs/screenshots/` (390 wide, both themes;
lead the store with dark, keep light as the alternate). Rubric: one clear idea per
shot, provenance visible where a card is scraped, a caption with no em dash.
Ship six; shots 7 and 8 are the overflow slots for stores that allow more.

| # | Surface | Source screenshot (390) | Caption |
| --- | --- | --- | --- |
| 1 | Hero / landing | `landing-dark-390.png` | One app for the whole night out |
| 2 | Map, clean | `map-clean-dark-390.png` | See the pint price before you set off |
| 3 | Tonight lane | `w1-tonight-lane-dark-390.png` | What is on tonight, near you |
| 4 | Tonight sheet | `w1-tonight-sheet-dark-390.png` | Quiz, sport, music, and deals |
| 5 | Plan | `plan-dark-390.png` | Plan the route, share one link |
| 6 | Venue sheet | `map-sheet-dark-390.png` | Every claim shows where it came from |
| 7 | Feed / your lot | `feed-dark-390.png` | Your lot, their nights, private by default |
| 8 | Passport / profile | `profile-you-dark-390.png` | Every pint stamps a page |

Light-theme alternates use the matching `*-light-390.png` file for each row.

Caption bank (swap without breaking the voice rules, no em dashes):

- "London's pint price league table"
- "Cheap pints, sorted"
- "Get everyone on the same page"
- "No account needed to look around"
- "Presence over optimization"

Shot production notes:

- Reduced-motion frames only; no mid-animation captures.
- Keep the primary action inside the first viewport in every shot.
- If a scraped card appears, its provenance label must be legible in the crop.
- Erin and Carol never appear; use the app's own demo handles for any social shot.
