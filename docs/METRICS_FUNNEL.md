# Metrics funnel (Wave M)

First-class product metrics, computed entirely from the existing
consent-gated analytics rail (`lib/analytics.ts` → `POST /api/events` →
`lib/posthogServer.ts`). No new PII, no fingerprinting, no third-party
additions. Every event below is in the closed registry
(`lib/analyticsEvents.ts`) with an allow-listed prop shape; anything else is
dropped before it can leave the device or land in the log.

Consent gating is unchanged and certified (PR #294): `trackEvent()` no-ops
without explicit analytics consent, and `POST /api/events` re-validates
consent + the pseudonymous anon id server-side before forwarding anything to
PostHog. Nothing in this wave weakens that gate.

## 0. Crew Night metrics (S1)

**Per-night metric:** share of nights where a plan reaches **at least two committed
humans** on the crew roster, not scroll DAU on `/social`.

**Event:** `crew_committed` — fires client-side in `components/plan/PlanCrew.tsx`
after a confirmed `POST /api/plans/[id]/join` success. The host never emits
this event for their own plan (they are already a member at creation).

**Property:** `participants` — integer headcount on the plan crew after the
join succeeds (`nextCrew.length` in `PlanCrew.tsx`). The registry allows
integers from 1 through 100 inclusive (`lib/analyticsEvents.ts`).

**Formula:**

```
crew_nights_with_two_or_more = count(crew_committed WHERE participants >= 2, window=7d)
crew_night_rate              = crew_nights_with_two_or_more / count(plan_saved, window=7d)
```

Group by pseudonymous `distinct_id` when you need a per-planner rate. A single
plan may emit several `crew_committed` events as guests join; each carries the
then-current `participants` count, so the per-night filter is `participants >= 2`
on the event, not a dedupe by plan id (no plan id rides on this event).

**Why not RSVP-only:** `invite_rsvp_submitted` on `/invite/[token]` measures a
Going or Maybe tap on the public invite card. That is intent, not membership.
Guests can RSVP without joining the durable crew, and joining requires the
plan join path that emits `crew_committed`. RSVP counts stay useful for invite
page conversion (§7); they do not substitute for committed humans on the roster.

**Privacy:** `crew_committed` carries `source`, `participants`, and
`routeReady` only — no `planId`, no guest display name, no invite token. Public
invite events (`plan_invite_link_copied`, `invite_page_viewed`,
`invite_rsvp_submitted`, and the rest of §7) follow the same rule: no `planId`
on those link or guest-side events. See §7 for the id-hygiene rationale.

**Loop closure:** `next_night_committed` is the Crew Night loop's north star
(`docs/plans/CREW_NIGHT_LOOP.md` §0): a finished night turning into the next
one. Three usual-lot reinvite surfaces emit it, and they are the whole list:
`components/plan/LastCrewInvite.tsx` (source `crew-reinvite`),
`components/plan/CompletedPlanUsualLot.tsx` and
`components/night/MorningReentryCard.tsx` (both source `completed_plan`).
All three build their props through the one seam `nextNightCommittedProps`
(`lib/lastCrew.ts`): a closed `source` plus coarse `windowDays`, never a name,
a venue id or a coordinate. `crew_committed >= 2` measures one night;
`next_night_committed` measures the loop.

## 1. Nights planned / week

**Events (both pre-existing, reused as-is):**
- `plan_created` — fires client-side in `components/plan/PlanComposer.tsx` on
  a confirmed `POST /api/plans` success (the host's own plan).
- `crew_committed` — fires client-side in `components/plan/PlanCrew.tsx` on a
  confirmed `POST /api/plans/[id]/join` success, with `source: "shared-plan"`.

**Dedupe:** the two events are structurally exclusive — a host's own plan
never re-fires `crew_committed` for itself (the host is a member at
creation, not a joiner), and a guest join never fires `plan_created`. So:

```
nights_planned_per_week = count(plan_created, window=7d)
                        + count(crew_committed WHERE source = "shared-plan", window=7d)
```

grouped by the anonymous id (the `distinct_id` PostHog receives) to
get a per-planner rate.

## 2. Invites per planner (k-factor)

**New events:**
- `invite_created` — `{ inviteId }`. Fires in
  `components/plan/PlanCollaborationPanel.tsx` (`createInvite`) right after
  a host successfully mints a private, one-use invite link
  (`POST /api/plans/[id]/invites`).
- `invite_redeemed` — `{ inviteId }`. Fires in `components/plan/PlanCrew.tsx`
  after a guest's pending session is upgraded to full collaboration via
  `POST /api/plans/[id]/invites/redeem`.

`inviteId` is the invite's own database row id (a server-generated UUID) —
never the raw one-use invite token/capability that appears in the share URL.
It carries no PII and can't be replayed into a session, so it's safe to
transmit purely as a join key. Because it doesn't fit the registry's normal
fixed-enum string allowlist (that allowlist exists to block free text), it
gets its own format-only validator (`isUuidLike` in
`lib/analyticsEvents.ts`) instead of the enum check — everything else about
the sanitizer (unknown props dropped, unknown events rejected) still
applies.

`upgradeMemberInvite` in `lib/planCollaborationStore.ts` was extended to
return this `inviteId` (via a read-only lookup, no RPC/schema change) so the
redeem route can hand it back to the client; it's `null` on an
already-authorized replay, which correctly emits no event (an invite already
counted once should not double-count).

```
invites_created_per_planner   = count(invite_created)   / distinct planners
invites_redeemed_per_planner  = count(invite_redeemed)  / distinct planners
k_factor                      = count(invite_redeemed) / count(invite_created)
```

joining `invite_created.inviteId` to `invite_redeemed.inviteId` gives
per-invite conversion (time-to-redeem, redemption rate per planner) beyond
the raw ratio.

## 3. Return rate (daily basis)

**New event:** `activity_pulse` — `{ dayBucket }`, where `dayBucket` is a
plain integer: whole UTC days since the Unix epoch
(`lib/dailyActivity.ts::dayBucketFromDate`). No timestamp, no session
length, nothing derived from the visitor.

Fired by `components/DailyActivityPulse.tsx`, mounted once in
`app/layout.tsx` (alongside the other render-nothing analytics components).
On mount, if analytics consent is already granted, it compares today's day
bucket against the last one recorded in `localStorage`
(`pubmaxx:last-activity-day:v1`) and fires **at most once per UTC calendar
day** — a repeat visit or reload within the same day never double-counts
(`shouldRecordDailyActivity` in `lib/dailyActivity.ts`).

The event carries the same anonymous identity as every other event in the
rail (the pseudonymous id from `lib/analyticsIdentity.ts` / `anonymousAnalyticsId()`
in `lib/analytics.ts`) — no account identity, new identity concept, or
fingerprinting.

```
return_rate(window=Nd) = count(distinct_ids with >= 2 distinct dayBucket values in window)
                        / count(distinct_ids with >= 1 dayBucket value in window)
```

## 4. A2HS (Add to Home Screen) installs

**New events**, all fired by `components/A2HSTracking.tsx` (mounted once in
`app/layout.tsx`), no props:

- `pwa_install_prompt_available` — the browser fired `beforeinstallprompt`
  (Android/Chrome only; the event isn't in the standard DOM lib types, so
  it's attached with an `EventListener` cast). This is the top-of-funnel
  "eligible to install" signal.
- `pwa_install_completed` — the browser fired `appinstalled`, meaning the
  OS-level install actually completed.
- `pwa_standalone_launch` — on mount, `matchMedia('(display-mode:
  standalone)').matches` is true. iOS Safari never fires the two events
  above, so this is the iOS-compatible proxy: any launch of an already-
  installed PWA, on any platform, shows up here.

```
a2hs_install_rate (Android/Chrome) = count(pwa_install_completed) / count(pwa_install_prompt_available)
a2hs_installed_base (all platforms) = distinct ids with >= 1 pwa_standalone_launch
```

## 5. Community-price contribution rate

The key product metric for the price flywheel: how often opening a pub's sheet
turns into a logged price.

**Events (all new):**
- `price_submit_viewed` — `{ category }`. Fires once per venue-sheet open in
  `components/map/inspector/VenuePriceEntryPanel.tsx`, before the account branch.
  The panel is keyed by venue id, so it mounts once per pub; a ref guard makes
  the event one-per-mount even if the effect re-runs. `category` is the category
  the card opens on, never the one eventually chosen - the denominator must not
  wait for an interaction it exists to measure the absence of.
- `price_submitted` — `{ category }`. Fires only after the POST is confirmed,
  never on the optimistic restamp.
- `price_submit_failed` — `{ category, reason }`. `reason` is a three-value
  enum: `invalid` (the client-side envelope check), `rejected` (a non-2xx from
  `/api/price-submit`), `offline` (transport failure).
- `price_impact_opened` - no properties. Fires only when a credited submitter
  opens their own public profile from the confirmed price receipt. It carries
  no handle, Venue, price, category, or free text.
- `contribution_gate` - `{ step }`. Fires when required identity adds
  friction. The closed steps are `sign_in_required` and
  `onboarding_required`. No handle, account id, birth date, venue or price is
  sent.
- `sign_in_initiated` - `{ provider }`. Its fixed provider values are `google`,
  `apple`, and `email`, so magic-link dependence remains measurable while
  social providers are disabled.

```
community_price_submission_rate = count(price_submitted)
                                / count(price_submit_viewed)

price_impact_open_rate = count(price_impact_opened)
                       / count(price_submitted)

required_sign_in_cost = count(contribution_gate where step = sign_in_required)
                      / count(price_submit_viewed)

onboarding_cost = count(contribution_gate where step = onboarding_required)
                / count(price_submit_viewed)
```

`category` is the closed drink taxonomy (`PRICE_SUBMIT_CATEGORIES`, pinned to
`DrinkCategory` by the `completeDrinkTaxonomy` helper, which enforces coverage
in both directions: no unknown value, no missing category). No venue id, no venue name, no price,
and no error sentence ever rides along - the funnel is answerable from the
category alone, and the sanitizer drops everything else. All three events fail
closed on a missing or off-enum prop.

**Corroborated stock, not just flow.** The submission *rate* is the flow; the
stock it builds is the count of (venue, drink category) pairs whose community
price the map is actually allowed to paint. `GET /api/freshness` reports it as
`communityPrices.corroboratedCategories`, derived on the read path from the
same corroboration + age rules the map uses (`lib/communityPrice.ts`), so it
can never claim a figure the map would refuse. `truncated` marks the bounded
scan's cap; `degraded` marks an unavailable store rather than a real zero.

## 5b. Price evidence missions

One useful Community Price task at a time for a signed-in Pubmaxxer. The
events answer whether a ranked mission was seen, opened, skipped, logged, and
whether the write-back made the figure trusted.

**Events:**
- `mission_viewed` — `{ surface, reason, category? }`. Fires once per ranked
  mission shown on `/near` or inside the selected Map venue sheet.
- `mission_opened` — `{ surface, reason, category? }`. `/near` fires on the
  Log it tap. The Map sheet fires when the mission composer is already the
  open surface.
- `mission_dismissed` — `{ surface, reason, category? }`. Session-only skip.
- `mission_submitted` — `{ surface, reason, category?, outcome }`. Fires after
  the authoritative `/api/price-submit` write-back. `outcome` is `logged`,
  `trusted`, or `needs_check`.
- `mission_newly_trusted` — same props. Fires only when that write-back is
  corroborated, in window, and the category may colour the map.
- `mission_impact_opened` — `{ surface }`. Fires when the personal
  contributions card is shown. `surface` is `profile`.

`surface` is `near`, `map`, or `profile`. `reason` is `provisional`, `stale`, or
`missing`. `category` is the closed drink taxonomy and is omitted on a missing
mission. No venue id, handle, price, or coordinate ever rides along. The
required keys, and the validator that closes each vocabulary, are under
[Registry additions](#registry-additions).

## 6. Press arrival (the London Pint Index)

One press hit is meant to convert above 2% to a second session. That claim is
only checkable if three numbers are separable: how many ARRIVED, how many
reached a MAP VIEW of an area they care about, and how many CAME BACK.

**Events (all new):**
- `pint_index_viewed` - `{ surface, visit }`. Fires once per Pint Index page
  view from `components/pintindex/PintIndexArrival.tsx` (a ref guard keeps a
  re-running effect from inflating the denominator). `surface` is `index` (the
  live page) or `archive` (a dated monthly edition), because a press link to a
  frozen edition and one to the live page convert differently. `visit` is
  `first` or `repeat`, from a one-key local marker
  (`pubmaxx:pint-index-seen:v1`) that is only read or written once analytics
  consent exists, exactly like the daily activity pulse.
- `pint_index_area_opened` - `{ surface, area }`. The tap on an area chip.
  `area` is a London borough code from the closed list the Index itself is
  built on (`PINT_INDEX_AREA_CODES`), never a venue id, a coordinate, or
  anything typed.
- `pint_index_map_reached` - no props. Fires from
  `components/pintindex/PintIndexMapArrival.tsx` when the map route actually
  loads carrying the arrival marker, so an abandoned navigation cannot inflate
  reach. That component then strips the marker out of the URL, so a shared map
  link can never report strangers as Index arrivals.

```
arrivals            = count(pint_index_viewed)
map_reach_rate      = count(pint_index_map_reached) / count(pint_index_area_opened)
arrival_to_map_rate = count(pint_index_map_reached) / count(pint_index_viewed)
index_return_rate   = count(pint_index_viewed where visit = "repeat") / arrivals
```

**Second session** reuses the existing return-rate rail rather than inventing a
new one: an identity that fired `pint_index_viewed` on day D and any
`activity_pulse` with a later `dayBucket` came back to the product, not just to
the page.

```
second_session_rate = count(distinct ids with pint_index_viewed on day D
                            and activity_pulse on any day > D)
                    / count(distinct ids with pint_index_viewed)
```

## 7. Invite loop (a Plan's public invite page)

The invite k-factor in §2 counts a redeemed invite, but says nothing about
the separate public invite page itself (`/invite/[token]`, a Partiful-style
card any guest with the link can open, RSVP on, and react to with no
account). These events measure that page as its own funnel: copy/rotate on
the host side, then view, RSVP, react and map-click on the guest side.

**Events (all new):**
- `plan_invite_link_copied` — no props. Fires in
  `components/plan/PlanHostInviteLink.tsx` (`copyLink`) after the link is
  written to the clipboard.
- `plan_invite_link_rotated` — no props. Fires in the same file
  (`rotateLink`), only after `POST /api/plans/[id]/invite-rotate` confirms a
  new token, never on a failed or refused rotation.
- `invite_page_viewed` — `{ hasRsvps: boolean }`. Fires once per mount of
  `/invite/[token]` from a new render-nothing client component,
  `components/plan/InvitePageView.tsx`, mirroring
  `PintIndexArrival.tsx`'s ref-guarded mount-once pattern so a re-running
  effect cannot inflate the count. `hasRsvps` is server-computed from the
  RSVP summary the page already loads to render the card, so the funnel can
  split "guest lands on an empty invite" from "guest lands on one with a
  guest list already".
- `invite_rsvp_submitted` — `{ status: "going" | "maybe", isUpdate: boolean
  }`. Fires in `components/plan/PlanInviteRsvp.tsx` (`submitRsvp`) after
  `POST /api/invite/[token]/rsvp` confirms. `isUpdate` reports whether this
  device already held an RSVP for the Plan (a Going/Maybe change) versus a
  brand-new guest — sourced server-side from the existence check the write
  already makes (`PlanInviteRsvpStore.upsert`'s widened
  `{ summary, isUpdate }` return), not a second query.
- `invite_reaction_toggled` — `{ reaction, active: boolean }`. Fires in the
  same file (`toggleReaction`) after `POST /api/invite/[token]/reactions`
  confirms. `reaction` is the closed pub-reaction vocabulary
  (`REACTION_KEYS` in `lib/reactions.ts`). `active` is derived client-side
  from whether the confirmed summary's `mine` list now includes the reaction
  — no server change needed, since the toggle response already carries that
  answer.
- `invite_map_opened` — no props. Fires from a new small client component,
  `components/plan/InviteMapLink.tsx`, on the "Open these stops on the map"
  link under the stop list. One stop opens `/map?sel=<id>` via `venueMapUrl`;
  two or more opens the ordered crawl via `buildCrawlMapHref`
  (`/map?mode=build&pubs=…`).

**Id hygiene — no `planId` on the link events.** `plan_invite_link_copied`
and `plan_invite_link_rotated` carry no plan identifier at all, by design.
The brief that requested these events offered `planId-hashed or none`; this
wave chose none, because a raw or hashed `planId` here would have no working
precedent to follow and no use once added. `inviteId` on `invite_created` /
`invite_redeemed` (§2) exists specifically to join two named events
together into a redemption rate — that join is the only reason an opaque
row id is allowed to ride in a prop at all. The copy/rotate events have no
paired event to join against, and PostHog already aggregates every event
per pseudonymous `distinct_id` without needing a plan-level key. Adding one
would carry a real plan row id off the device for no measurable gain, which
is exactly what the registry's allow-list exists to prevent.

**Privacy:** no raw device id, guest display name, or invite token ever
rides in any of these six events — `submitterId`/`submitterHash` and the
invite token stay server-side, matching the pattern below every other event
in this rail. The "Open these stops on the map" link is pure navigation, not
a new data practice: `/privacy` already discloses, under "If you use an
invite link", that a guest can RSVP and react without an account and that
PUBMAXX stores the display name, RSVP choice, reaction choices, and a
salted device-id hash — a link to the map adds no new collection, so no
privacy-page change was needed for this wave.

```
invite_link_share_rate  = count(plan_invite_link_copied) / distinct hosts
invite_view_to_rsvp_rate = count(invite_rsvp_submitted) / count(invite_page_viewed)
invite_view_to_reaction_rate = count(invite_reaction_toggled) / count(invite_page_viewed)
invite_view_to_map_rate = count(invite_map_opened) / count(invite_page_viewed)
rsvp_change_rate        = count(invite_rsvp_submitted where isUpdate = true)
                        / count(invite_rsvp_submitted)
```

## 8. Near answer-to-open conversion

`/near` measures whether a useful price answer leads to a Venue open without
making acceptance part of the funnel. `near_answer_ready` fires once for the
latest completed answer. A superseded answer fires nothing.
`near_venue_opened` fires before the selected result navigates to its Venue
sheet.

Source distinguishes a direct location answer from remembered, picked, and
default area answers without naming the area. Result count and row position
use coarse bands owned by `lib/nearAnalytics.ts`; their closed schemas remain
in `lib/analyticsEvents.ts`.

```
near_answer_to_open_rate = count(near_venue_opened) / count(near_answer_ready)
```

Each event carries only the source and its result or position band. No Venue
ID, Venue name, coordinate, area, price, or free text leaves the device in
these events. Consent gating and server-side validation remain the same as for
every event in this document.

Desk mode is a second question on the same page, not a second funnel.
`near_mode_switched` fires only when the drinker taps Pint or Desk, with
`mode` (`pint` | `desk`). `desk_answer_served` fires once for the latest
completed desk answer (`outcome` `answer` | `thin`). A failed pack read
emits nothing, because that is not a locality with no desks. Neither event
carries a coordinate, handle, venue id, or area name.

## Registry additions

All six new event names were added to `ANALYTICS_EVENTS` in
`lib/analyticsEvents.ts` with their prop allow-lists:

```ts
invite_created: ["inviteId"],
invite_redeemed: ["inviteId"],
activity_pulse: ["dayBucket"],
pwa_install_prompt_available: [],
pwa_install_completed: [],
pwa_standalone_launch: [],
```

The community-price funnel added five more, with scoped validators
(`isAllowedPriceFunnelProp` and `isAllowedContributionGateProp`) so shared prop
keys keep the right closed set per event:

```ts
price_submit_viewed: ["category"],
price_submitted: ["category"],
price_submit_failed: ["category", "reason"],
price_impact_opened: [],
contribution_gate: ["step"],
```

The price evidence missions (§5b) added six more, with their own scoped
validator (`isAllowedMissionProp`) so `surface`, `reason`, `category` and
`outcome` each keep their own closed set:

```ts
mission_viewed: ["surface", "reason", "category"],
mission_opened: ["surface", "reason", "category"],
mission_dismissed: ["surface", "reason", "category"],
mission_submitted: ["surface", "reason", "category", "outcome"],
mission_newly_trusted: ["surface", "reason", "category", "outcome"],
mission_impact_opened: ["surface"],
```

The first five are also in `TRUSTED_HANDOFF_REQUIRED_KEYS`: `surface` and `reason`
on every one, plus `outcome` on the two submit events. `category` is optional,
because a missing mission names no drink. `mission_impact_opened` requires
`surface` only.

The press-arrival funnel added three more, with the same treatment
(`isAllowedPintIndexArrivalProp`) so `surface`, `visit` and `area` each keep
their own closed vocabulary:

```ts
pint_index_viewed: ["surface", "visit"],
pint_index_area_opened: ["surface", "area"],
pint_index_map_reached: [],
```

The invite loop (§7) added six more, with a new scoped validator
(`isAllowedInviteLoopProp`) covering `status` and `reaction`'s closed
vocabularies:

```ts
plan_invite_link_copied: [],
plan_invite_link_rotated: [],
invite_page_viewed: ["hasRsvps"],
invite_rsvp_submitted: ["status", "isUpdate"],
invite_reaction_toggled: ["reaction", "active"],
invite_map_opened: [],
```

`invite_page_viewed`, `invite_rsvp_submitted`, and `invite_reaction_toggled`
were also added to `TRUSTED_HANDOFF_REQUIRED_KEYS`: a page view with no RSVP
context, an RSVP with no status, or a reaction toggle with no reaction/
direction is an uncountable step in a ratio-based funnel, so each fails
closed rather than landing partial.

## Tests

- `__tests__/pintIndexArrival.test.ts` — the arrival strip's area selection and
  the three press-arrival events: a step with a missing `surface`/`visit`/`area`
  is rejected outright, a venue id or an off-list area never survives, and the
  borough vocabulary the chips emit is pinned to the one the sanitiser allows
  (a drift there would silently drop every area tap).
- `__tests__/analyticsEvents.test.ts` — registry completeness + sanitizer
  behavior for all six new events (UUID inviteId accepted, non-UUID/free-text
  rejected; bounded numeric dayBucket accepted, `NaN`/negative rejected;
  no-prop events ignore any extra input).
- `__tests__/dailyActivity.test.ts` — pure helpers: `dayBucketFromDate`,
  `shouldRecordDailyActivity` (once-per-day dedupe), `parseStoredDayBucket`
  (defensive parsing of a possibly-malformed stored value).
- `__tests__/planCollaborationRoutes.test.ts` (pre-existing, unmodified)
  still passes with `upgradeMemberInvite`'s widened return type — it asserts
  via `toMatchObject`, so the added `inviteId` field is additive.
- `__tests__/analyticsEvents.test.ts` — also covers all six invite-loop
  events: the three no-prop events accept no input and ignore extras; `status`
  and `reaction` are pinned to their closed vocabularies (`going`/`maybe`,
  the five `REACTION_KEYS`) with an off-list value rejected; `isUpdate` and
  `active` accept only booleans; `invite_page_viewed`,
  `invite_rsvp_submitted`, and `invite_reaction_toggled` fail closed when
  their required prop is missing.

## Wave 0.5 loop metrics

The closed registry also carries the complete Plan to Memory to Story loop.
All timing comes from server-owned PostHog event timestamps for the existing
pseudonymous `distinct_id`; client-supplied timestamps are ignored. Event props
never include durations, account ids, Plan ids, raw coordinates, free text, or
user content.

| Event | Confirmed seam | Allowed props |
|---|---|---|
| `plan_generated` | A non-empty grounded route returns from `/api/plans/generate` | `stops`, `grounded` |
| `plan_accepted` | First server-verified transition to a grounded, Route-ready three-Stop Plan; original and replay responses return the same signed delivery token, while ingest records/forwards it once | `stops` (`3`), `grounded` (`true`), `anchored`, `routeReady` (`true`), `source` |
| `plan_saved` | The created Plan and its route metadata finish saving | `stops`, `grounded` |
| `plan_completed` | The completion response is checked against canonical completed Plan state | `ending` |
| `memory_reviewed` | The completed Plan's inline editor or full private recap is explicitly opened | `source` (`inline_recap` or `full_recap`) |
| `story_published` | The separate Story publication confirmation succeeds | `visibility`, `contributors`, `moments` |

`claim_started` and `claim_completed` remain accepted only for historical
schema compatibility. Account onboarding replaced `/api/identity/claim`, so no
current surface emits either event.

Activation is the elapsed time from `plan_generated` to the first verified
`plan_accepted` with `stops = 3`, `grounded = true`, `routeReady = true` for the
same pseudonymous identity. `plan_saved` and `plan_draft_saved` remain separate
signals and never enter this grounded-Route activation measure. The anchored
one-Stop-to-three-Stop lifecycle is permanent: an anchor-only creation emits
`plan_draft_saved` and never `plan_accepted`, and the verified three-Stop route
(creation, or the grounded upgrade on `PATCH /api/plans/:id`) carries the
server-owned acceptance token. Direct/manual unanchored Plans still emit no
`plan_accepted`: their creation response returns an empty
`meaningfulCoreAction`, so the client condition fails closed.
`grounded`, `anchored`, `routeReady`, and
`source` on acceptance are server-owned: generation returns a two-hour HMAC
proof covering its candidate Venue ids and one create idempotency operation.
Plan creation verifies the exact accepted three-stop route against that proof
after canonical Venue Dataset resolution. The proof digest is part of the
durable create request hash, so a replay cannot remove or replace attribution;
the original Plan creation time reconstructs the same result after proof expiry.
Draft storage may retain the signed proof and operation for recovery, but never
a writable grounding boolean. Manual venue edits invalidate both in the composer,
and the API independently fails closed for stale, forged, or cross-operation proof reuse.

Acceptance and completion loop events use a consent-gated verified-delivery
path. Their canonical API responses return stable signed tokens on both the
original response and every idempotent replay. The browser keeps unacknowledged
tokens in a bounded local outbox and retries them. Revoking consent in any tab
aborts active delivery requests, clears persistent and tab-local outboxes, and
advances each observing tab's consent epoch. Cross-tab storage changes replace,
never merge, verified memory after revocation, so granting consent again cannot
replay an event retained by another tab. `/api/events` verifies the
exact sanitized event, claims a service-role-only `analytics_event_receipts`
row, and forwards a stable derived event id as PostHog `$insert_id`. The signed
token, Plan/completion id, and receipt hash are never event props. Provider or
acknowledgement loss leaves the receipt pending for retry; completed receipts
make later submissions no-ops. Verified events use the occurrence time signed
into their token as the provider timestamp, including after a delayed retry;
ordinary events continue to use server receipt time and ignore client-supplied
timestamps. This delivery rail is funnel telemetry only and
does not change the PNC ledger authority below.

The signing root is operator-configured (at least 32 random bytes) for every
Supabase-backed or production process. A non-production keyless demo instead
gets one random process-local key, matching its in-memory lifetime; there is no
public development signing constant. The storage-only `PUBMAX_E2E_KEYLESS`
escape never changes this signing policy. If trusted signing is misconfigured, Plan
generation, creation, and completion fail before mutation with a retryable 503,
while verified event ingestion retains pending delivery for retry. Once a
configured key is present, tokens with invalid signatures are discarded.

Weekly Meaningful Pubmaxxers is the number of distinct pseudonymous identities
with at least one `meaningful_core_action` in a seven-day window. Its `action`
is a fixed enum and can only be one of:

- `plan_accepted`
- `plan_saved`
- `plan_completed`
- `memory_reviewed`
- `story_published`

Route generation, claim steps, generic page views, install signals, and passive opens
do not qualify. Each qualifying event is emitted beside its primary loop event
only after the corresponding product action succeeds. Confirmed Planned Nights
remain defined solely by the durable, service-role-only
`pnc_qualified_completions` view. The browser `plan_completed` event is only
funnel and Weekly Meaningful Pubmaxxers telemetry; it cannot increment or
replace PNC. Loop depth uses `memory_reviewed` after completion, while Story
publication remains separately queryable through `story_published`.
