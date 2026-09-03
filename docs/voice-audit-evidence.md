# Voice audit evidence

This file records evidence for a partial copy pass against `docs/VOICE.md`. It covers claim-shaped copy changed between `c1b5566df425a84a3fc90f76bd7220e301ee54d1` and this branch, plus indirect user-facing string owners inspected so far. It does not claim product-wide coverage.

## Claim guarantees

Repeated variants are grouped only when they make the same claim and read from the same guarantee.

Absolute copy is kept only when a named code or data invariant enforces it. Otherwise the wording states the known result or capability without a universal or unsupported cause. This rule was applied to every product string changed on this branch.

| Changed claim-shaped copy | Surface | Exact guarantee |
| --- | --- | --- |
| “one sourced fact each”; “cited pub heritage”; “Listed prices name their sources, and cited pub stories link to their references”; “Cited history”; “Cited from Wikipedia” | About, historic pubs, crawls, discovery | Heritage guarantees remain backed by `lib/aboutStats.ts`, `lib/heritageCrawls.ts`, and each rendered fact's citation fields. A price row supports a named publisher only when its own `pub_url` carries one; otherwise [`docs/VOICE.md`](./VOICE.md) requires explicit publisher-not-recorded copy. |
| “Listed pint prices with named sources”; “Listed pint prices on PUBMAXX”; “Listed pint prices on an interactive map” | About, map card, landing, onboarding | `VenuePrice.pub_url` supports a named link only when present. Community rows carry contributor attribution. Rows without a publisher URL support only the explicit publisher-not-recorded state owned by [`docs/VOICE.md`](./VOICE.md), never a blanket named-source claim. |
| “Nobody pays to rank”; “The order of pubs on your map is never for sale”; “sponsored items sit in their own labelled slots” | About, terms | Map and list ranking functions consume venue, price, distance, filter, and community-signal inputs, not payment fields. Sponsored content uses separately labelled slots rather than the venue ranking pipeline. |
| “Rewards and rankings do not count how much you drink” | About | No reward or ranking input counts alcohol units; Round totals record spend only under `lib/rounds.ts`. |
| “No account needed to look”; “Free to browse”; “Browsing doesn’t need an account” | About, privacy, terms | Public map, venue, Today, Tonight, Near, crawl, historic, and Pint Index routes have no authentication gate. Contribution routes apply the account gate separately. |
| “Night Memories and private plans aren’t public unless you choose to share them” | Privacy | Memory and plan stores use private actor or member-token reads. Public exposure requires an explicit share artifact or share link. |
| “Choose a handle in your account first”; “Your public handle appears on every contribution”; account and profile contribution prompts | Check-ins, identity gates, activity, profile, We Are Out | `lib/contributionIdentity.server.ts` resolves the authenticated account, claimed handle, and completed private profile before current attributed contributions are accepted. |
| “Sign in and choose a handle to see follows, cheers, comments and crawl saves here” | Activity | `lib/notifications.ts` defines those four inbox event kinds. Copy describes what the inbox can show without promising that every best-effort notification write succeeds. |
| “Email sign-in works even when Google and Apple are unavailable” | Contribution gate | Email is an independent sign-in provider in the account flow; Google and Apple availability does not remove that route. |
| “Logging tonight’s price needs a signed-in account, a claimed handle and completed private profile” | Privacy, terms, contribution surfaces | `app/api/price-submit/route.ts` calls the shared contribution identity resolver before writing a current community price. |
| “one account can replace its own earlier entry”; “can’t confirm itself by changing devices or handles” | Privacy | `lib/communityPriceStore.ts` keys current contributor ownership to the stable profile actor, supersedes the actor’s earlier same-key row, and derives corroboration from independent actors. |
| “One report so far. It needs a second to move the map”; second independent drinker copy | Price submission, venue sheet, map legend | `lib/communityPrice.ts` defines the corroboration threshold and `components/map/communityPriceSignals.ts` admits only corroborated prices to price paint. |
| “It marks this pub’s pin straight away”; UK base pub “keeps only the dot” | Price submission, map legend | `provisionalCommunityPriceVenueIds` supplies the separate provisional mark seam; UK base GeoJSON only receives the provisional flag and never a price signal. |
| “Over 30 days old. This records that night, not tonight’s price” | Community price status | `MAX_COMMUNITY_PRICE_AGE_DAYS` and the freshness predicates in `lib/communityPrice.ts` exclude older reports from current map authority while retaining the dated record. |
| “It doesn’t set a food pin’s colour”; non-pub and selected-drink variants | Map legend | `mergeCommunityPriceSignals` and the map lens guards keep pint reports out of food, non-pub, and mismatched drink-category price bands. |
| “Other pub · no listed price”; split listed and other pub groups | Map list | Curated venues and UK base pubs remain separate datasets; base pub records have no price field. `components/map/MapVenueList.tsx` renders those groups separately. |
| “Lowest listed prices on record. Not necessarily tonight’s price”; “Not a live feed” | Discovery leaderboard | Rows derive from finite listed venue prices and sort by price. No live-price guarantee exists, so copy explicitly limits recency. |
| “Community prices logged in the last 24 hours, cheapest first” | Discover | The recent community lane filters contributor timestamps to its 24-hour window and sorts the retained prices ascending. |
| “Latest community-reported pint against the earlier price on record” | Discover then-and-now | `lib/thenVsNow.ts` selects the newest priced community drop and compares it with the venue baseline price. |
| “Compare listed pint prices near you, cheapest first”; Near result headings | Near | `lib/nearMeAnswer.ts` admits venues with finite positive listed `cheapestPrice` values and orders them by price, then distance. Copy makes no quality or per-price date claim. |
| “Keeps this pub for tonight …” | Near acceptance receipt | `acceptNearVenue` receives the selected `venueId`, active area, and `startsAt: null` from `components/nearme/NearMeNow.tsx`. The receipt no longer assigns the shared dataset month to an individual price. |
| “Lowest listed prices in central London”; Today collection date | Today | `app/today/todayPints.ts` reads listed venue prices for the central fallback. `PINT_DATASET_OBSERVED_AT` comes from the freshness registry and dates the bundled dataset, not each row. |
| “What’s on … from sourced listings”; quiz, sport, deals, and live music | Tonight, CityMCP listings | `lib/concierge/whatsOn.ts` returns only listing records with their source metadata; Tonight renders those returned kinds and source links. |
| “Pub and event picks show their source” | Pal metadata and responses | `lib/palChat.ts` attaches directory provenance to venue cards and requires source provenance for What’s On cards before returning them. |
| “No sourced listings”; “Found … sourced listings” | Concierge and What’s On helpers | `lib/concierge/whatsOn.ts` filters and counts the sourced listing records returned for the requested kind, place, and time. |
| “Choose a listed city” | Concierge and plan API errors | City IDs are accepted only when `parseCityId` resolves them against the city registry. Copy names the product choice, not the request field. |
| “Listed pubs are available to browse and search in this city”; city-specific price and listing availability copy | City capability helpers | `lib/cityCapabilities.ts` owns each city’s closed capability record. Surfaces read its availability state and explanation rather than inferring support. |
| “We haven’t yet collected pint prices for this city”; transport help not ready | City capability helpers | The matching city capability is explicitly unavailable. Copy is limited to that registered absence and does not claim city-wide non-existence. |
| “Pubs, prices and stories by area”; crawl stop and route copy | Borough and crawl pages | Crawl records contain listed stop IDs; route resolution joins those stops to venue records carrying names, coordinates, prices, and stories. |
| Glasgow Subcrawl six-stop description | Glasgow curated crawl | `lib/cities/glasgow/curatedCrawls.ts` supplies six stop IDs, one for each named subway area. “folklore” is descriptive framing, not a live or measured claim. |
| Merchant City route description | Glasgow story band | The copy is limited to the named curated streets, pubs, and route context in `lib/cities/glasgow/storyBands.ts`; it makes no current availability claim. |
| “Listed offers and other deals” | Deals lane | Deal cards render listing records supplied by the sourced What’s On data path. “Listed” limits the claim to returned records. |
| “Seeded only where we’ve got demo data” | Discover | Demo cards render only when their seed collection contains entries. |
| “Hand-picked crawls” | Landing and crawl surfaces | Crawl packs are static curated records, not generated rankings. |
| “Choosing Brandy or Vodka changes this page’s mood only. It doesn’t create a hidden map filter.” | Landing | Those controls update landing presentation state only and do not write map query or lens state. |
| “We only use your location to rank pubs nearby. Nothing is stored.” | Near | Browser coordinates stay in component state and feed `rankNearMe`; no Near persistence or coordinate write is called. |
| Unsupported-area coverage copy | Near and coverage preview | The branch reads actual slim-index coverage and nearest supported patches. Copy says “lightly mapped”, “haven’t mapped”, or “don’t have priced pubs” only for the matching derived state. |
| “Your route needs a refresh”; accepted stop unchanged; Plan link status copy | Plan handoff and API | Route revision, accepted venue ID, and signed member-token checks in Plan route helpers select these messages. |
| “No three-stop route … meets every must-have need”; “Not enough listed pubs” | Plan generation | `app/api/plans/generate/route.ts` evaluates must-have constraints against route evidence and checks `chosen.length < 3` before returning either message. |
| Crawl-ready area warning copy | Plan generation | Reader wording is owned by [`docs/VOICE.md`](./VOICE.md); `app/api/plans/generate/route.ts` still checks active area warning state before route construction. |
| “Every stop is within the selected patch” | Plan route evidence | `lib/planRouteEvidence.ts` verifies each selected stop against the chosen patch boundary before emitting the message. |
| “Every stop has checked information for each access need at its visit time” | Plan route evidence | The evidence resolver requires a checked result for every required access constraint at every stop and visit time. |
| Group size did not shape order because capacity is unchecked | Plan route evidence | The route optimizer receives no checked capacity evidence and records that group size was not used as an ordering factor. |
| “Some prices are missing”; estimated per-person spend for one recorded pint per stop | Plan summary | Budget aggregation returns `estimatedPerPersonPence: null` when a stop price is missing; otherwise it sums one recorded pint price per stop. |
| Late-food checked count, unchecked closing times, extra-spend copy, and “no extra pub” empty state | Plan endings | `lib/planEndings.ts` derives option counts from resolved food records, carries schedule trust, includes spend only when a price exists, and selects the empty copy only when its supplied extension list is empty. It makes no claim about distance or why candidates were omitted. |
| “Live transport details were not checked or saved”; “Closing time was not checked” | Plan completion | Completion warnings are emitted when transport or schedule evidence is absent from the confirmed ending. |
| Crawl-ready area coverage copy and missing-detail warnings | Plan composer | Reader wording is owned by [`docs/VOICE.md`](./VOICE.md); `app/api/plans/generate/route.ts` returns `NIGHT_AREA_CONSTRAINT_BLOCKED` before route construction when an active area warning exists, while coverage helpers expose missing price and route fields. |
| “Referral rewards aren’t active”; milestones grant no paid features | Privacy, terms, account hub | Referral code stores private edges and milestones only. No entitlement or paid-feature grant reads those records. |
| Recommendation, Visit Report, contributor-count, and moderation claims | Privacy | The corresponding stores persist the stated fields, derive public counts from visible identity-backed rows, and hide rather than delete moderated rows. |
| Operator claims need approval before proposal tools open; proposals are reviewed before display | Operator tools | `components/operators/OperatorRailPanel.tsx` opens proposal tools only for `verified` claims; `app/api/operator-proposals/route.ts` repeats that gate and materialises a proposal only after admin acceptance. |
| Analytics off by default, remembered choice, one-tap Allow or No thanks | Privacy, terms, account hub | Consent state defaults unset; analytics load only after allow; the same preference store powers the prompt and account setting. |
| Analytics identifier, allow-listed events, proxy, and retention statements | Privacy, terms | Analytics client and server validation define the identifier and event schema; proxy route forwarding defines request metadata; configured processor retention values supply the stated periods. |
| No advertising or cross-site tracking cookies | Privacy | No ad network integration or advertising-cookie writer exists in the application; optional analytics is separately consent-gated. |
| Named processors and stored-data descriptions | Privacy | Supabase, Vercel, PostHog, Open-Meteo, TfL, MapTiler, and OpenRouter are the processors called by the named code paths; each description is limited to data sent on that path. |
| “Every current price names where it came from”; people-logged dates and dataset source date | Terms | Community rows carry their own `createdAt` and contributor attribution, and bundled rows share the freshness-registry date. A bundled row names a publisher only when its own `pub_url` carries one. The blanket named-source claim is not guaranteed; [`docs/VOICE.md`](./VOICE.md) owns the required publisher-not-recorded state. Historical rows remain separately labelled and excluded from current-price authority. |
| “The app comes as it is”; availability not promised | Terms | This is the legal service boundary, not a factual claim about current availability. |
| Pint Index includes only prices with public source and date | Live and archived Pint Index pages, metadata, JSON-LD | `lib/pintIndex.ts` eligibility requires source URL and observation date before an observation enters the live snapshot, CSV, or JSON-LD. |
| Older map-only prices stay out of the public Index | Pint Index | Live snapshot construction excludes legacy baseline rows; published editions read only frozen eligible observations. |
| Dataset coverage counts and borough rankings | Pint Index | `pubCount`, `boroughCount`, average, and dearest rows are derived from the eligible `PintIndexSnapshot`; captions say published or eligible rather than live. |
| “Prices seen” observation window | Pint Index | `snapshot.observationWindow.start` and `.end` are derived from eligible observation dates. |
| Borough assignment and unclassified points | Pint Index | The index uses versioned Greater London polygons and leaves a point outside all shapes without a borough. |
| Zone median uses listed cheapest pints | Pint Index | Zone aggregation reads each venue’s listed cheapest pint and computes the median for the nearest-station fare-zone approximation. |
| Frozen monthly edition and empty-edition copy | Archived Pint Index | `lib/pintIndexArchive.ts` serves immutable published observations for the month; an empty `observations` array selects the no-eligible-price message. |
| “Source links appear beside prices and events when available” | Weekly digest | `DigestPriceObservation.source` is optional and price renderers add its link only when present; event sources are rendered from their required source. |
| “New prices logged” and weekly count | Weekly digest | `dropsLogged` is computed from the digest’s logged-price observations for its scope and week. |
| “Didn’t ask for this? Ignore this email. You won’t be added.” | Confirmation email | Subscription remains pending until the confirmation token route succeeds. Ignoring the email performs no activation. |
| “updates for tonight” push title | Push notification | `lib/pushSender.ts` derives the plural title from `highlights.length`; the body contains the corresponding published highlight items. |
| Moment photos remain private before save; saved Moments attach to account | Moment and feed prompts | Media stays in local draft state until submission; signed-in save writes the Moment under the current account. |
| Pal adult confirmation saves time, never date of birth | Pal setup | Pal setup persists the 18+ confirmation timestamp and has no date-of-birth field in that record. |
| Pal memories can be inspected, corrected, and deleted; fixed controls cannot be disabled | Pal setup | Memory management exposes those operations for approved memories; safety and factuality controls are fixed configuration rather than user toggles. |
| Weather fallback says no fresh read | Today | The fallback branch runs only when the weather request returns no fresh reading. |
| “No change from the earlier price” | Then-and-now cards and venue price story | The equality branch compares current and baseline GBP values before rendering this line. |
| Recap completion, stop, spend, and logged-pint copy | Recap and share helpers | `lib/recapView.ts` and `lib/shareArtifacts.ts` derive each phrase from recorded completion state, stops, finite spend totals, handle, venue, and price fields. |

