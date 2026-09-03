# CAP Code alcohol-copy audit (2026-07-21)

Status: historical audit. Safety amendment 2026-08-22 retired "On a bender",
"Get lit", and the dissenting "coward" tally. Current public labels are "Big
one tonight" and "Live and loud". See `docs/VIBE_LAYER_SPEC_2026-07-19.md`.
Rows below preserve the evidence reviewed on 2026-07-21 and are not current
copy requirements.

Probe U4 from docs/UNKNOWNS_MAP_2026-07-21.md. A read-through of every authored
product-copy surface against UK CAP Code section 18 (Alcohol), producing a
rules summary with citations, a per-surface findings table, a banned/safe phrase
list in the style of the frictionVoice fence, and the exact set of decisions the
owner must rule on. One clear violation (the "one for the road" drink-driving
idiom, present on three surfaces) was fixed; owner-locked and owner-blessed
exposures (the register chips, the "coward" tally jab, the Chaos Score) are
recorded with a risk grade and left for owner ruling, never unilaterally
rewritten.

House rules observed: no em dashes in this doc or in any copy it changes;
British register preserved; no new CI fences added (they are proposed below);
the seven owner-locked vibe chips in lib/vibeChips.ts are untouched.

## 1. Scope: does CAP section 18 even bind PUBMAXX?

PUBMAXX is not an alcohol brand, so the first question is whether section 18
applies at all. It does, in part.

- CAP section 18 covers "marketing communications for alcoholic drinks **and
  marketing communications that feature or refer to alcoholic drinks**"
  (section 18 scope note, ASA). PUBMAXX marketing that refers to pints, drinks,
  and drinking sessions (store listings, OG cards, push, the weekly email
  digest) is therefore in scope as marketing communications that refer to
  alcohol.
- Marketing communications on a company's own website/app are within the CAP
  digital remit; purely functional or editorial in-app content (prices, times,
  provenance, transit data) is weaker CAP territory but the ASA reads context
  holistically, so the safe posture for a consumer product this close to the
  line is to hold all user-facing copy to the section-18 bar. That is the
  posture this audit takes.
- The strongest-scope surfaces (treat as unambiguously in remit): docs/ASO.md
  store copy, app/og.png OG card, app/api/plan-card OG card, the push lines in
  docs/VIBE_LAYER_SPEC, and lib/weeklyDigest (a promotional email is a
  non-broadcast marketing communication).

Two structural gaps that are not copy violations but sit under section 18 and
belong in the U4 answer (owner + legal to note):

- **No responsible-drinking or age-affirmation copy exists anywhere in the
  app.** Grep for "drinkaware", "over 18", "responsibly", "know your limit"
  returns nothing. Section 18's principle is that communications "should not be
  targeted at people under 18" (18.14/18.15) and the taste doctrine already
  bans under-18 register; but the total absence of any age or responsible-drinking
  line is worth a deliberate decision, especially before the TikTok growth
  channel (U4 names it) points alcohol-adjacent content at an unknown-age
  audience.
