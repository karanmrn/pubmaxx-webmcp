# PUBMAXX — South London pub-scene sweep (last 30 days)

Compiled 2026-07-18. Region: South London. Tools: Exa API (search + `/contents`, last-30-day published-date filters) and Firecrawl REST API (`/v1/search`, `tbs:qdr:m`). Every bullet carries a source URL + date. No invented facts.

**API note:** The Firecrawl **MCP tools** were down all sweep (401 "Invalid token" — stale env in the MCP process). The Firecrawl **REST API** with the same repo key works fine and was used directly via curl for the concrete-price layer below. Exa worked normally throughout.

Note on concrete pint prices: local *press* rarely prints £/pint, so region anchors + promos are the reliable editorial layer. The Firecrawl REST pass then surfaced real per-pint figures from **social sources** (Instagram/Facebook/TikTok pub posts, the "London Pub Map" and Guinness-community pages). Social prices are self-reported and best treated as directional; the well-attributed ones (pub + place named) are listed in the Concrete pint prices section.

---

## Region-wide price & trade context (anchors)
- UK average pint now **£4.52**; London high-end bars crossing **£10/pint** "for the first time" — framed as new normal. Opinion/explainer piece, riverfallsumc.org, 2026-07-15. https://riverfallsumc.org/article/london-s-rising-beer-prices-is-a-10-pint-the-new-normal
- **£3 pints of Peroni** at Greene King Flaming Grill pubs, promo dated **23–26 July 2026** (chain-wide, includes South London GK sites). hotukdeals, 2026-07-13. https://www.hotukdeals.com/deals/ps3-pints-of-peroni-at-greene-king-23rd-to-26th-july-4934974
- World Cup 2026 drove a measurable South London trade spike: London pub/bar spending **+11%** during England's run (Dojo card data, 110k+ hospitality clients). SW Londoner, 2026-07-13. https://www.swlondoner.co.uk/food-drink/13072026-london-pubs-cash-in-as-englands-world-cup-run-boosts-bar-spending
- Trade bodies predicted **6m extra pints** poured nationally for England v Argentina semi (bigger boost than NYE). Morning Advertiser, 2026-07-14. https://www.morningadvertiser.co.uk/Article/2026/07/14/pubs-to-sell-6m-extra-pints-during-england-v-argentina-world-cup-semi-final/
- Ritual/texture piece on how SW London pubs (Clapham, Putney named) host big-match nights. SW Londoner, 2026-07-16. https://www.swlondoner.co.uk/life/16072026-how-london-pubs-bring-big-matches-to-life
- Widely-cited **average London pint ≈ £5.01**, of which only ~12p is estimated pub profit after tax/costs (~£1.60 to duty). Pub Instagram post, Jul 2026. https://www.instagram.com/p/DaaSzpqDWm1/

---

## Concrete pint prices (last 30 days, Firecrawl REST → social sources)
Self-reported; treat as directional. Listed where a specific pub + place is named.
- **The Ramble Inn, Tooting (SW17)** — **£5.70** pint of Timothy Taylor Landlord ("really good drop… price point was great at under a fiver" for the Guinness; Landlord £5.70). Guinness Community group, Jul 2026. https://www.facebook.com/groups/guinnesscommunity/posts/4467280013589837/
- **Brixton** (independent, self-described) — **£3 a pint all day; £4 pints; £3.50 cask ales 4–6pm**; "two-pint" draught deal (excl. Guinness). Pub Instagram, Jul 2026. https://www.instagram.com/reel/DZ-gq69s03v/ and https://www.instagram.com/p/DaaSzpqDWm1/
- **"Cinatra's"** (Croydon-area query) — **£5.00** pint of Guinness "on the nose… very good price point." Instagram, Jul 2026. https://www.instagram.com/reel/DZzrdsAxHYU/
- **Wetherspoon Joe's, Croydon** — match-night promo: **50% off** Guinness, Foster's, Moretti & Inches 10–11pm (England v Mexico). Instagram, Jul 2026. https://www.instagram.com/reel/DaaA96koZL5/
- **The Rocket (Wetherspoon), Putney** — riverside Spoons flagged as the cheap-pint "offset" option (no exact £, cheapest-in-area framing). London Pub Map, Jul 2026. https://www.facebook.com/londonpubmap/posts/1014479751464336/
- **Skehan's Free House, Nunhead/New Cross (SE)** & a "quiet Greenwich backstreet" pub — both self-reported **"excellent, under a fiver."** Instagram, Jul 2026. https://www.instagram.com/p/DafNUlgDEKA/ ; https://www.instagram.com/reel/DZ2uUubs0Lu/
- Happy-hour marker: **"£5 pints, 2 for £20 spritz"** England-knockout extension at a "Hall Pass" happy hour (SW London). Instagram, Jul 2026. https://www.instagram.com/reel/DaOFyvvRCQR/