## Indirect-source inventory

This branch is a partial voice pass. It does not establish that every user-facing string has been audited. Each total below comes from current source using the shown command. “Inspected” records files read during this pass. “Not inspected” names the remaining conservative candidates; some broad candidates may contain no rendered copy, but none is silently treated as reviewed.

The following 25 changed candidates were inspected during this pass but were previously misclassified as not inspected. They are now counted as inspected in each inventory where they qualify:

- `app/activity/ActivityClient.tsx`
- `app/borough/[slug]/page.tsx`
- `app/crawls/[slug]/not-found.tsx`
- `app/crawls/[slug]/page.tsx`
- `app/discover/DiscoverPageClient.tsx`
- `app/feed/FeedPageClient.tsx`
- `app/layout.tsx`
- `app/messages/MessagesInboxClient.tsx`
- `app/tonight/TonightClient.tsx`
- `components/PubMapCanvas.tsx`
- `components/areanews/AreaNewsList.tsx`
- `components/feed/FeedCard.tsx`
- `components/map/ControlRail.tsx`
- `components/map/pubmap/MapOnboardingOverlay.tsx`
- `components/mobile/MobileMapShell.tsx`
- `components/nearme/NearMeNow.tsx`
- `components/pal/PalExperience.tsx`
- `components/plan/PlanCollaborationPanel.tsx`
- `lib/cities/glasgow/curatedCrawls.ts`
- `lib/curation.ts`
- `lib/heritageCrawls.ts`
- `lib/planComposerHandoff.ts`
- `lib/pushSender.ts`
- `lib/pushTokenStore.ts`
- `lib/weeklyDigest.ts`

