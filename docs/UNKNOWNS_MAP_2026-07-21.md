# PUBMAXX UNKNOWNS MAP (2026-07-21)

Applying the map-vs-territory unknowns framework (Thariq, "A Field Guide to Fable: Finding Your Unknowns") to PUBMAXX. The wayfinder map (docs/WAYFINDER_PRODUCT_MAP_2026-07-20.md) is the map; the territory is real London users, real venues, real law, and a real brand landscape. This file lists the gaps between them, ranked by how much a wrong guess costs.

Frame: Known Knowns = the wayfinder itself. Known Unknowns = the gates we already defined (activation baseline, WTP, store review). This doc is the other two quadrants: Unknown Knowns (things Karan would recognize instantly but has never written down) and Unknown Unknowns (things not on the map at all).

## Tier 1: could invalidate the roadmap (investigate before Wave 2 exit)

### U1. Brand collision: pubmaxxing.co.uk already exists (RESOLVED 2026-07-21)
Original worry: SERP showed pubmaxxing.co.uk as an apparent B2B consulting competitor. The legal lane (PR #464, docs/LEGAL_UNKNOWNS_2026-07-21.md) found the "consulting" text was a stale GoDaddy meta-description on a placeholder page, registered the same day as the .com. ANSWER: owner confirmed via GoDaddy on 2026-07-21 that he owns pubmaxxing.co.uk himself. No collision. Remaining follow-ups: 301-redirect the .co.uk to pubmaxxing.com (kills the stale SERP entry that started this scare), keep both renewals active, and the trademark question stands on its own merits per the memo (filing is cheap insurance while the mark is unregistered; see memo's owner action list).

### U2. The word "pubmaxxing" is going generic (unknown unknown)
The SERP's AI Overview defines pubmaxxing as internet slang; TikTok/LinkedIn/Instagram content outranks the product; a @pubmaxxing TikTok account exists that is NOT ours ("@LADbible hate page"). The brand is riding a meme it does not own. Unknowns: can we rank #1 for our own name; is the trend a tailwind (free category education) or a headwind (genericide, no distinctive mark); what happens to the name when the meme dies. Cheap probes: track SERP position weekly, claim/verify social handles now, decide whether the store listing leans on the word or on "London pub nights" (docs/ASO.md already hedges this).

### U3. Online Safety Act 2023 duties (unknown unknown, legal)
PUBMAXX with DMs + feed + user content is a user-to-user service under the OSA. That triggers duties: illegal-content risk assessment, children's access assessment, proportionate moderation, complaints routes. Wave 6 compliance floor covers GDPR-style export/erasure but the map never names OSA. Small services get proportionality, but the risk assessments are still required paperwork and shape blocking/reporting design (Wave 6.5, 6.10). Unknown: what the proportionate floor actually is for our size. One focused legal-research pass before social gates open; feed the output into ticket 6.1.

### U4. Alcohol marketing rules constrain copy and features (unknown unknown)
UK CAP Code section 18: marketing must not encourage excessive drinking, must not link alcohol with social success, must not appeal to under-18s. The product's voice ("On a bender", vibe chips, coward jab) lives close to this line. The taste doctrine ("never pro-drinking-more") is instinct, not compliance review. Store review already worried us once (fallback "Big one tonight" pre-approved). Unknowns: does the vibe register survive an ASA complaint; do age gates need to be earlier than Pal creation; does the TikTok growth channel (alcohol-adjacent content to unknown-age audiences) create exposure. Cheap probe: one CAP-code read-through of every product copy surface + the growth asset templates; produces a banned/safe list like the register fence.

### U5. Planning vs spontaneity: does the core job exist at frequency? (known unknown, sharpened)
The whole loop bets that London pub nights are PLANNED. Much real behavior is habitual (same local) or spontaneous (one text, nearest pub). Wave 2's gate measures acceptance of generated plans by people who arrive; it does not tell us how often the planning job occurs per user per month, or who has it (organizers of 6+ person nights? tourists? daters?). If the job is monthly, retention design (daily brief) is carrying the product alone. Unknown known to extract from Karan: who exactly is the first 100-user cohort and which of the three modes (Decide/Explore/Contribute) they actually live in. Probe: 10 user interviews before Wave 3 cohorts; instrument plan-job frequency per claimed account from day one (0.5 registry already supports it).

## Tier 2: could invalidate a wave (investigate before that wave starts)

### U6. Guest-to-member conversion is the real growth engine and it is unmeasured (growth)
Journey: host plans, crew joins via invite link without accounts. The k-factor lives entirely in whether guests convert to hosts of their own nights. Wave 4 gating (one collab trial per User ID) throttles exactly this loop; Wave 6 gates collaboration behind Membership. Growth wants the loop free; revenue gates it. The map records the tension nowhere. Unknowns: invite acceptance rate, guest claim rate, guest-to-host rate, time-to-second-night. All four need events in the 0.5 registry BEFORE Wave 4 so the trial-gating decision is made on data.

### U7. Night-of context is hostile and undesigned-for (unknown known, journey)
The user at stop 2 of 3 is outdoors, dark, cold hands, 15% battery, basement signal, three pints in. Every flow assumes a calm reader. Offline outbox (4.4) covers data; nothing covers UX: giant-tap night mode, glanceable next-stop card, screen-off resilience, one-thumb everything. Karan knows exactly what this should feel like (he goes to pubs); it has never been written down. Probe: one prototype pass (per the article: brainstorm/prototype for unknown knowns) — three HTML mockups of the mid-crawl surface, pick by eye, then spec it.

### U8. Push is the retention spine and web push on iOS is weak (growth/platform)
The daily-brief habit assumes push lands. iOS web push needs home-screen install first (A2HS rate unknown), permission grant rates unknown, and Actions crons are still dead so briefs are hand-sent. The habit loop currently has no reliable transport. Unknowns: A2HS rate, grant rate, brief open rate. If all three are low, retention strategy must shift (email? native app sooner?). The 0.5 events + Lane B sender make this measurable in week one; add the three numbers to the Wave 2 exit review.

### U9. Venue content rights (legal, data)
CSP img-src allowlists brand CDNs (jdwetherspoon.com, greeneking.co.uk, tripadvisor CDN, wixstatic): we hotlink venue/brand imagery we do not license. Price listings themselves are fine (facts), but images and scraped descriptions carry IP and ToS exposure, and hotlinking breaks silently when CDNs add referer checks. Unknowns: which image sources are actually licensed/safe, what the takedown posture is. Probe: image-source audit ticket; prefer own photography/Wikimedia/venue-submitted (the Wave 3.5 operator rail becomes the licensing fix).

### U10. Two-sided dynamics arrive whether invited or not (product)
Wave 3.5 treats venues as data proposers. Territory: the moment traffic is visible, pubs will want ranking influence, event promotion, and complaints about price data ("that offer ended"). One angry Wetherspoon email is a plausible week-one event. Unknowns: complaint/correction SLA, dispute posture when a venue disputes a sourced fact, whether "payment never changes ranking" survives the first sponsorship conversation. The invariants exist (3.6); the operational playbook does not. Cheap: one page in the ops console spec.

### U11. Winter (product)
Launch is July. The product's imagery, drink-weather table, and outdoor-crawl assumptions are summer-tuned. Pub demand shifts indoors, daylight ends at 4pm, crawls shorten. Unknown: whether Tonight/Plan ranking degrade gracefully in November. Probe: seasonal review ticket scheduled for September, plus make drinkWeather's winter rows real now (fireplace refusal already exists; cold-weather positive cases unverified).

## Tier 3: named so they stop being unknowns (watch, cheap probes only)

- **U12. Social OAuth dashboards still unconfigured** (owner item). Email magic
  link and account onboarding are complete, so social setup no longer blocks
  account activation. Google and Apple remain disabled in production; Apple
  activation needs a paid developer account. `docs/DEPLOYMENT.md` owns current
  provider state and setup.
- **U13. Membership price anchor**: annual-only for social features has few UK comparables. WTP research (6.2) is planned; add one question on annual-vs-monthly aversion.
- **U14. Multi-party consent friction** (Wave 5): loop-depth metric may flatline on friction, not disinterest. Instrument consent-step drop-off separately so the two are distinguishable.
- **U15. Moderation load at small scale**: one owner, no moderators; risk-tiered queues (6.10) assume staffing that does not exist. Define the solo-operator emergency path (freeze surface, not review queue).
- **U16. Data cost curve**: scraping credits + manual refreshes per fresh fact; unit cost unknown. Log credit burn per ingest run (Lane E) so the number exists.
- **U17. Seed cities temptation**: lib/cities seeds (oxford/manchester/glasgow) invite scope creep against the city-two gate. Fence exists on paper; watch it.

## Method going forward (from the article, house-adapted)

1. **Blind-spot pass per wave entry**: before each wave starts, one agent pass answering "what does this wave assume that nobody verified" — the output amends this file.
2. **Interview the owner**: highest-leverage next step is a one-question-at-a-time grilling on U1, U4, U5, U6 — the four where Karan's answer changes the map. (Grilling skill exists; this is its job.)
3. **Prototype for unknown knowns**: U7 mid-crawl surface, three throwaway mockups before any spec.
4. **References over prose**: for Membership pricing and consent UX, pull 3 comparable products each (references beat description).
5. **Implementation notes**: lanes already keep handoffs; add "deviations from plan" as a required section (Sol's sol_execution.md already does this well — make it the template).
6. **This file is living**: every closed unknown gets its answer recorded inline, dated. An unknown with no probe and no owner is just anxiety; every entry above names its probe.