- **Age gate timing** (U4's open question, out of copy scope): the ASA treats
  audience composition, not just copy, so the 25%-under-18 media rule (18.15)
  and Pal-creation age affirmation are a product decision, not a wording one.

## 2. Rules summary (CAP Code section 18, non-broadcast) with citations

All quotations verbatim from the CAP Code section 18 as published by the ASA
(asa.org.uk/type/non_broadcast/code_section/18.html) and CAP advice-online
guidance. Rule numbers cited so a finding can be defended line by line.

| Rule | Verbatim text (abridged where noted) | What it catches for us |
| --- | --- | --- |
| Section 18 principle | "Marketing communications for alcoholic drinks should not be targeted at people under 18 and should not imply, condone or encourage immoderate, irresponsible or anti-social drinking." | The umbrella. Any copy that reads as "drink more / drink harder" or as youth-targeted. |
| 18.1 | "Marketing communications must be socially responsible and must contain nothing that is likely to lead people to adopt styles of drinking that are unwise. For example, they should not encourage excessive drinking." | Encouraging another / a session / a "bender"; disparaging moderation. CAP advice: even text like "down it like it's water" breaches 18.1 without any visual. |
| 18.2 | "Marketing communications must not claim or imply that alcohol can enhance confidence or popularity." | Copy tying drinking to being liked / confident. |
| 18.3 | "Marketing communications must not imply that drinking alcohol is a key component of the success of a personal relationship or social event." | "The night only works if you drink" framing. Note carve-out: drinking may be shown as sociable. |
| 18.4 | "Drinking alcohol must not be portrayed as a challenge. Marketing communications must neither show, imply, encourage or refer to aggression or unruly, irresponsible or anti-social behaviour" and must not link alcohol with "brave, tough or daring people." | Bravado framing: making the bigger night the brave choice or the moderate choice cowardly. |
| 18.5 | "Marketing communications must neither link alcohol with seduction, sexual activity or sexual success nor imply that alcohol can enhance attractiveness." | Date/pulling framing tied to drinking. |
| 18.6 | "Marketing communications must not imply that alcohol might be indispensable or take priority in life or that drinking alcohol can overcome boredom, loneliness or other problems." | "Alcohol fixes your mood/night" framing. |
| 18.9 | "Marketing communications may give factual information about the alcoholic strength of a drink... but must not otherwise imply that a drink may be preferred because of its alcohol content or intoxicating effect." | Protects our factual price/ABV data and real brand names (e.g. "Neck Oil"). |
| 18.14 | Communications "must not be likely to appeal particularly to people under 18" nor feature people/characters "who are likely to appeal particularly to people under 18 in a way that might encourage the young to drink." | Youth slang and the Pub Pal animal characters if pushed toward child appeal. |
| 18.15 | "No medium should be used to advertise alcoholic drinks if more than 25% of its audience is under 18 years of age." | The TikTok/growth-channel exposure (U4), a media-buying rule not a copy rule. |

CAP guidance on unwise/excessive consumption (advice-online) adds the practical
tests this audit applied to phrasing: drinks "consumed in one swallow, a few
large gulps, over a short space of time or in large quantities" and copy that is
"inherently likely to be considered as encouraging excessive drinking" both
breach 18.1. "Immoderate consumption, drinking over a prolonged period or rapid
intake over a short space of time" are the three named unwise styles.

## 3. Per-surface findings

Classification: **VIOLATION** = clear breach a cautious brand would not ship;
**RISK** = defensible but exposed to a complaint, a judgement call, or an
owner-locked decision; **SAFE** = no section-18 exposure. Scraped third-party
venue content (public/data/*.json menu and offer text such as "sunny day sesh",
"get messy") is out of authored-copy scope: it is other companies' marketing that
the app displays as data, not PUBMAXX marketing communications, and is not
fixable here. It is flagged once at the bottom for the data lane.

| Surface | File:line | Copy | Rule(s) | Grade |
| --- | --- | --- | --- | --- |
| Weekly email digest, tip header (HTML) | lib/weeklyDigest.ts:426 (was) | "One for the road" | 18.1 (principle) | **VIOLATION → fixed** |
| Weekly email digest, tip header (plain text) | lib/weeklyDigest.ts:508 (was) | "ONE FOR THE ROAD" | 18.1 (principle) | **VIOLATION → fixed** |
| Today page lede (brand voice, fence surface) | app/today/TodayClient.tsx:250 (was) | "how you'll get home, and one for the road." | 18.1 (principle) | **VIOLATION → fixed** |
| Chaos Score grade taxonomy | lib/chaosScore.ts:27 | grade "Unhinged", oneLiner "Somebody's phone has evidence." | 18.1, 18.4 | **RISK (high) - owner ruling** |
| Chaos Score grade taxonomy | lib/chaosScore.ts:28 | grade "Legendary", oneLiner "Absolute scenes." | 18.1 | **RISK (high) - owner ruling** |
| Chaos Score share button | app/crawls/[slug]/page.tsx:221 | "Share the chaos" | 18.1 | **RISK (med) - owner ruling (same feature)** |
| Feed reaction labels | components/feed/FeedCard.tsx:38-40; lib/reactions.ts:11 | "Chaos" / "Legendary" | 18.1 | **RISK (low) - user reactions** |
| Route pack | lib/routePacks.ts:73-74 | "Cheap chaos" / "when the night should stay loud" | 18.1 | **RISK (low)** |
| Crew vibe tally, share OG card | lib/vibeTally.ts:77 | "...1 coward voted Quiet pint" | 18.4, 18.1 | **RISK (high) - owner ruling** |
| Vibe chip label (owner-locked) | lib/vibeChips.ts:57 | "On a bender" | 18.1 | **RISK (high) - owner-locked, record only** |
| Vibe chip ask (owner-locked) | lib/vibeChips.ts:58 | "Plan us a proper bender, four of us, cheap pints, lively" | 18.1 | **RISK (med) - owner-locked, record only** |
| Vibe chip label (owner-locked) | lib/vibeChips.ts:64 | "Get lit" | 18.1, 18.14 | **RISK (med) - owner-locked, record only** |
| Vibe stamp label, OG card | app/api/plan-card/route.tsx:36-37 | "On a bender" / "Get lit" (verbatim from chips) | 18.1 | **RISK - mirrors owner-locked chips** |
| Vibe slug (public contract) | lib/vibeChips.ts:140 | "on-a-bender" | 18.1 | **RISK - locked public slug, record only** |
| Last-train decision ladder | components/map/LastTrainCard.tsx:110; app/api/last-train/route.ts:5 | "Order one more" | 18.1 | **RISK (med)** |
| Pre-approved store fallback | lib/vibeChips.ts:135 (comment); VIBE_LAYER_SPEC | "Big one tonight" | 18.1 | **RISK (low) - owner pre-approved** |
| Route ending / night mode | components/night/RouteEndingCard.tsx:54-55; NightModeCard.tsx:204 | "Keep going" / "Carry on to the next saved stop" | none (route nav) | SAFE |
| Zone pint index empty state | components/zones/ZonePintIndexStrip.tsx:32 | "Log a few more pints and the zone tax appears here" | none (logging prices) | SAFE |
| Discover low/no line | app/discover/DiscoverPageClient.tsx:401 | "...or the low/no option for one more stop" | 18.1 (mitigant) | SAFE (one more STOP, promotes low/no) |
| Weather-to-drink verdicts | lib/drinkWeather.ts:71-117 | "Beer garden weather. Lager or cider." etc. | 18.3-adjacent | SAFE (grounded weather-drink pairing, factual register) |
| 404 page | app/not-found.tsx:64 | "This page has drunk up and gone home." | 18.1 | SAFE (playful, about a page, low) |
| Store listing / positioning | docs/ASO.md | "measured by the life around the drink, never by how much you drank" | 18.1 (mitigant) | SAFE (model copy) |
| App metadata / OG tagline | app/layout.tsx:34/111/121; app/og.png:141 | "crawl your mates will actually walk" / "Real prices, Live plans, Proper nights" | 18.1 | SAFE (route framing, get-home in view) |
| Heritage LLM system prompt | lib/heritage.ts:164-171 | "Answer ONLY from the CONTEXT facts... do not guess" | 18.9 | SAFE (facts-only, cited) |
| Weekly digest tips pool | lib/weeklyDigest.ts:131-135 | "Check the last train home before that final round" etc. | 18.1 (mitigant) | SAFE (responsible) |
| PWA manifest description | public/manifest.webmanifest:4 | "Price-aware nightlife map, planner, and stories worth remembering." | none | SAFE |
| Real beer brand name | lib/drinkBrands.ts:74 | "Neck Oil" | 18.9 | SAFE (factual product name) |

### Why the VIOLATIONS (all three are the same idiom)

"One for the road" is the recognised UK drink-driving idiom: culturally it means
a final drink before you set off or drive home. Section 18's responsible-drinking
bar is strict, and CAP has upheld against copy that merely references unwise
drinking styles without any visual. It appears in three authored brand-voice
places: the weekly promotional email digest header (HTML at
lib/weeklyDigest.ts:426 and plain text at :508) and the Today page lede
(app/today/TodayClient.tsx:250, a primary in-app surface and a frictionVoice
fence file). Using that idiom in a promotional email and on a main surface is
exactly the kind of phrase a cautious alcohol-adjacent brand would not ship, even
though the content each introduces is itself responsible (the digest tip is a
last-train safety line). None of the three is owner-locked or mentioned in any
spec; the drink-driving connotation is the phrase's dominant cultural meaning, so
the "it's just a pun for a parting nugget" defence is thin. All three were fixed:

- Digest headers to "Worth remembering" / "WORTH REMEMBERING", which preserves
  the "parting nugget" meaning and pairs with the empty-week line ("Here's one
  thing worth remembering anyway") already in the same block. The plain-text
  header is pinned by __tests__/weeklyDigest.test.ts:283 and the committed
  fixtures under docs/digest-samples/*; both were updated (assertion edited,
  fixtures regenerated via WRITE_DIGEST_FIXTURES=1). This is keeping the tests
  truthful about copy I deliberately changed, not weakening a fence.
- Today lede to "and one to remember." (JSX text, not a quoted literal, so the
  frictionVoice em-dash literal check does not apply; no banned phrase
  introduced).

### Why the contested items are RISK, not VIOLATION, and left for the owner

- **The "coward" tally jab** (lib/vibeTally.ts:77) is the single strongest
  brand-voice exposure in the app, because the app (not the user) editorialises
  the word "coward" onto a shared card: "3 of the lot voted On a bender, 1
  coward voted Quiet pint." Framing the quieter, more moderate choice as
  cowardly implies the heavier-drinking choice is the brave one, which is a
  direct read on 18.4 (drinking as a challenge / brave-tough-daring) and cuts
  against 18.1 (disparaging moderation nudges people toward the unwise style).
  It is graded RISK rather than VIOLATION and left for owner ruling for three
  reasons: it is explicitly designed copy in docs/VIBE_LAYER_SPEC_2026-07-19.md
  surface 3 (verbatim) and blessed in the binding TASTE DOCTRINE rule 6 as the
  humour-guard template; it is pinned by a hermetic test
  (__tests__/planVibeVotes.test.ts:119) with the exact string; and the jab fires
  across all vibes (a mitigant, though the worst case is exactly the bender vs
  quiet-pint drinking-volume contrast). Rewriting owner-blessed, spec-defined,
  test-pinned copy would relitigate a locked decision. **This is owner ruling #1.**
- **"On a bender" / "Get lit"** (the vibe chips) are HARD-CONSTRAINT owner-locked
  and were explicitly accepted by the owner on 2026-07-19 (VIBE_LAYER_SPEC owner
  decision 4) with the App Store 1.4.3 excess-drinking risk put to the owner and
  accepted; the pre-approved Apple fallback is "Big one tonight". "Bender" is
  literally an extended drinking session (18.1 immoderate/prolonged) and "get
  lit" is slang for getting drunk (18.1, and youth-register adjacent under
  18.14). The user-voice doctrine ("a chip is the user declaring their night,
  never the brand speaking") is a genuine defence, but note the ASA judges the
  overall impression and does not always accept a "the user said it" frame when
  the app authored the option. Recorded, not changed.
- **"Order one more"** (last-train card, also the "One more by the platform"
  eyebrow at LastTrainCard.tsx:539) is the brand instructing another drink, but
  the whole feature is a get-home decision ladder that escalates to "Half pint
  only" then "Settle up now" then "Train risk tonight" as the last train nears;
  that responsible gradient is a strong defence, and the file is a frictionVoice
  fence surface. Graded RISK, left as is.
- **The Chaos Score** (lib/chaosScore.ts) is a 0-100 gamified rating of a night
  with an ascending grade taxonomy: Quiet, Steady, Lively, "Unhinged"
  ("Somebody's phone has evidence."), "Legendary" ("Absolute scenes."), plus a
  "Share the chaos" button (app/crawls/[slug]/page.tsx:221) and a "Cheap chaos"
  route pack (lib/routePacks.ts:73). A mechanic that awards a higher score for a
  later, longer, more-varied night, badged "Unhinged/Legendary", reads as
  celebrating immoderate drinking as an achievement (18.1), and the "Unhinged"
  one-liner "Somebody's phone has evidence." specifically implies memory
  loss/blackout, which is close to CAP's drinking-to-get-drunk red line. This is
  arguably the single largest systematic 18.1 exposure in the product. It is
  graded RISK-HIGH and left for owner ruling, not unilaterally rewritten, because:
  the score is computed from stop count, price spread, lateness and borough hops,
  NOT alcohol units (a real defence, though the copy connotes drunkenness); it is
  a PRD-designed feature ("The Spill" / The Lock-In, issue #30) with its own
  hermetic tests (__tests__/chaosScore.test.ts, crawlStoryStore.test.ts); and
  rewording an entire feature's grade taxonomy is a redesign-adjacent decision,
  which this lane's scope explicitly excludes. **This is owner ruling #2.**
- **Youth-audience design intent** (not user-facing copy, flagged under 18.14):
  lib/viewMode.ts:2-7 describes the default "Lock-In" mode as "the default for
  new/young users ... chaos-forward". Pointing the chaos-forward surface at
  "young users" by default, combined with the TikTok growth channel (U4), is an
  under-18-appeal posture worth an owner/legal note even though no rendered
  string is at fault.

## 4. Banned / safe phrase list (frictionVoice-fence style)

Written to mirror __tests__/frictionVoice.test.ts so it can become a fence
later (see section 5). Not yet enforced by CI. Register-surface carve-out
matches the taste doctrine: slang lives only in user-voice chip/preset/push
modules; everything below is about the BRAND voice on any surface.

Banned in brand-voice copy (encourage/immoderate/bravado/drink-drive):

```
"one for the road"        // drink-driving idiom (18.1)
"down it"                 // rapid intake (18.1)
"neck it" / "necking"     // rapid intake (18.1) - NB "Neck Oil" brand name is exempt (18.9)
"sink a" / "sink some"    // volume framing (18.1)
"get them in"             // round pressure (18.1)
"smash a few" / "get smashed" / "hammered" / "wasted" / "plastered"  // drunkenness (18.1)
"messy" (as a night)      // anti-social/immoderate (18.1/18.4)
"carnage" / "write-off"   // immoderate (18.1)
"unhinged" / "absolute scenes" / "somebody's phone has evidence"  // 18.1/18.4 blackout-excess - CONTESTED, owner ruling #2 (Chaos Score)
"drink to forget" / "cure the boredom"  // 18.6
"liquid courage" / "gives you confidence"  // 18.2
"the night needs it" / "makes the night"   // 18.3
"coward" (for the moderate choice)  // 18.4 bravado - CONTESTED, owner ruling #1
```

Under-18 register already CI-fenced by the vibe layer (killed terms):

```
"turnt", "no cap", "fr", "bussin", "real ones"   // 18.14 - enforced in vibeChips VIBE_KILLED_TERMS
```

Safe register pool (sanctioned, keep): on the lash, sesh, cheeky pint, big one,
quiet one, get a round in, kicking off, get lit, date night. These live only in
the user-voice chip/preset/push surfaces per the taste doctrine, and section 18
allows drinking to be shown as sociable (18.3 carve-out). They are exposed but
owner-sanctioned; the audit does not touch them.

Safe brand-voice patterns (the mitigants that make PUBMAXX defensible, keep them
loud): "never by how much you drank" (ASO), "the pub as a third place, not a
leaderboard" (ASO), the last-train / get-home framing everywhere, "the low/no
option", every price/ABV shown as sourced fact (18.9), and the honest empty
lines. These are the app's responsible-drinking spine and are the reason most
register reads as defensible rather than a breach.

## 5. Proposed CI fences (NOT added here; proposals only)

The task forbids adding new fences in this lane. Proposed for a follow-up lane,
owner to approve:

1. **Brand-voice banned-phrase fence.** A hermetic test in the frictionVoice
   style that reads the source of brand-voice surfaces (layout metadata, og.png,
   plan-card, weeklyDigest, todayBrief, notifications, landing) and asserts none
   of the section-4 banned phrases appear. Must exempt the user-voice modules
   (vibeChips, vibeTally, PalChat presets, push copy) and the "Neck Oil" brand
   name. This would have caught "One for the road" automatically.
2. **"one for the road" specific pin** on lib/weeklyDigest.ts, cheap regression
   guard for the fix in this lane.
3. **Coward-line decision, then a pin.** If the owner keeps "coward", add a
   comment recording the 18.4 acceptance next to the string (mirror of the
   VIBE_LAYER_SPEC owner-override pattern) so the risk is documented at the
   source, not just here. If the owner changes it, update
   __tests__/planVibeVotes.test.ts:119 in that lane.
4. **Responsible-drinking presence check** (once the owner decides to add such a
   line): assert an age/responsible line renders on the store surface.

Do not weaken __tests__/frictionVoice.test.ts; it is the spec for the friction
register and this audit treats it as load-bearing.

## 6. Owner rulings required

1. **The "coward" tally jab** (lib/vibeTally.ts:77). Keep (accept the 18.4/18.1
   exposure, as with the bender chip) or soften. It is the app's own voice, not
   the user's, which is what makes it the most exposed single string. If kept,
   document the acceptance at the source per proposal 5.3.
2. **The Chaos Score taxonomy** (lib/chaosScore.ts): the "Unhinged" /
   "Legendary" grades and the "Somebody's phone has evidence." / "Absolute
   scenes." one-liners, plus "Share the chaos" and the "Cheap chaos" pack. This
   is a systematic gamification of the bigger/messier night and the strongest
   18.1 exposure in the product. Keep, soften the copy while keeping the
   mechanic, or gate it harder. Owner decision because it is a PRD feature with
   tests and rewording is redesign-adjacent (out of this lane's scope).
   **IMPLEMENTED, PENDING OWNER MERGE (2026-07-21, lane/cap-compliance-floor).**
   Softened the copy while keeping the mechanic and data shape untouched: the
   grade taxonomy now grounds a high score in the NIGHT (detours, stops, borough
   hops) rather than intoxication. Grade "Unhinged" → "Saga"; one-liner
   "Somebody's phone has evidence." → "You took the scenic route."; one-liner
   "Absolute scenes." → "One for the group chat." (grade "Legendary" kept, per
   owner note that a night may be Legendary if the copy is grounded in what
   happened). "Share the chaos" and the "Cheap chaos" pack are the named
   feature/route-pack and were left as-is (the feature is kept). Held for owner
   review before merge.
3. **Responsible-drinking / age-affirmation line.** Decide whether the app
   should carry any such copy at all, and if so where (store listing, Pal
   creation, first run), and whether "Lock-In / chaos-forward as the default for
   young users" (lib/viewMode.ts) should change, before the TikTok channel opens
   (18.14/18.15, U4).
   **PARTLY IMPLEMENTED, PENDING OWNER MERGE (2026-07-21,
   lane/cap-compliance-floor).** Added one quiet, permanent floor line to the
   site footer (LandingPage) and the You surface (/u/[handle]): "PUBMAXX is for
   over-18s. Drink responsibly, know the facts at drinkaware.co.uk." No banners,
   interstitials, or nags anywhere else. STILL OPEN for the owner: whether the
   line should also appear on other first-run surfaces (Pal creation), and the
   bigger product decision of whether "Lock-In / chaos-forward as the default for
   young users" (lib/viewMode.ts) should change — that default was deliberately
   NOT touched in this lane.
4. **"On a bender" / "Get lit"** are already owner-accepted (VIBE_LAYER_SPEC
   decision 4); recorded here only so the acceptance is visible in the compliance
   trail. No new decision needed unless Apple review bounces "On a bender" (the
   "Big one tonight" fallback is pre-approved).

## 7. Change log (this lane)

Removed the "one for the road" drink-driving idiom (18.1) from all three
brand-voice surfaces; no behaviour change on any of them.

- lib/weeklyDigest.ts:426 (HTML header) "One for the road" to "Worth
  remembering".
- lib/weeklyDigest.ts:508 (plain-text header) "ONE FOR THE ROAD" to "WORTH
  REMEMBERING".
- app/today/TodayClient.tsx:250 (page lede) "and one for the road." to "and one
  to remember."
- __tests__/weeklyDigest.test.ts:283: assertion updated to match the new header.
- docs/digest-samples/*.html and *.txt: regenerated via WRITE_DIGEST_FIXTURES=1
  so the committed fixtures stay byte-identical to the builder output.

No vibe chips touched; the "coward" line, Chaos Score, and register chips are
recorded above and left for owner ruling, not changed.

### Follow-up lane: owner rulings 2 and 3 (2026-07-21, lane/cap-compliance-floor)

Implements owner rulings 2 and 3 above. Held for explicit owner review before
merge (product-policy surface). No behaviour change; the Chaos Score mechanic,
its inputs, and its data shape are untouched. All before/after pairs:

- lib/chaosScore.ts: grade "Unhinged" → "Saga".
- lib/chaosScore.ts: one-liner "Somebody's phone has evidence." → "You took the
  scenic route." (removes the 18.1/18.4 blackout-adjacency read).
- lib/chaosScore.ts: one-liner "Absolute scenes." → "One for the group chat."
  (grade "Legendary" kept; the line is now grounded in the shared memory, not
  the drinking).
- app/u/[handle]/page.tsx + components/landing/LandingPage.tsx: added the floor
  line "PUBMAXX is for over-18s. Drink responsibly, know the facts at
  drinkaware.co.uk." (was: no responsible/age line anywhere — the structural gap
  named in section 1).
- Pinned-copy assertions updated to match: __tests__/chaosScore.test.ts,
  __tests__/chaosCardParams.test.ts. Added a chaos-taxonomy fence in
  __tests__/chaosScore.test.ts (proposal 5.1, scoped to the band table) pinning
  the blackout/excess register absent from every grade and one-liner.

Deliberately NOT changed (recorded, out of this lane): the "Cheap chaos" route
pack and the "Share the chaos" button (named feature/route pack, feature kept);
the "coward" tally jab (owner ruling 1, still pending); the vibe chips; and
lib/viewMode.ts's chaos-forward default for young users (the bigger product
decision under owner ruling 3, still open).

## 8. Out-of-scope note for the data lane

One non-CAP note for the voice lane: app/opengraph-image.tsx:120 renders "Side
quests" in an OG tagline. The frictionVoice fence bans "side quest" but pins it
absent only on its listed surfaces, and opengraph-image.tsx is not one of them,
so the gamer register leaks there. That is a voice-spec issue, not a section-18
issue, so it is out of this audit's scope and left for the voice lane; noted here
only because the sweep found it.

Scraped venue offer/menu text carries third-party alcohol-marketing register
(e.g. "sunny day sesh", "get messy") in public/data/pubmaxxing_seed_snapshot.json
and public/data/food_price_updates/*.json. This is other companies' copy shown as
data, not PUBMAXX marketing communications, so it is not a PUBMAXX section-18
liability in the same way and is not fixable in a copy lane. It is flagged for the
data/ingest lane only: if the app ever re-presents that text as its own editorial
voice (a headline, a push, a card caption rather than a sourced quote), it would
re-enter section-18 scope.
</content>