Their claim-shaped changes are tied to the guarantees above. Their other changed copy is in scope even when it makes no claim requiring a guarantee row.

The earlier metadata inventory overstated its coverage. It listed 19 files, but one was an Open Graph image rather than a page or layout metadata owner. The source-derived set contains 45 metadata owners. 18 were inspected and 27 were not.

### API route modules that may own verbatim errors

Total: 131. Inspected: 48. Not inspected: 83.

Command:

```sh
rg --files app/api -g 'route.ts' -g 'route.tsx' | sort
```

This deliberately treats every API route as a candidate because client code can surface response text. Not inspected:

- `app/api/admin/comments/route.ts`
- `app/api/admin/session/route.ts`
- `app/api/area-news/route.ts`
- `app/api/auth/referral-signup-proof/route.ts`
- `app/api/chaos-card/route.tsx`
- `app/api/citymcp/status/route.ts`
- `app/api/citymcp/things-to-do/route.ts`
- `app/api/contributors/route.ts`
- `app/api/crawl-card/route.tsx`
- `app/api/crawls/[slug]/route.ts`
- `app/api/cron/enrich-city-pubs/route.ts`
- `app/api/cron/freshness-audit/route.ts`
- `app/api/cron/refresh-night-signals/route.ts`
- `app/api/cron/refresh-weather/route.ts`
- `app/api/cron/refresh-whats-on/route.ts`
- `app/api/email-subscribers/route.ts`
- `app/api/events/route.ts`
- `app/api/events/tonight/route.ts`
- `app/api/freshness/route.ts`
- `app/api/hygiene/route.ts`
- `app/api/identity/handle/availability/route.ts`
- `app/api/identity/handle/claim/route.ts`
- `app/api/identity/handle/current/route.ts`
- `app/api/identity/handle/rename/route.ts`
- `app/api/identity/handle/resolve/route.ts`
- `app/api/identity/onboarding/route.ts`
- `app/api/image-proxy/route.ts`
- `app/api/late-food/route.ts`
- `app/api/list-card/route.tsx`
- `app/api/me/night-profile/route.ts`
- `app/api/messages/[id]/route.ts`
- `app/api/messages/route.ts`
- `app/api/night-areas/[slug]/route.ts`
- `app/api/night-calm/route.ts`
- `app/api/night-memories/[id]/moments/route.ts`
- `app/api/night-memories/route.ts`
- `app/api/night-moments/[id]/alt-text/route.ts`
- `app/api/night-signals/route.ts`
- `app/api/night-stories/[id]/consents/route.ts`
- `app/api/night-stories/[id]/contributors/route.ts`
- `app/api/night-stories/[id]/moments/route.ts`
- `app/api/night-stories/[id]/publish-confirmations/route.ts`
- `app/api/night-stories/[id]/publish-proposals/route.ts`
- `app/api/night-stories/[id]/route.ts`
- `app/api/night-stories/[id]/workspace/route.ts`
- `app/api/night-stories/route.ts`
- `app/api/notifications/route.ts`
- `app/api/plan-card/route.tsx`
- `app/api/plans/[id]/actions/route.ts`
- `app/api/plans/[id]/collaboration/route.ts`
- `app/api/plans/[id]/constraints/[constraintId]/resolve/route.ts`
- `app/api/plans/[id]/constraints/route.ts`
- `app/api/plans/[id]/getin/route.ts`
- `app/api/plans/[id]/invites/[inviteId]/route.ts`
- `app/api/plans/[id]/invites/redeem/route.ts`
- `app/api/plans/[id]/invites/route.ts`
- `app/api/plans/[id]/join/route.ts`
- `app/api/plans/[id]/presence/route.ts`
- `app/api/plans/[id]/proposals/[proposalId]/decision/route.ts`
- `app/api/plans/[id]/proposals/[proposalId]/votes/route.ts`
- `app/api/plans/[id]/proposals/route.ts`
- `app/api/plans/[id]/recap/route.ts`
- `app/api/plans/[id]/vibe-votes/route.ts`
- `app/api/plans/anchor/route.ts`
- `app/api/profiles/[handle]/following/route.ts`
- `app/api/profiles/[handle]/lot/route.ts`
- `app/api/profiles/[handle]/route.ts`
- `app/api/pub-pal/memories/[memoryId]/route.ts`
- `app/api/pub-pal/memories/export/route.ts`
- `app/api/pub-pal/memories/route.ts`
- `app/api/push-tokens/route.ts`
- `app/api/ratings/route.ts`
- `app/api/referrals/claim-attribution/route.ts`
- `app/api/referrals/invite-link/route.ts`
- `app/api/referrals/status/route.ts`
- `app/api/rounds/route.ts`
- `app/api/social-connections/[provider]/callback/route.ts`
- `app/api/social-connections/route.ts`
- `app/api/tonight-conditions/route.ts`
- `app/api/venue/[id]/route.ts`
- `app/api/walk-route/route.ts`
- `app/api/whats-on/route.ts`

