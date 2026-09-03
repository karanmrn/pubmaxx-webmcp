# Mobile Flow Spec — PUBMAXXING

Mobile-first contract for transitions, map URLs, back-stack behaviour, and state
preservation. Primary navigation labels and destinations are owned by
`components/nav/navigationModel.ts`; `MobileTabBar.tsx` composes phone-only
actions around that model. Do not copy the current tab roster here.

## 1. Primary navigation

The shared navigation model is authoritative for durable destinations, display
labels, and active-path matching. Read the roster and the match sets there;
`/feed`, `/stories`, `/discover`, `/drinks` and `/crawls` are supporting content
matched to one social destination, not alternate names for it.

Reachability rule: every content surface must be reachable in ≤2 taps from a tab.

## 2. Transition table

FROM surface × intent → TO surface, with the exact mechanic. Deep-link params are the
`/map` contract in §3. "Back" = the browser/OS back gesture.

| From | Intent | To | Mechanic | Back |
|------|--------|----|----------|------|
| Discover / drink card | "show me these on the map" | Map (drink lens) | `Link` → `/map?drink=<cat>` (or `food=1&q=<cuisine>`, `cocktails=1`, `crawl=<id>`). A non-beer `drink` PRICES the map by that drink (colour, pin figure, cheapest-area list) rather than narrowing it; the other params still narrow pins + list. | back → Discover, scroll restored |
| Pubs list item | "put this pub on the map" | Map pin | `Link` → `venueMapUrl(id)` = `/map?sel=<id>`. MUST open the venue sheet AND centre the camera on the pin (fly-to). | sheet closes first, then back → Pubs |
| Near / Tonight result | "keep this Venue" | Accepted Map Venue | Explicit Keep action writes PlanningIntent, then opens `sel` with verified `accept=1&src=<source>`. Browsing the result writes nothing. | back → source result |
| Venue sheet (pub) | "make this Stop 1" | Plan | Sticky action `Make it Stop 1` confirms the local write before opening `/plan`. An accepted arrival keeps its own source; another pub sheet records how it was selected, and `map-search` when nothing named it. Storage failure stays on the Venue and announces the error. | back → Venue |
| Feed story | "see this pub" → "on the map" | Venue → Map | Story pub `Link` → `/map?sel=<venueId>` (same sheet+centre contract as Pubs). | sheet → back → Feed |
| Crawl editorial | "walk this crawl" | Map crawl mode | `Link` → `/map?crawl=<id>` (curated) or `?mode=build&pubs=<ids>`. Map draws the polyline + route panel. | back → Crawls |
| Pint Drop composer | finished / cancelled | back where they were | Composer is a mode of Map (`?log=1`), not a page. Closing clears `log` and returns to the map beneath; if arrived from a tab, the tab's root shows. | closing composer ≠ leaving Map |
| Invite card | "see these stops" | Map | `Open these stops on the map` is unconditional: one stop opens `?sel=`, two or more open the ordered crawl in build mode. A confirmed RSVP is remembered per Plan on the guest's own device and only changes the emphasis. See [`specs/mobile-invite-rsvp-map-handoff.md`](../specs/mobile-invite-rsvp-map-handoff.md). | back → invite card |
| Plan link (shared) | "join this plan" | Map of the plan's stops | `/plan/<id>` → join → `/map?pubs=<stops>&mode=build` showing the route. | back → plan detail |
| You | passport / activity / messages | profile sub-screens | `/u/<handle>`, `/activity`, `/messages` — in-tab pushes with back to the tab root. | back within You tab |

The Pint Drop composer is price-first. The selected Venue comes from the sheet,
so the first step shows price quick-add controls, drink, and one `Log it` action.
Photo, story, vibe, visibility, and destination fields stay behind one
`Add a photo or story` disclosure. A recovered draft that contains extra content
opens that disclosure so its content stays visible. Signed-out visitors can enter
the price, but the submit position is the sign-in gate. Account-bound authorship
and the keyless demo handle exception remain unchanged; exact door copy belongs to
`lib/spill.ts`.

After any successful route generation, including describe-first chips and the
concierge path, the route status moves into view and receives focus. Reduced
motion changes the scroll to an immediate jump, not a skipped reveal.

### Venue reveal

Selecting a Venue opens its mobile sheet at the half snap while the map centres
the selected pin. A fresh selection uses a maximum 480 ms entrance overlapped
with the 700 ms camera move. Content is present at its final values from the
first frame; reveal motion uses transform and opacity only.

