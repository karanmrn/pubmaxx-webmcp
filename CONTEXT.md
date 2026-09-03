# PUBMAXX

PUBMAXX helps people discover pubs and plan pub crawls using pint prices, location, and venue context.

## Language

### Brand Language

**PUBMAXX**:
The canonical name of the brand and the cultural movement. The double `xx` is inseparable from the name in every form. Share cards and the document title suffix carry this name.
_Avoid_: PubMax, Pub Max, PubMaxing

**PUBMAXXING**:
The name of the app itself, in capitals. Install titles, the manifest name, and in-app page titles carry this name. `lib/brandNaming.ts` owns both names.
_Avoid_: PUBMAXXING as the brand in metadata `siteName`, two brand names in one document title

**Pubmaxxing**:
The activity of intentionally discovering and experiencing a night out through PUBMAXX.
_Avoid_: Pubmaxing, pub crawling when referring to the broader culture

**Pubmaxxer**:
A person who participates in Pubmaxxing and belongs to the PUBMAXX community.
_Avoid_: Pubmaxer, customer, drinker when referring to community identity

**PUBMAXX User ID**:
The immutable account-owned identity behind a Pubmaxxer's public handle. Ownership, moderation, authorship, and consent attach to this ID even when the handle changes.
_Avoid_: Device handle, email address as public identity, mutable handle as database ownership key

**PUBMAXX Handle**:
The unique, case-insensitive `@name` a Pubmaxxer chooses for discovery and public links. It may change under the rename policy while the PUBMAXX User ID remains stable.
_Avoid_: Unverified contributor handle, social-provider username as canonical identity

**PUBMAXX Promise**:
The belief that drinking can be part of intentional social exploration: creating moments, making friends, collecting memories, and following side quests through the world. A great experience is measured by the life around the drink, never by alcohol quantity.
_Avoid_: Consumption challenge, drinking competition, alcohol quantity as achievement

**PUBMAXX Stance**:
Pro-experience, pro-connection, and pro-choice without pressure or excess. PUBMAXX celebrates intentional adult drinking while neither claiming alcohol is harmless nor treating consumption as the purpose of the experience.
_Avoid_: Pro-excess messaging, alcohol-is-harmless claims, moralising about a person's choice to drink or abstain

**PUBMAXX Worldview**:
Playfully anti-capitalist and operationally pro-joy. PUBMAXX responds to rising costs, repetitive routines, and a life reduced to work and consumption with affordable exploration, humour, friendship, and memorable real-world experiences.
_Avoid_: Partisan manifesto, luxury nightlife gatekeeping, despair without a joyful action

**Venue**:
A place a user may visit during a crawl, such as a pub, bar, or restaurant-bar.
_Avoid_: Place, location, pub when the concept includes non-pub venues

**Pint Price**:
The observed price of a named pint at a venue.
_Avoid_: Drink cost, beer price

**Crawl Route**:
An ordered plan of venues for a user to visit in one outing.
_Avoid_: Itinerary, trip, journey

**Crawl Stop**:
One venue within a crawl route.
_Avoid_: Step, waypoint

**Home Area**:
The area a user starts from or cares about when discovering nearby crawl routes.
_Avoid_: Location, base, neighbourhood

**Visited Venue**:
A venue the user marks as having been to.
_Avoid_: Pin, check-in

**Venue Dataset**:
The source collection of venues, pint prices, map coordinates, and venue attributes used by the app.
_Avoid_: Scrape, CSV, data dump

**Crawl Preference**:
A user's chosen intent for a crawl route, such as cheap pints, historic venues, beautiful interiors, beer gardens, live sports, or friend-recommended stops.
_Avoid_: Filter, setting

**Crawl Score**:
The app's combined judgement of how well a crawl route matches the user's crawl preference.
_Avoid_: Ranking, rating

**Transport Mode**:
The way a user expects to move between crawl stops, currently walking or tube.
_Avoid_: Travel type, commute method

**Route Window**:
The maximum travel time a user is willing to spend between crawl stops or across a crawl route.
_Avoid_: Radius, distance limit

**Venue Heritage**:
The historical, architectural, cultural, or visual story that makes a venue interesting beyond price.
_Avoid_: History, beauty