### Shared helper candidates

Total: 519. Inspected: 45. Not inspected: 474.

Command:

```sh
rg --files lib -g '*.ts' -g '*.tsx' | sort
```

This deliberately treats every TypeScript helper as a candidate because rendered fallbacks can be exported from otherwise non-visual modules. `lib/todayBrief.ts` and
`lib/dealsDigest.ts` were inspected on 2026-08-07 alongside `app/today/page.tsx`
(surface pass 2), as the direct generators behind its metadata claims. Not inspected:

- `lib/a2hsPrompt.ts`
- `lib/aboutStats.ts`
- `lib/accountBoundFetch.ts`
- `lib/accountOnboardingClient.ts`
- `lib/activePlan.ts`
- `lib/activePlanRoute.ts`
- `lib/activeRound.ts`
- `lib/adminAuth.ts`
- `lib/ambientPresence.ts`
- `lib/analytics.ts`
- `lib/analyticsEvents.ts`
- `lib/analyticsIdentity.ts`
- `lib/analyticsPath.ts`
- `lib/analyticsReceiptStore.ts`
- `lib/anonId.ts`
- `lib/apiError.ts`
- `lib/apiResponses.ts`
- `lib/areaButton.ts`
- `lib/areaDemand.ts`
- `lib/areaDemandStore.ts`
- `lib/areaNews.server.ts`
- `lib/areaNews.ts`
- `lib/authCallbackClient.ts`
- `lib/authClient.ts`
- `lib/authFetch.ts`
- `lib/authFocus.ts`
- `lib/authProviderAvailability.ts`
- `lib/authRedirect.ts`
- `lib/authServer.ts`
- `lib/authSessionTransition.ts`
- `lib/authedFetch.ts`
- `lib/badgeEventOptIn.ts`
- `lib/badgeEvents.ts`
- `lib/bandOnboardingChip.ts`
- `lib/beers.ts`
- `lib/boroughHeritage.ts`
- `lib/boroughs.ts`
- `lib/breakpoints.ts`
- `lib/busyness.ts`
- `lib/cameraIntent.ts`
- `lib/categoryColors.ts`
- `lib/chaosCardParams.ts`
- `lib/chaosScore.ts`
- `lib/checkInRateLimit.ts`
- `lib/checkInStore.ts`
- `lib/cities.ts`
- `lib/cities/bristol/curatedCrawls.ts`
- `lib/cities/bristol/landmarks.ts`
- `lib/cities/bristol/storyBands.ts`
- `lib/cities/cambridge/curatedCrawls.ts`
- `lib/cities/cambridge/landmarks.ts`
- `lib/cities/cambridge/storyBands.ts`
- `lib/cities/durham/curatedCrawls.ts`
- `lib/cities/durham/landmarks.ts`
- `lib/cities/durham/storyBands.ts`
- `lib/cities/glasgow/landmarks.ts`
- `lib/cities/liverpool/curatedCrawls.ts`
- `lib/cities/liverpool/landmarks.ts`
- `lib/cities/liverpool/storyBands.ts`
- `lib/cities/manchester/curatedCrawls.ts`
- `lib/cities/manchester/landmarks.ts`
- `lib/cities/manchester/pintDropSeeds.ts`
- `lib/cities/manchester/storyBands.ts`
- `lib/cities/oxford/curatedCrawls.ts`
- `lib/cities/oxford/landmarks.ts`
- `lib/cities/oxford/storyBands.ts`
- `lib/cityChooserSearch.ts`
- `lib/cityCuratedCrawls.ts`
- `lib/cityLandmarks.ts`
- `lib/cityMapCoverage.ts`
- `lib/cityPreference.ts`
- `lib/cityRivalry.ts`
- `lib/cityShare.ts`
- `lib/cityStoryBands.ts`
- `lib/cityVenueIds.ts`
- `lib/citymcp/area.ts`
- `lib/citymcp/buzz.ts`
- `lib/citymcp/client.ts`
- `lib/citymcp/enrichOpportunityLocations.ts`
- `lib/citymcpRateLimit.ts`
- `lib/commentsStore.ts`
- `lib/communityContributionClient.ts`
- `lib/communityPriceActor.ts`
- `lib/communityPriceStore.ts`
- `lib/concierge/context.ts`
- `lib/concierge/intent.ts`
- `lib/concierge/rank.ts`
- `lib/concierge/venues.server.ts`
- `lib/conditionsFormat.ts`
- `lib/contributorLeaderboard.ts`
- `lib/contributorLeaderboardStore.ts`
- `lib/convex/contracts.ts`
- `lib/convex/migration.ts`
- `lib/convex/migrationTransitions.ts`
- `lib/crawlCompletion.ts`
- `lib/crawlStory.ts`
- `lib/crawlStoryStore.ts`
- `lib/crawlUrl.ts`
- `lib/crew.ts`
- `lib/crewRealtime.ts`
- `lib/cronAuth.ts`
- `lib/cuisineTags.ts`
- `lib/curatedCrawls.ts`
- `lib/dailyActivity.ts`
- `lib/dailyBriefPush.ts`
- `lib/dataFreshness.ts`
- `lib/demoContent.ts`
- `lib/deploymentEnv.ts`
- `lib/discoverLazy.ts`
- `lib/donutClusterGeometry.ts`
- `lib/drinkBrands.ts`
- `lib/drinkCategoryFromText.ts`
- `lib/drinkMenu.ts`
- `lib/drinkPriceUpdates.ts`
- `lib/drinkSeeds.ts`
- `lib/drinkSubtypes.ts`
- `lib/drinkWeather.ts`
- `lib/drinks.ts`
- `lib/emailProvider.ts`
- `lib/emailSubscribers.ts`
- `lib/emailSubscribersStore.ts`
- `lib/entryDecision.ts`
- `lib/events/eventbrite.ts`
- `lib/events/provider.ts`
- `lib/eventsLiveRateLimit.ts`
- `lib/eventsRateLimit.ts`
- `lib/explicitMapIntent.ts`
- `lib/factClaims.ts`
- `lib/favoritePint.ts`
- `lib/feed.ts`
- `lib/feedFreshnessStore.ts`
- `lib/feedSightings.ts`
- `lib/filterMapVenues.ts`
- `lib/firstDropNudge.ts`
- `lib/firstRunTour.ts`
- `lib/followStore.ts`
- `lib/food.ts`
- `lib/foodHygiene.ts`
- `lib/foodHygieneRateLimit.ts`
- `lib/foodPriceUpdates.ts`
- `lib/forYou.ts`
- `lib/formatJourney.ts`
- `lib/freshness.ts`
- `lib/freshnessArtifact.ts`
- `lib/freshnessNotify.ts`
- `lib/freshnessStoreOverlay.ts`
- `lib/gardenWeather.ts`
- `lib/geo.ts`
- `lib/greeneKingMenuParser.ts`
- `lib/groupPrefs.ts`
- `lib/handleDisplay.ts`
- `lib/haversine.ts`
- `lib/heritage.ts`
- `lib/heritageFacts.ts`
- `lib/heritageListings.ts`
- `lib/historic.ts`
- `lib/historicFilter.ts`
- `lib/httpUrl.ts`
- `lib/icsExport.ts`
- `lib/identityClaimClient.ts`
- `lib/identityClient.ts`
- `lib/identityHandleClaimRateLimit.ts`
- `lib/identityHandleStore.ts`
- `lib/identityNudge.ts`
- `lib/imageSafety.ts`
- `lib/importNotesRateLimit.ts`
- `lib/inviteExpiry.ts`
- `lib/invitePrivacyPreview.ts`
- `lib/inviteShare.ts`
- `lib/ipRateLimit.ts`
- `lib/landmarkCredit.ts`
- `lib/landmarks.ts`
- `lib/lastCrew.ts`
- `lib/lastRide.ts`
- `lib/lastRideClient.ts`
- `lib/lastRideRateLimit.ts`
- `lib/lastTrainBadge.ts`
- `lib/lastTrainDestination.ts`
- `lib/lastTrainStableCache.server.ts`
- `lib/lateFood.ts`
- `lib/lazyVenueDetail.ts`
- `lib/leaderboard.ts`
- `lib/ledger.ts`
- `lib/localities.ts`
- `lib/log.ts`
- `lib/londonBoroughClassifier.ts`
- `lib/mapAcceptance.ts`
- `lib/mapArrival.ts`
- `lib/mapBasemapTaste.ts`
- `lib/mapChromeTiers.ts`
- `lib/mapExperienceLens.ts`
- `lib/mapFallbackVenues.ts`
- `lib/mapIcons.ts`
- `lib/mapLocationPrompt.ts`
- `lib/mapLogIntent.ts`
- `lib/mapPaintWatchdog.ts`
- `lib/mapPintDropPolicy.ts`
- `lib/mapRenderedState.ts`
- `lib/mapRouteTransfer.ts`
- `lib/mapSearchSuggest.ts`
- `lib/mapSelectionHistory.ts`
- `lib/mapTileFailure.ts`
- `lib/mapWarmup.ts`
- `lib/mbplcMenuParser.ts`
- `lib/menuHub.ts`
- `lib/merseyrail.ts`
- `lib/messageAuth.ts`
- `lib/messages.ts`
- `lib/messagesRealtime.ts`
- `lib/messagesStore.ts`
- `lib/metrolink.ts`
- `lib/mobileShell.ts`
- `lib/momentDraft.ts`
- `lib/morningReentry.ts`
- `lib/nationalPintBenchmarks.ts`
- `lib/nativeCamera.ts`
- `lib/nativeDeepLinks.ts`
- `lib/nativeFirstRun.ts`
- `lib/nativePlatform.ts`
- `lib/nativePush.ts`
- `lib/nativePushPrompt.ts`
- `lib/nativeSystemBars.ts`
- `lib/nearMeAnswer.ts`
- `lib/nearby.ts`
- `lib/nearbyBusDepartures.ts`
- `lib/nearestCity.ts`
- `lib/nicholsons.ts`
- `lib/nightCalm.ts`
- `lib/nightCalmRateLimit.ts`
- `lib/nightCalmSource.ts`
- `lib/nightCrawl.ts`
- `lib/nightMemory.ts`
- `lib/nightMemoryStore.ts`
- `lib/nightMomentMedia.ts`
- `lib/nightOutPlaces.server.ts`
- `lib/nightOutPlaces.ts`
- `lib/nightPatches.ts`
- `lib/nightProfile.ts`
- `lib/nightProfileClient.ts`
- `lib/nightProfileStore.ts`
- `lib/nightSignalClaims.ts`
- `lib/nightSignalIngest.server.ts`
- `lib/nonAlcoholicDrinks.ts`
- `lib/notifications.ts`
- `lib/notificationsStore.ts`
- `lib/offlineCache.ts`
- `lib/ogBrand.tsx`
- `lib/ogCardRateLimit.ts`
- `lib/operatorProposalsStore.ts`
- `lib/opsFreeze.ts`
- `lib/optimisticSpillPost.ts`
- `lib/optimisticToggle.ts`
- `lib/palChatClient.ts`
- `lib/palGlance.ts`
- `lib/palLocality.ts`
- `lib/passport.ts`
- `lib/passwordlessAuth.ts`
- `lib/patchCapabilities.ts`
- `lib/performanceMarks.ts`
- `lib/personaDrinks.ts`
- `lib/pintContributions.ts`
- `lib/pintDropComposerConfig.ts`
- `lib/pintDropDraft.ts`
- `lib/pintDropLookup.ts`
- `lib/pintDropSeeds.ts`
- `lib/pintDropShared.ts`
- `lib/pintDropSpeech.ts`
- `lib/pintDropViewer.ts`
- `lib/pintFacts.ts`
- `lib/pintIndex.ts`
- `lib/pintIndexArchive.ts`
- `lib/pintIndexArrival.ts`
- `lib/pintIndexSnapshot.server.ts`
- `lib/plan.ts`
- `lib/planCollaborationHttp.ts`
- `lib/planCollaborationStore.ts`
- `lib/planContinuity.ts`
- `lib/planDraft.ts`
- `lib/planGenerationContext.ts`
- `lib/planGenerationDto.ts`
- `lib/planGenerationEndings.server.ts`
- `lib/planGenerationIntake.ts`
- `lib/planGenerationRequest.ts`
- `lib/planGenerationSelection.server.ts`
- `lib/planGenerationTemporalEvidence.ts`
- `lib/planGetIn.ts`
- `lib/planGrounding.server.ts`
- `lib/planIntake.ts`
- `lib/planIntelligence.ts`
- `lib/planInviteUi.ts`
- `lib/planMemberCapability.ts`
- `lib/planMutationHttp.ts`
- `lib/planMutationKey.ts`
- `lib/planPrivacy.ts`
- `lib/planPrivacyBoundary.server.ts`
- `lib/planRecap.ts`
- `lib/planRecapView.server.ts`
- `lib/planRoute.ts`
- `lib/planRouteDraft.ts`
- `lib/planRouteEvidence.server.ts`
- `lib/planRouteTotalsClient.ts`
- `lib/planSessionCapability.ts`
- `lib/planStore.ts`
- `lib/planVenueOptions.ts`
- `lib/planWhatsOn.ts`
- `lib/planningAnchor.server.ts`
- `lib/planningAnchor.ts`
- `lib/planningIntent.ts`
- `lib/poiToggleGroups.ts`
- `lib/pois.ts`
- `lib/posthogClient.ts`
- `lib/posthogServer.ts`
- `lib/prefetchVenue.ts`
- `lib/presence.ts`
- `lib/presenceStore.ts`
- `lib/priceConfidence.ts`
- `lib/priceConfirmStore.ts`
- `lib/priceContributionIntent.ts`
- `lib/priceFactClaims.ts`
- `lib/priceHistory.ts`
- `lib/priceHistoryLoader.ts`
- `lib/priceMovementLine.ts`
- `lib/priceRefresh.server.ts`
- `lib/priceUpdates.ts`
- `lib/priceUpdatesLoader.ts`
- `lib/privateIdentity.ts`
- `lib/privateIdentityClient.ts`
- `lib/privateIdentityStore.ts`
- `lib/profileBadgeEventGate.ts`
- `lib/profileOwnership.ts`
- `lib/profiles.ts`
- `lib/promptBudget.ts`
- `lib/provenanceLabels.ts`
- `lib/pubMap.ts`
- `lib/pubPalStore.ts`
- `lib/pubmaxxIdentity.ts`
- `lib/pushProvider.ts`
- `lib/quietPint.ts`
- `lib/ratings.ts`
- `lib/ratingsStore.ts`
- `lib/reactions.ts`
- `lib/reactionsStore.ts`
- `lib/realtime.ts`
- `lib/recapCard.ts`
- `lib/recapCardStats.server.ts`
- `lib/referralClaimClient.ts`
- `lib/referralSignupProof.server.ts`
- `lib/referralStore.ts`
- `lib/referrals.ts`
- `lib/relativeTime.ts`
- `lib/roundPresence.ts`
- `lib/roundPriceBudget.ts`
- `lib/roundRequest.ts`
- `lib/roundView.server.ts`
- `lib/rounds.ts`
- `lib/roundsReadRateLimit.ts`
- `lib/roundsStore.ts`
- `lib/routeLegs.ts`
- `lib/routeMiniMap.ts`
- `lib/routeObservability.ts`
- `lib/routePacks.ts`
- `lib/routePanelIcs.ts`
- `lib/routePattern.ts`
- `lib/savedListPolicy.ts`
- `lib/savedListPresentation.ts`
- `lib/savedPubs.ts`
- `lib/savedPubsStore.ts`
- `lib/scrapedPubs.server.ts`
- `lib/scrapedPubs.ts`
- `lib/serverEnv.ts`
- `lib/shareSheet.ts`
- `lib/sheetSnap.ts`
- `lib/siteContact.ts`
- `lib/siteUrl.ts`
- `lib/slimPins.ts`
- `lib/slimShards.ts`
- `lib/slopFilter.ts`
- `lib/socialConnectionStore.ts`
- `lib/socialConnections.ts`
- `lib/socialDrafts.ts`
- `lib/socialFeed.ts`
- `lib/socialOAuth.ts`
- `lib/spill.ts`
- `lib/spillPreview.ts`
- `lib/sponsorship.ts`
- `lib/springMotion.ts`
- `lib/sptSubway.ts`
- `lib/startRoundWithStops.ts`
- `lib/staticStations.ts`
- `lib/storeBackend.ts`
- `lib/storyBands.ts`
- `lib/storyRedaction.ts`
- `lib/supabase.ts`
- `lib/tavilyPubEnrichment.server.ts`
- `lib/textClean.ts`
- `lib/tfl.ts`
- `lib/tflClient.server.ts`
- `lib/tflDisruption.ts`
- `lib/thenVsNow.ts`
- `lib/thingsToDoMap.ts`
- `lib/todayPersonalization.ts`
- `lib/tonight.ts`
- `lib/tonightAcceptance.ts`
- `lib/tonightConditions.ts`
- `lib/tonightConditionsRoute.ts`
- `lib/tonightGetHome.ts`
- `lib/tonightListGrouping.ts`
- `lib/tonightPoster.ts`
- `lib/trustedHandoffFlags.server.ts`
- `lib/trustedHandoffFlags.ts`
- `lib/trustedSigningKey.server.ts`
- `lib/tubeOffsets.ts`
- `lib/ukBaseIndex.ts`
- `lib/ukBasePubs.ts`
- `lib/ukPlaceIndex.server.ts`
- `lib/ukPlaceSearch.ts`
- `lib/useFocusTrap.ts`
- `lib/useSpringValue.ts`
- `lib/utils.ts`
- `lib/venueAcceptance.ts`
- `lib/venueAccessibility.ts`
- `lib/venueAccessibilitySeeds.ts`
- `lib/venueAliases.ts`
- `lib/venueAnchorPresentation.ts`
- `lib/venueDataset.ts`
- `lib/venueDetailIndex.ts`
- `lib/venueExternalActions.ts`
- `lib/venueFoodMenu.ts`
- `lib/venueImageHosts.server.ts`
- `lib/venueImages.ts`
- `lib/venueIndex.ts`
- `lib/venueInspectorTabs.ts`
- `lib/venueJourney.ts`
- `lib/venueKindFilters.ts`
- `lib/venueMapUrl.ts`
- `lib/venueMenu.ts`
- `lib/venueMenuEnrichment.ts`
- `lib/venueOperatorsStore.ts`
- `lib/venuePriceIndex.ts`
- `lib/venueShare.ts`
- `lib/venueSheetLabels.ts`
- `lib/venues.ts`
- `lib/venuesSlim.ts`
- `lib/verifiedAnalytics.server.ts`
- `lib/vibeChips.ts`
- `lib/viewMode.ts`
- `lib/visitReportsStore.ts`
- `lib/walkRoute.ts`
- `lib/walkRouteBudget.ts`
- `lib/walkRouteLegs.ts`
- `lib/walkRouteProvider.ts`
- `lib/walkRouteStore.ts`
- `lib/warmVenueDetail.ts`
- `lib/weatherFreshness.server.ts`
- `lib/weatherProvider.ts`
- `lib/weatherRecommendationSnapshotMemo.server.ts`
- `lib/weatherSnapshotStore.ts`
- `lib/weatherSnapshots.server.ts`
- `lib/weatherSnapshots.ts`
- `lib/webPush.ts`
- `lib/webPushPrompt.ts`
- `lib/webPushSubscription.ts`
- `lib/webVitals.ts`
- `lib/wetherspoons.ts`
- `lib/wetherspoonsDirectory.ts`
- `lib/whatsOn.ts`
- `lib/whatsOnBadges.ts`
- `lib/whatsOnHandler.ts`
- `lib/whatsOnStore.ts`
- `lib/youngs.ts`
- `lib/zonePintIndex.server.ts`
- `lib/zones.ts`