---

## Clapham
- **The Junction** (Greene King, Clapham Junction) running a World Cup table-booking push; alfresco drinking/dining promoted for summer. Greene King page updated 2026-07-16 (https://www.greeneking.co.uk/pubs/greater-london/junction); VisitClaphamJunction blog 2026-06-23 (https://visitclaphamjunction.com/blog/alfresco-drinking-at-the-junction).
- **The Windmill, Clapham Common** heavily promoting World Cup screenings. 2026-07-07. https://www.windmillclapham.co.uk/world-cup/
- **The Avalon** (Clapham South, SW12) active summer pub-dining marketing. 2026-07-07. https://www.theavalonlondon.com/
- **The Rattlin Bog, Clapham** — the original independent Irish pub (443-area brand); a second Rattlin Bog is now opening in Brixton under the same name (see Brixton). brixtonbuzz, 2026-07-08. https://www.brixtonbuzz.com/2026/07/paddys-yard-in-brixton-to-be-reopened-as-the-rattlin-bog-irish-bar/

## Battersea
- **NEW OPENING — The Hero's Return, Battersea Power Station.** From Bancone's backers (Splendid Hospitality) + ex-St John chef director Jonathon Woolway (17 yrs w/ Fergus Henderson). Seasonal British menu (ox heart & chips, grilled mackerel, cold roast Gower lamb), 40-cover Thames-side terrace, Pink Floyd theme (name from *The Final Cut*; Animals cover). Opening "later this summer." Restaurant, 2026-07-16. https://www.restaurantonline.co.uk/Article/2026/07/16/bancone-founders-to-open-battersea-power-station-pub/
- **The Victoria, Battersea** listed/reviewed (nightlife directory refresh). InTravel, 2026-07-02. https://intravel.net/london/nightlife/the-victoria-battersea

## Brixton
- **NEW/REBRAND — The Rattlin Bog (was Paddy's Yard, formerly Market House), 443 Coldharbour Lane SW9 8LN.** Full Irish-theme relaunch, ~18 months after Paddy's Yard opened. brixtonbuzz, 2026-07-08. https://www.brixtonbuzz.com/2026/07/paddys-yard-in-brixton-to-be-reopened-as-the-rattlin-bog-irish-bar/
- **CLOSURE — Turtle Bay, Brixton Road** permanently closed (opened 2015 in former El Penol club site); follows Franco Manca's exit a month earlier — High Street franchise attrition. brixtonbuzz, 2026-06-30. https://www.brixtonbuzz.com/2026/06/turtle-bay-restaurant-in-brixton-has-now-permanently-closed/
- **Freight Brixton** (rooftop venue) — ongoing noise/licensing conflict; residents left a community meeting frustrated after months of complaints about bass/late-night disturbance. brixtonbuzz, 2026-07-01. https://www.brixtonbuzz.com/2026/07/residents-leave-freight-brixton-community-meeting-frustrated-as-venue-was-unable-to-commit-to-changes/
- **World Cup buzz:** pubs (Hootananny named) stayed open for 1am/2am England v Mexico kickoff, fans celebrated 3-2 win. brixtonbuzz, 2026-07-06. https://www.brixtonbuzz.com/2026/07/world-cup-in-brixton-fans-celebrate-englands-3-2-victory-over-mexico-in-the-early-hours-of-monday-morning/

## Peckham
- **Bar Levan / Levan** profiled as anchor of Peckham's drink scene (Mark Gurney & Matt Bushnell; Paris/natural-wine identity). CODE Hospitality, 2026-07-10. https://www.codehospitality.co.uk/industry_insights/code-neighbourhoods-mark-gurneys-peckham/
- Directory-fresh Peckham venues (all InTravel, late Jun 2026): **The Greyhound** (sports pub, 4.3, patio pizza "top 20 UK"), **Nags Head** (4.2, budget), **The Peckham Pelican** (LGBTQ-friendly, live performance), **Peckham Riviera** (leafy courtyard, hot dogs/pizza). https://intravel.net/london/nightlife/the-greyhound-peckham | .../nags-head-peckham | .../the-peckham-pelican | .../peckham-riviera
- Peckham Rooftop Cinema Club revealed autumn listings (101 Dalmatians special) — summer/autumn cultural draw. brixtonbuzz, 2026-07-16.
- Context: "Eat out for £10 in Peckham" restaurant food-pantry fundraiser referenced in Southwark News rail. southwarknews.co.uk, 2026-07-18.

## Camberwell
- **AWARD — The Camberwell Arms named among Britain's best gastropubs** (Time Out UK's 2026 top-gastropubs ranking; one of only two in London). Time Out, 2026-06-20 (https://www.timeout.com/london/news/best-uk-gastropubs-in-london-2026-062026); News Shopper, 2026-06-26 (https://www.newsshopper.co.uk/news/26227074.camberwell-arms-southwark-ranked-among-uks-best-gastropubs/).
- **The Bear** (Camberwell) — elevated pub food (hand-rolled cavatelli), vintage decor; positive writeup. Thatsup, 2026-06-29. https://thatsup.co.uk/london/bar/the-bear/
- **The Sun**, Coldharbour Lane — 2 beer gardens, restaurant-standard kitchen, community anchor. DesignMyNight, 2026-06-30. https://www.designmynight.com/london/pubs/camberwell/sun
- **The Kerfield Arms** reviewed by Good Food Guide, 2026-07-03. https://www.thegoodfoodguide.co.uk/restaurant/the-kerfield-arms/id/91946
- Nearby: Camberwell's community-owned coffee shop opened in railway arches (Southwark News rail, 2026-07-18) — community-ownership theme.

## Dulwich / East Dulwich / Herne Hill / Tulse Hill
- **NEW OPENING — The Victory, East Dulwich** — modern European bistro from **former Palmerston (gastropub) managers**. Southwark News, 2026-07-17. https://southwarknews.co.uk/area/dulwich/east-dulwich-welcomes-modern-european-bistro-the-victory-owned-by-former-palmerston-managers/
- **Tulse Hill Hotel** (19th-c pub → boutique hotel, Norwood Road) reviewed; avg nightly ~€142, review score 8.7 — pub-with-rooms model. roomscout, 2026-07-16. https://roomscout.co.uk/guides/tulse-hill-hotel-review/
- Herne Hill: no distinct last-30-day pub story surfaced (gap).

## Streatham
- **NEW OPENING — The Hill, Streatham High Road** — modern British "proper neighbourhood pub" from award-winning operators **Lisa Loebenberg & Emma Willis** (behind Exhibit and Mamma Dough); transformed from the independent SW16 Bar & Kitchen. 7 days/wk, Tuesday Steak Night, Wednesday free quiz, Sunday roasts. Opened ~mid-June, big PR push mid-July. brixtonbuzz 2026-07-15 (https://www.brixtonbuzz.com/2026/07/the-hill-in-streatham-opens-up-as-a-proper-neighbourhood-pub/); That's Food & Drink 2026-07-17 (https://thatsfoodanddrink.blogspot.com/2026/06/award-winning-operators-behind-exhibit.html).
- **Crown & Sceptre, Streatham** — under threat: proposed housing development would demolish interior and surround the pub with 117 "co-working" residential units, leaving a smaller "fake frontage" pub. Comment deadline extended. brixtonbuzz, 2026-06-24. https://www.brixtonbuzz.com/2026/06/deadline-extended-for-comments-on-the-huge-housing-development-at-the-crown-sceptre-pub-in-streatham/

## Tooting / Balham
- No Tooting/Balham-specific last-30-day pub opening/closure/price story surfaced beyond region-wide World Cup coverage (gap — worth a targeted re-run).

## Wandsworth / Putney
- Named in SW London big-match ritual coverage (see region context); no discrete opening/closure in-window. SW Londoner, 2026-07-16.

## Wimbledon
- **Prince of Wales, Wimbledon** (Greene King, "one of the oldest pubs in the area") — World Cup table-booking campaign. Greene King, updated 2026-07-16. https://www.greeneking.co.uk/pubs/greater-london/prince-of-wales-wimbledon
- **The Crooked Billet, 15 Crooked Billet SW19 4RQ** + neighbour (Wimbledon Common edge) — real-ale crawl writeup, Oakham Ales single-hop Citra 4.2% praised (no £ given). Steve the Beermeister, indexed 2026-07-17. http://stevethebeermeister.blogspot.com/2025/05/3-brothers-drinking-together-in-sw19.html
- **Pizza Pilgrims** opening in Wimbledon this August (food-led, not a pub but footfall driver). Hospitality & Catering News, 2026-07-14. https://www.hospitalityandcateringnews.com/2026/07/pizza-pilgrims-brings-a-slice-of-naples-to-wimbledon-this-august/

## Greenwich
- **Former Greenwich Pizza Hut** unit to get a new occupant (hospitality churn; specific tenant developing). From the Murky Depths, 2026-07-15. https://www.fromthemurkydepths.co.uk/2026/07/15/former-greenwich-pizza-hut-to-see-new-occupant/

## Deptford / New Cross
- **Deptford food-and-drink scene "changing fast"** — TOAD Bakery, Vietnamese + West African stalls, **Deptford Market Yard** now a hub for independents + craft-beer vendors; tension with closure of century-old **Manze's pie & mash** (shut Jan 2025). News Shopper, 2026-07-16. https://www.newsshopper.co.uk/news/26274979.everyones-talking-deptfords-changing-food-scene/
- **New Cross Inn** — active live-music/gig venue (Colombian crossover-thrash Psychomosher, 14 Jul 2026). Punktuation, 2026-07-15. https://www.punktuationmag.com/psychomosher-london-new-cross-inn-14th-july-2026/

## Lewisham / Catford
- **NEW/REOPENING — Model Market, 196 Lewisham High Street SE13 6LS** returns late summer 2026 under **German Kraft Brewery**; all-day model (coffee/co-working → micro-dining → evening street-food + craft beer). News Shopper, 2026-07-15. https://www.newsshopper.co.uk/news/26274359.model-market-returns-lewisham-shopping-centre-summer/
- **Fox & Firkin, Lewisham** — thriving live-music pub; World Cup big-screen + gig calendar (Buena Vista Live 16 Jul £10–18, New Regency Orchestra 12 Jul, Inner Circle 31 Jul). foxfirkin.com, indexed 2026-07-18. https://foxfirkin.com/
- **Black Horse & Harrow, Catford** — CAMRA-listed real-ale pub (directory refresh). CAMRA, 2026-07-12. https://camra.org.uk/pubs/black-horse-harrow-catford-158784
- **REFURB — Baring Hall Hotel, Grove Park** (Grove Park's only pub, shut for years) — restoration works have begun via The Baring Trust. News Shopper, 2026-07-15. https://www.newsshopper.co.uk/news/26259433.baring-hall-hotel-grove-park-refurbishment-works-begin-restore-pub/
- Catford: new Reggae musical-comedy (Windrush) coming to Catford (cultural texture). Southwark News rail, 2026-07-17.

## Forest Hill / Sydenham
- **Capitol, Forest Hill** (Grade II Art-Deco former cinema, Wetherspoon) referenced in real-ale crawl coverage. BRAPA blog, indexed 2026-07-17. http://brapa-4500.blogspot.com/2020/09/brapa-in-august-thrill-at-forest-hill.html
- No fresh Sydenham-specific opening/closure surfaced in-window (thin).

## Crystal Palace / Upper Norwood / South Norwood
- **The White Hart, 96 Church Rd SE19 2EZ** — weekly "Live Music Fridays" (rotating local artists, beer garden). Mood/events listings, dated 17 & 31 Jul 2026. https://events.musicofourdesire.com/event/oa5a-live-music-fridays-live-london-united-kingdom
- **South Norwood football pubs** feature (note: Crystal Palace FC actually play in South Norwood, not Crystal Palace) — texture on match-day locals. Enjoying Pubs (Substack), 2026-07-02. https://enjoyingpubs.substack.com/p/two-football-pubs-in-south-norwood
- **Khachapuri**, Crystal Palace — Georgian comfort-food spot getting local buzz (food, not pub, but scene signal). Taste London, 2026-07-03. https://tasteof.london/at-khachapuri-crystal-palace-discovers-the-soul-of-georgian-comfort-food/

## Penge / Anerley / Gipsy Hill / West Norwood
- **Craft Metropolis, Penge** — craft-beer bar, **10 rotating taps + 400+ cans/bottles** of independent craft beer, Yard Sale pizza, happy hour. InTravel, 2026-06-21. https://intravel.net/london/nightlife/craft-metropolis-penge
- **DEMOLITION — The Mitre, Croydon Road, Penge** being partially demolished; a neighbour's **£1.5m lawsuit failed**. News Shopper, 2026-06-23. https://www.newsshopper.co.uk/news/26219645.mitre-penge-pub-demolition---neighbours-1-5m-lawsuit-fails/
- **The Pawleyne Arms, Penge** — budget-friendly local, live music, sports (directory). InTravel, 2026-06-22. https://intravel.net/london/nightlife/the-pawleyne-arms-penge
- **Micropub crawl covering Penge, Anerley, Gipsy Hill, West Norwood, Beckenham, Addiscombe, Selsdon, Croydon** — a real one-day tram-and-taproom South London route; confirms a live micropub/taproom belt in the unsung SE/CR suburbs (no per-pub £ in extractable text). Micropub Adventures, 2026-06-17. https://micropubadventures.co.uk/2026/06/17/17-06-26-south-london/

## Bromley
- **REFURB (Grove Park, Bromley borough) — Baring Hall Hotel** restoration underway (see Lewisham/Catford). News Shopper, 2026-07-15.
- Bromley-specific opening/closure otherwise thin in-window; regional Spoons/refurb coverage dominated. (gap)

## Croydon
- **REFURB/REOPENING — The George (Wetherspoon), Croydon** reopening date revealed after major refurbishment. London Now / Your Local Guardian, 2026-07-15. https://www.london-now.co.uk/news/26279310.george-wetherspoon-pub-reopening-date-revealed/
- **CLOSURE — Bishop's Wine Bar, Whitgift Centre** closing for the final time (~early July); casualty of Croydon town-centre "development blight" (Westfield stall). Inside Croydon, 2026-06-26. https://insidecroydon.com/2026/06/26/bishops-wine-bar-set-to-bid-final-farewell-to-whitgift-centre/
- **Craft-beer movement in Croydon** — local breweries flourishing, small-batch focus; town positioned as a craft hub. Grants Centre Croydon, 2026-07-06. https://www.grantscentrecroydon.co.uk/croydons-historic-pubs-and-breweries.html
- Croydon also anchors the micropub crawl belt (Selsdon/Addiscombe/Croydon; see Penge). Micropub Adventures, 2026-06-17.

## Purley / Sutton
- No Purley/Sutton-specific last-30-day pub story surfaced. The dominant "newest Wetherspoons" story (Sir Ronald Wates, University of Surrey, Guildford — UK's first university-owned Spoons, opened 14 Jul 2026) is **Surrey, out of the South London scope** — flag so it isn't mis-filed. getsurrey, 2026-07-14/17. https://www.getsurrey.co.uk/news/surrey-news/new-first-kind-wetherspoons-pub-34289152 (gap for Purley/Sutton proper).

---

### Product implications
1. **Pint prices live on social, not in the press — mine it.** Local press almost never prints £/pint (only region anchors: London ≈£5.01 avg, £10 top-end; GK Peroni £3 promo). But a Firecrawl pass over Instagram/Facebook/TikTok surfaced real figures — Ramble Inn Tooting £5.70 Landlord; a Brixton indie at £3–4; Guinness £5 flat; Spoons match-night 50%-off. PUBMAXX should treat social-post scraping + user-submitted prices as the first-class Pint Price Index source (with a "self-reported/verify" confidence flag), because editorial won't fill the suburbs.
2. **Openings pipeline is a strong content spine.** Genuine new pubs in-window: The Hero's Return (Battersea Power Station), The Hill (Streatham), The Victory (East Dulwich), Model Market/German Kraft (Lewisham), Rattlin Bog (Brixton). A "New & Reopening in South London" auto-feed keyed off local press would stay fresh weekly.
3. **Closure/threat tracker resonates locally.** Turtle Bay (Brixton), Bishop's Wine Bar (Croydon), Crown & Sceptre (Streatham, demolition-by-development), The Mitre (Penge, demolition), Baring Hall (Grove Park, saved/refurb). A "watchlist / save-this-pub" feature (with ACV/community-asset status) maps directly to what these neighbourhoods are already fighting about.
4. **Operator-pedigree tagging.** Buzz clusters around WHO opens a pub: ex-St John (Hero's Return), ex-Palmerston (The Victory), Exhibit/Mamma Dough team (The Hill). A "from the people behind…" credibility badge would capture the signal locals actually use.
5. **Award/best-of hooks convert.** Camberwell Arms (Time Out top-gastropub) is exactly the shareable "best pint/best pub near you" unit. Surface accolades per-pub and per-neighbourhood.
6. **Match-day mode.** World Cup 2026 drove +11% spend; pubs self-tag as screening venues (Windmill, Junction, Prince of Wales, Fox & Firkin, Brixton late-openers). A live "who's showing the game + late licence + big screen" filter is high-intent and seasonal-evergreen (football, rugby, etc.).
7. **Micropub / taproom belt is under-mapped.** The unsung SE/CR corridor (Penge Craft Metropolis, Selsdon, Addiscombe, Gipsy Hill, West Norwood, Croydon breweries) is a coherent "craft-beer crawl" product — routeable, tram-linked, exactly the owner's named first-class suburbs. Build guided crawl routes here, not just Clapham/Brixton.
8. **Pub-with-rooms & food-hall hybrids** (Tulse Hill Hotel; Model Market; Deptford Market Yard) blur "pub." Decide taxonomy early: taprooms, food halls, and boutique pub-hotels all compete for the same "where do I drink tonight" intent.
9. **Live-music-as-differentiator.** Fox & Firkin (Lewisham), New Cross Inn, White Hart (Crystal Palace) trade on gig calendars. A "pub + live music tonight" cross-tag would pull a distinct South London audience.
10. **Guard against geo-misfiling.** "Surrey's newest Wetherspoons" (Guildford) and Kent's "East Peckham" (Tonbridge, NOT SE15 Peckham) both surfaced under South London queries — the data layer needs strict borough/postcode disambiguation or it will import out-of-area pubs.