**Visit Report**:
A short, contributor-attributed account anchored to a dated venue visit. It records only what the contributor observed, such as crowd, noise, seating, bar wait, and one brief note. It is never a star rating, aggregate verdict, or verified venue fact.
_Avoid_: Review, rating, score, check-in, verified fact

**Occupancy**:
A now reading of seats at a pub (Empty / Some seats / Full). Same three-point scale as Visit Report busyness (quiet / steady / rammed) in the present tense. Only a report under 90 minutes old may answer now.
_Avoid_: Rating, live count, capacity, queue length

**Beer Quality**:
The user's judgement of how good a specific beer or pint was during a venue visit.
_Avoid_: Taste, drink score

**Amenity**:
A venue feature that affects crawl choice, such as beer garden, live sports, live music, darts, pool, food, or cocktails.
_Avoid_: Facility, feature

**Recommendation**:
A short, attributed opinion from a Pubmaxxer that a venue suits one condition from the product's weather vocabulary. It is neither a review nor a verified fact about the venue.
_Avoid_: Computed suggestion, review, venue fact, score

**Suggested Venue**:
A venue surfaced by product logic from current conditions, preferences, or other known signals. It has no human author and is never presented as a Recommendation.
_Avoid_: Recommendation, user tip

**Pint Drop**:
A single community Night Moment attached to a Venue. It must carry an observed Pint Price or a Passed-Down Note and can add a pint or venue photo. It is separate from a Visit Report and is never the generic name for a Social Post.
_Avoid_: Social Post, check-in, upload

**Passed-Down Note**:
A short piece of personal or inherited knowledge about a venue — a memory from childhood, a story handed down from family, or local lore — tagged with the era it belongs to. The generational-bridge content, distinct from a rating.
_Avoid_: Review, comment, caption