### Route and page metadata owners

Total: 45. Inspected: 20. Not inspected: 25.

Command:

```sh
rg -l --glob 'page.tsx' --glob 'layout.tsx' \
  'export (const metadata|async function generateMetadata|function generateMetadata)' app | sort
```

`app/map/page.tsx` was inspected on 2026-08-07 (surface pass 1). Its two branches
generate ten distinct title/description/alt strings (the London/band/curated-crawl
default via `lib/cityShare.ts`, and the UK-place-arrival fallback inline in the page).
Every string was traced to a code guarantee and none violated `docs/VOICE.md`; see
PR "voice: derive and fix app/map/page.tsx copy from code guarantees (surface pass 1)"
for the per-string guarantee table. No copy changed.

`app/today/page.tsx` was inspected on 2026-08-07 (surface pass 2), together with
`lib/todayBrief.ts` and `lib/dealsDigest.ts`, the two direct generators behind its
"morning brief" claim. The title and description are its only owned strings; both
were traced to code guarantees (the London-only weather and pricing pipeline, the
real-ranked tonight picks, the sourced-and-unclosed pub-fact rule, and the get-home
strip rendered by `TodayClient.tsx`). See PR "voice: derive and fix
app/today/page.tsx copy from code guarantees (surface pass 2)" for the per-string
guarantee table. No copy changed.