The same reveal state, trust rules, and timing apply to the desktop side drawer;
its side-drawer spring mirrors the phone sheet's entrance. On phones, the sheet
opens at the half snap with its overshoot. The fresh form staggers the photo,
price provenance, dated occupancy and Tonight signals, and story content in at
most four children, 40 ms apart. Figures stay static: live signals use a dated
rise-in only, with no physics or count-up. Drag, scroll, another selection, or
Escape interrupts the entrance and settles the sheet. Reduced motion disables
all new reveal motion. The trust-tier choreography, short-form timing, and
browser contract live in
[`docs/proof/venue-reveal/README.md`](proof/venue-reveal/README.md) and
[`e2e/venue-reveal.spec.ts`](../e2e/venue-reveal.spec.ts).

## 3. The `/map` URL param contract (single source of truth)

Read/round-tripped in `lib/crawlUrl.ts` + `components/PubMap.tsx`. Decode never throws;
unknown/malformed params are ignored.

| Param | Meaning | Read? | Write-back? |
|-------|---------|-------|-------------|
| `sel=<venueId>` | Select a venue: force-include pin + open sheet. | yes | yes |
| `mode=suggest\|build` | Crawl planner mode. | yes | yes (omit `suggest`) |
| `crawl=<id>` | Named curated crawl → hydrate polyline map-first. | yes | yes |
| `pubs=<id,id>` | Hand-built crawl stop ids. | yes | yes |
| `style=<crawlStyle>` | Scoring style (heritage/balanced/…). | yes | yes |
| `alt=<pint\|food\|coffee\|mocktail>` | "Kind of night" copy label. | yes | yes |
| `drink=<category>` | Drink lens. A non-beer category PRICES the map by that drink (pin colour, labelled pin figure, cheapest-area list) and drops the narrowing drink/brand/max-price facets; `beer` keeps the old narrowing behaviour. Only lensable categories are accepted - `other` is ignored, because the picker can neither show nor clear it. | yes | yes |
| `brand=<id>` | Brand within the drink lens. Honoured on the beer/favourite-pint path; a non-beer drink lens drops it, because community category prices name no brand. | yes | yes |
| `cocktails=1` | Cocktail lens shortcut. | yes | yes |
| `food=1` | Serves-food filter. | yes | yes |
| `q=<text>` | Free query; also carries the **cuisine hint** (no dedicated `cuisine` param). | yes | yes |
| `band=<id>` | Story-band overlay. | yes | yes |
| `landmark=<id>` | Landmark chapter fly-to. | yes | yes |
| `max`,`stops`,`win` | Planner sliders (clamped). | yes | yes |
| `log=1` | Open the Pint Drop composer. | yes | no (write-only intent flag) |
| `place=<name>` + `lat`,`lng` | Uncovered UK place arrival: frame the map there and stand the city chrome down. Resolved server-side in `app/map/page.tsx` against the place index, never read from the URL by the client. | server only | preserved (passthrough) |

Gaps to flag: **cuisine has no first-class param** (rides `food=1&q=`); **`log`
never round-trips**; there is **no `lens=` alias** — the lens is `drink`/`cocktails`.
UI agents: use `venueMapUrl(id)` and the `crawlUrl` encoders, never hand-build.

## 4. Back-stack rules

1. **Tab switches never build history.** Tapping a bottom tab replaces, it does not
   push — back must never walk the user backward through tabs they tapped.
2. **In-tab pushes DO build history** (list→detail, story→venue, plan→join).
3. **The sheet closes before the tab pops.** With the venue sheet or planner open
   (`appShell.detail-open` / `.planning-open`), the first back gesture closes the
   overlay; only a second back leaves the map. The tab bar is hidden while an overlay
   is up (mobileNav.css) — back must dismiss the overlay, not the whole page.
4. **Scroll restoration:** returning to Discover / Pubs / Stories restores the prior
   scroll position (Next default scroll restoration); deep-linking into Map does not
   inherit list scroll.

## 5. State-preservation rules

1. Switching tabs and returning to Map **preserves camera + filters** — the map keeps
   its centre/zoom/pitch and any active `drink`/`band`/`crawl` lens.
2. A **half-written Pint Drop is never silently lost** — leaving the composer keeps its
   draft (venue + text) until explicitly discarded or posted.
3. Filters are URL-truth: the map's state is reconstructable from the address bar, so a
   shared link reproduces exactly what the sender saw.

## 6. Drift checks

Navigation and feed-destination regressions belong in the shared navigation
model and `e2e/mobile-bottom-nav.spec.ts`. Product gaps belong in the issue
tracker rather than a second implementation inventory here.
