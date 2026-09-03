# PRD: UI/UX fix wave (screenshot-audited, 2026-08-08)

> Executor: Cursor. One PR per numbered item unless marked bundle-ok.
> Screenshots: `docs/prd/shots/` - `d-*` desktop 1440, `m-*` mobile 390,
> captured from LIVE production 2026-08-08 after the fix-day deploy.
> Sibling feature PRD: `PUBPAL_CONNECTIONS_PRD.md` (voice pal, ride handoff).
> Laws: root `AGENTS.md` + `docs/VOICE.md` bind every item. The three
> guardrails at the end of the sibling PRD apply here verbatim.

## Why we build (the mission, from the founder)

PUBMAXX is a D2C app for everyone, London-first. Instagram and TikTok glue
people to screens and pull them apart; we exist to put real people in real
places together - pubs, plans, crews, community. London is the best city in
the world to live in and deserves its own platform gravity. Every fix below
serves one test: does this help a real person get out, meet people, and get
home safe? Trust is the product: honest prices, honest copy, no invented
anything.

## Findings and fixes

### 1. Tonight desktop double-renders every listing (`d-tonight.png`)

The main column and the right rail each render the full live-music list -
Maiden Voyage, MT Pockets, Saturday Basement Karaoke appear TWICE on one
screen. Decide the owner: the rail should hold weather + a compact "on
tonight" summary linking down, or the main column should hold the summary
and the rail the detail - never both full lists. Keep the honest dating
lines ("No date on this yet", "Listed time" with source) exactly as they
are; they are law-compliant and good.

### 2. Mood chips wear two different skins (`m-pal.png` vs `d-tonight.png`)

The same seven vibe chips ("On a bender" ... "Date night") render as
rounded-pill uppercase mono on /pal/chat and as a different bordered style
with different type on /tonight. One component, one skin: extract a shared
`VibeChips` component (or align the CSS to one recipe from the house
ledger), used by both surfaces. No behaviour change.

### 3. Consent banner overlaps page actions (`d-tonight.png`, `d-plan.png`)

The analytics consent card is fixed above the tab bar on phone and over page
footers on desktop until answered. Reserve body foot clearance while it is
mounted so scroll-surface actions stay tappable. Shipped in `app/globals.css`;
`__tests__/analyticsConsentDesktopClearance.test.ts` and
`e2e/ux-consent-chrome.spec.ts` pin the contract.

### 4. /near has no h1 (accessibility)

The page's lead sentence ("Compare listed pint prices near you, cheapest
first.") is not a heading; screen readers get no page title. Make it the h1
(visually unchanged if desired). While there: verify every route has exactly
one h1 (a cheap unit test over rendered route markup for the static pages).

### 5. Mug-check compare line: verify the empty case (`lib/venueAreaPriceCompare`)

On a venue with a displayable pint in a borough with a league row, the
compare line must render; my earlier live check on The Landor showed none.
Reproduce with keyless fixtures: if the line correctly requires a published
borough yardstick that Lambeth lacks, add an honest fallback line is NOT
wanted - silence is correct - but add a unit fixture proving the
borough-present case renders. If it is a bug (league rows load async and the
component gives up), fix the race.

### 6. Mobile Pal page: dead middle (`m-pal.png`)

Between the two answer cards and the consent bar sits a viewport-tall empty
region. Pull the cards up / let content flow naturally; the page should end
where content ends.

### 7. Screenshot baseline going forward (bundle-ok with any item)

Add `docs/prd/shots/README.md` noting these are the 2026-08-08 baseline;
future UI PRs that change these surfaces refresh the matching shot in the
same PR, so the folder stays the visual state of record.

## Out of scope here

Voice pal, ride handoff, food ending - `PUBPAL_CONNECTIONS_PRD.md`.
Known code-quality follow-ups (search-suggest complexity/duplication,
sanitizeEvent target case, store factory ports) - `docs/AGENT_STATE.md`.