Not inspected:

- `app/activity/page.tsx`
- `app/add/[handle]/page.tsx`
- `app/admin/page.tsx`
- `app/bar-tab/[id]/page.tsx`
- `app/borough/page.tsx`
- `app/contributors/page.tsx`
- `app/crawls/page.tsx`
- `app/discover/page.tsx`
- `app/historic/[slug]/page.tsx`
- `app/map/[city]/page.tsx`
- `app/messages/[id]/page.tsx`
- `app/messages/page.tsx`
- `app/onboarding/page.tsx`
- `app/p/[id]/page.tsx`
- `app/page.tsx`
- `app/pal/page.tsx`
- `app/plan/[id]/page.tsx`
- `app/plan/[id]/recap/page.tsx`
- `app/pubs/page.tsx`
- `app/recap/[storyId]/page.tsx`
- `app/rounds/[code]/page.tsx`
- `app/rounds/page.tsx`
- `app/u/[handle]/lists/[listType]/page.tsx`
- `app/u/[handle]/page.tsx`
- `app/we-are-out/page.tsx`

The previous 19-file list also named `app/historic/[slug]/opengraph-image.tsx`. That file was inspected, but the command above correctly does not count it as a page or layout metadata owner.

### Template and tooltip candidates

Total: 93. Inspected: 29. Not inspected: 64.