**Provenance**:
Where a piece of venue knowledge came from, and how much it can be trusted. Every heritage or price claim is one of: Sourced (editorial, with a source link), Contributor (a user's Pint Drop), Anecdote (an unverifiable Passed-Down Note), or Community (a signed-in, handle-attributed dated price logged at the bar, shown on its own dated, badged row and never overwriting the price on record). Only legacy rows without a handle remain anonymous. Provenance is always shown; it is never flattened away.
_Avoid_: Source (bare), reliability, trust score

**Contributor Handle**:
The public PUBMAXX Handle attached to an authenticated account and its immutable PUBMAXX User ID. Contributions use account ownership as their identity boundary; a handle is never accepted as authorship merely because a client typed it.
_Avoid_: Self-declared name, email address, session token presented as contributor identity

**Private Account Identity**:
The required date of birth and optional full name and sex attached to an authenticated account at signup. PUBMAXX stores all three privately for product analytics and social features, does not derive contribution eligibility from them, and does not block accounts or contributions by age. The Handle remains the only public identity. Visit Reports and Recommendations remain identity follow-up work.
_Avoid_: Public age, public date of birth, age eligibility

**Superseded Round Line**:
An earlier Round price line whose community-price ownership was successfully replaced by a later line from the same account for the same venue and drink category. It stays in the Round diary but no longer claims current status; a failed replacement leaves the existing owner unchanged.
_Avoid_: Diary-only line, promoted line

**Production Store**:
The durable Supabase database and Storage bucket used for production Pint Drops, photos, and heritage cache data. Distinct from the in-memory demo store used when local credentials are absent.
_Avoid_: Backend (bare), database (when photos are included)

**Storage Object**:
A photo file saved in Supabase Storage and referenced from a Pint Drop by object key. The database stores the key, not an inline image or committed file.
_Avoid_: Image URL (when referring to the persisted record), blob

**Hidden Pint Drop**:
A Pint Drop removed from public reads after a report or moderation decision, while still retained for review.
_Avoid_: Deleted post, banned review

**Night Area**:
A curated public destination district used to plan a night, such as Clapham or Chiswick. Distinct from a user's private Home Area.
_Avoid_: Home Area, borough, neighbourhood when referring to the curated product boundary

**Daypart**:
The time-sensitive planning mode that changes recommendation weighting without changing Night Area geography: Daytime, After Work, Evening, Late Night, or Get Home.
_Avoid_: Session, opening period

**Night Context**:
The visible, editable set of inferred planning needs: Night Area, Daypart, party type, group size, budget, atmosphere, food, accessibility, and transport constraints.
_Avoid_: Hidden profile, prompt metadata

**Planned Night**:
A Crawl Route with a lifecycle from draft through completion, including explicit Crawl Stop actions and a Crawl Ending.
_Avoid_: Session, trip

**Night Memory**:
A private, user-owned record of a lived Pubmaxxing experience, including the people, places, drinks, events, images, and moments its participants choose to preserve. It remains private unless its owner deliberately shares it.
_Avoid_: Automatic public post, tracking history, Pal Memory

**Night Story**:
The deliberately published social expression of a Night Memory and the primary social object in PUBMAXX. A host shapes the narrative, while every contributor controls publication of their own Night Moments, tags, and likeness.
_Avoid_: Night Memory, automatic activity feed, unreviewed archive

**Social Post**:
A verified-adult Social message with text, an optional private Photo, an optional Night Area, and an optional exact Venue. It stays held until moderation approves its current revision. Exact Venue is visible only to its author and current Mutuals.
_Avoid_: Night Story, public venue fact, unmoderated draft

**Photo Tag Proposal**:
A request to show another Pubmaxxer&rsquo;s current handle on one Social Post photo. It becomes visible only after that person approves it, and they can withdraw approval later.
_Avoid_: Face recognition, automatic tag, permanent consent

**Social Draft**:
An unfinished Social Post stored only on the author&rsquo;s device. It is not a Social Post and is not sent for moderation until submission.
_Avoid_: Published post, server outbox, shared draft

**Night Moment**:
A single shareable part of a Night Story, such as a photo, drink, event, venue, quote, person, or Side Quest. Night Moments belong to the wider story even when shared independently.
_Avoid_: Generic post, unrelated content, complete Night Memory

**Social Post**:
A verified-adult-authored item in Social with author-selected visibility and comment policy. It stays out of reads until moderation approves it and never carries venue or price authority.
_Avoid_: Pint Drop, Night Moment, venue fact, price observation

**Connected Social Account**:
An optional X, Instagram, or TikTok profile a Pubmaxxer links through a compliant provider flow or explicit public link. Provider-approved capabilities may include display, consented discovery, and user-confirmed publishing. Connection proves control of that external account at connection time, not the person's identity, age, or trustworthiness.
_Avoid_: Verified person, provider account as PUBMAXX identity, password capture, browser automation, silent cross-posting

**Social Provider Capability**:
The reviewed set of actions PUBMAXX may offer for one connected provider: public profile link, compliant connection, consented friend discovery, permitted publishing, and native-share fallback. Capabilities are shown honestly per provider and may remain Preview until approved and certified.
_Avoid_: Assumed API parity, scraped friend graph, hidden permission expansion

**Crawl Ending**:
The user's explicit choice after a Crawl Route: Food, Get Home, or Keep Going.
_Avoid_: Conversion, exit state

**Pub Pal**:
A user-owned digital companion that combines a customizable cyber familiar, planning assistance, optional voice, confirmed structured memory, and cosmetic nightlife-mastery progression. Every Pub Pal uses the same factual, recommendation, price, moderation, and safety engine.
_Avoid_: Independent recommender, drinking-pressure mechanic, source-of-truth narrator

**Night Signal**:
A non-humanoid atmospheric visual system for one of six drink worlds—Beer, Gin, Rum, Whisky, Brandy, or Vodka—expressed through spatial light, translucent materials, glassware, particles, and purposeful motion. Selecting one changes atmosphere and cosmetics; it becomes a planning preference only after explicit confirmation.
_Avoid_: Humanoid guide, cyberpunk person, drink filter, real person, Pub Pal

**Pal Memory**:
A typed preference, correction, or completed-night outcome that the user has explicitly approved. Raw voice audio, transcripts, and generated character prose are never Pal Memory.
_Avoid_: Chat history, inferred profile, hidden memory

**Voice Session Grant**:
A short-lived, server-issued credential that lets an authenticated adult start a user-initiated Pub Pal voice session without exposing the provider API key. It carries an expiry, allowance, connection type, privacy mode, and propose-then-confirm mutation policy.
_Avoid_: ElevenLabs API key in the browser, always-listening session, durable transcript

**Nightlife Mastery**:
Cosmetic progression earned through planning, discovery, verified contribution, heritage learning, crew coordination, and completed-night capture. Alcohol quantity never contributes.
_Avoid_: Drinking streak, consumption score, recommendation tier