`lib/cityShare.ts` was inspected on 2026-08-07 alongside `app/map/page.tsx` (surface
pass 1), as the direct generator of that route's title/description/OG copy.

Command:

```sh
{ rg -l -i --glob '*.{ts,tsx}' '(tooltip|blurb|template|\btitle=)' app components lib
  printf '%s\n' components/nav/SiteNavMore.tsx
} | sort -u
```

The explicit navigation owner covers menu blurbs that do not use a tooltip-named symbol. Not inspected:

- `app/bar-tab/[id]/page.tsx`
- `app/historic/[slug]/page.tsx`
- `app/p/[id]/page.tsx`
- `app/plan/[id]/not-found.tsx`
- `app/plan/[id]/page.tsx`
- `app/recap/[storyId]/page.tsx`
- `app/rounds/[code]/RoundPageClient.tsx`
- `app/rounds/page.tsx`
- `components/PerformanceVitals.tsx`
- `components/PubMap.tsx`
- `components/ThemeToggle.tsx`
- `components/desktop/ConditionsChip.tsx`
- `components/drinks/DrinkGlyph.tsx`
- `components/drinks/DrinkMenu.tsx`
- `components/feed/FeedFilters.tsx`
- `components/feed/PresenceStrip.tsx`
- `components/feed/SocialTabs.tsx`
- `components/food/FoodMenu.tsx`
- `components/map/CityPlaceStrip.tsx`
- `components/map/CityStatusBanner.tsx`
- `components/map/MapLayersControl.tsx`
- `components/map/MapPriceControl.tsx`
- `components/map/RoutePanel.tsx`
- `components/map/TonightArcChips.tsx`
- `components/map/VenueBuzz.tsx`
- `components/map/VenueHygiene.tsx`
- `components/map/composer/ComposerFields.tsx`
- `components/map/pubmap/MappedRouteChip.tsx`
- `components/map/route/RouteHeader.tsx`
- `components/map/route/RouteList.tsx`
- `components/map/route/RouteMetrics.tsx`
- `components/nav/MessagesLink.tsx`
- `components/nav/NotificationBell.tsx`
- `components/nav/SiteNav.tsx`
- `components/night/NightModeCard.tsx`
- `components/plan/PlanRoute.tsx`
- `components/plan/PlanVibe.tsx`
- `components/plan/RecapDetail.tsx`
- `components/plan/planPresentation.ts`
- `components/profile/PintPassport.tsx`
- `components/profile/ProfileHeader.tsx`
- `components/profile/SavedListDetail.tsx`
- `components/profile/SavedPubList.tsx`
- `components/pubs/PubsGallery.tsx`
- `components/round/RoundStarter.tsx`
- `components/share/ShareBar.tsx`
- `components/zones/ZonePintIndexStrip.tsx`
- `lib/analyticsEvents.ts`
- `lib/analyticsPath.ts`
- `lib/cities/bristol/curatedCrawls.ts`
- `lib/cities/cambridge/curatedCrawls.ts`
- `lib/cities/durham/curatedCrawls.ts`
- `lib/cities/liverpool/curatedCrawls.ts`
- `lib/cities/manchester/curatedCrawls.ts`
- `lib/cities/oxford/curatedCrawls.ts`
- `lib/curatedCrawls.ts`
- `lib/firstDropNudge.ts`
- `lib/icsExport.ts`
- `lib/pintDropSeeds.ts`
- `lib/planDraft.ts`
- `lib/planInviteUi.ts`
- `lib/pubMap.ts`
- `lib/routePattern.ts`

### Notification and email candidates

Total: 27. Inspected: 9. Not inspected: 18.

Command:

```sh
rg --files app components lib |
  rg -i '(email|digest|push|notification|subscribe|unsubscribe|night-signals)' |
  rg '\.(ts|tsx)$' |
  sort
```

`lib/dealsDigest.ts` matches this list on "digest" (it is the deals-digest grouping
core, not a notification channel). It was inspected on 2026-08-07 alongside
`app/today/page.tsx` (surface pass 2); see the Route and page metadata owners
section above.

Not inspected:

- `app/api/cron/refresh-night-signals/route.ts`
- `app/api/email-subscribers/route.ts`
- `app/api/notifications/route.ts`
- `components/native/NativePushPrompt.tsx`
- `components/nav/NotificationBell.tsx`
- `components/pwa/WebPushPrompt.tsx`
- `lib/dailyBriefPush.ts`
- `lib/emailProvider.ts`
- `lib/emailSubscribers.ts`
- `lib/emailSubscribersStore.ts`
- `lib/nativePush.ts`
- `lib/nativePushPrompt.ts`
- `lib/notifications.ts`
- `lib/notificationsStore.ts`
- `lib/pushProvider.ts`
- `lib/webPush.ts`
- `lib/webPushPrompt.ts`
- `lib/webPushSubscription.ts`

## Outstanding audit scope

The files above remain for the follow-up audit. In particular, this pass did not audit `app/page.tsx` (its own metadata is canonical-URL only; title and description inherit the already-inspected root layout defaults), or most unchanged API routes and shared helpers. Review findings on those files should be recorded against that follow-up rather than used to widen this branch.

No additional product-character judgement call was decided during this closeout. The branch applies rule-bound fixes only.

### Surface pass 1 (2026-08-07)

`app/map/page.tsx`, the main map route's title/description/OG/Twitter metadata, was
inspected as the single highest-user-exposure surface remaining in the "Route and
page metadata owners" not-inspected list, together with `lib/cityShare.ts`, the
shared helper that generates most of that copy. Ten distinct strings were derived
from their code guarantees (share URL resolution, curated-crawl and story-band
lookups, stop counts sourced only from a real `?pubs=` count or a crawl's own
`venueIds` length, and the UK-place-arrival branch's "no prices logged here yet"
line, which is guaranteed true because `resolveUkPlaceMapArrival` only resolves
places outside every enabled city's coverage). None violated `docs/VOICE.md`: no
banned words, no em dashes, no British-spelling misses, no jokes beside a price or
date, honest price disclosure, and no copy assuming the reader drinks alcohol. No
code changed; this is a clean-audit closeout for one surface, not a widened sweep.

### Surface pass 2 (2026-08-07)

`app/today/page.tsx` was chosen as the next highest-user-exposure surface: it is
the only route `components/nav/SiteNav.tsx` places ahead of the shared primary-nav
model, by that file's own comment, as the "before you go" home surface leading the
desktop link list. Its title and description are its only owned strings, so the
audit also pulled in `lib/todayBrief.ts` and `lib/dealsDigest.ts`, the direct
generators behind the description's four claims. Every claim was traced to a code
guarantee: the London-only weather and pricing pipeline behind "pint-in-the-garden
day", the real-ranked, never-padded picks pipeline (`rankTonightPicks`,
`digestSectionPicks`, whose venue-count note is always a real distinct-venue count)
behind "tonight's top picks", the closure-checked, sourced-only fact rule
(`pickPubOfTheDayFact`) behind "one sourced pub fact", and the live get-home strip
(`TodayGetThereStrip`, `TodayTubeCard`) rendered by `app/today/TodayClient.tsx`
behind "how you'll get home". None violated `docs/VOICE.md`: no banned words, no em
dashes, no British-spelling misses, honest staleness disclosure that only ever
rounds down, and no copy assuming the reader drinks alcohol ("pint-in-the-garden
day" names a weather mood, not a drink order; the product noun "pint" stays). No
code changed; this is a clean-audit closeout for one surface, not a widened sweep.

### Surface pass 3 (2026-08-07)

After two clean passes on metadata surfaces, this pass switched category to "API
route modules that may own verbatim errors", the list of user-facing failure text
most likely to hide a violation. The Pint Drops cluster was chosen as the
highest-exposure surface in that category: it is the product's core log-a-price
write path plus its two social read/write actions, so its error strings are the
ones a real user hits most often. The audit covered `app/api/pint-drops/route.ts`,
`app/api/pint-drops/[id]/route.ts`, `app/api/pint-drops/comments/route.ts`, and
`app/api/pint-drops/reactions/route.ts`, together with `lib/pintDrops.ts`,
`lib/profileOwnership.ts`, and `lib/commentsStore.ts`, the direct generators
behind every error string those routes return. Every string was traced to its
code guarantee (validation failures, storage-unavailable states, rate-limit
messages, handle-gating messages) and checked against `docs/VOICE.md`. None
violated the rules: no banned words, no em dashes, no exclamation marks, no
begging language, no plumbing words, and no copy assuming the reader drinks
alcohol.

To corroborate that this category is broadly clean and not just this one
cluster, every one of the 86 not-inspected files in this category was also
swept with pattern searches for em dashes in string literals, exclamation
marks, begging phrases, banned marketing words, plumbing words, "0.0" literals,
and Latinate words outside comments and imports. The sweep found no violations
outside code comments. Separately, `__tests__/emDashLaw.test.ts` only walks
`.tsx` files under `app` and `components`; plain `.ts` route files such as
these are not covered by that test's em-dash scan. This is a pre-existing gap
in test coverage, not a copy violation, and is noted here for awareness rather
than fixed in this pass. No code changed; this is a clean-audit closeout for
one surface, not a widened sweep.
