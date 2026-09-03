# PRD: PubPal voice, get-home ride handoff, food ending

> Status: APPROVED direction (captain, 2026-08-08): safety-first spine.
> Executor: Cursor. One PR per work package. Every package obeys the three
> guardrails at the bottom; they are law, not advice.
> Research evidence: firstmate scout reports of 2026-08-08 (ElevenLabs docs,
> Uber deep-link docs, Drinkaware/TfL guidance - sources cited there).

## The thesis

All three features are connections from surfaces that already exist, not new
products. The night has endings (`food` / `get_home` / `keep_going` in
`lib/planEndings.ts`), the venue sheet has a Getting Home tab, and the pal
already has a working ElevenLabs voice loop behind
`app/api/pub-pal/voice-token/route.ts` + `components/pubpal/PubPalVoice.tsx`.
Ship handoffs, not integrations. The safety spine is non-negotiable: the
killer moment is a drunk user getting home, and nothing may joke, guess, or
promise inside that moment.

## Panel verdict

- Ride handoff: unanimous ship-first.
- Voice: build DIFFERENTLY - the skeptic found real defects that are now
  requirements (WP2): metering fixes, session cap, register fence, honest
  push-to-talk.
- Food links: skeptic dissent (see WP3 note). Wave 1 points the food ending
  at the existing curated late-food lane; delivery links are a follow-up
  decision after the captain weighs the dissent.

## WP1 - Get-home ride handoff (S) - SHIP FIRST

New pure module `lib/getHomeHandoff.ts`, same shape as `whatsappShareHref`
(`lib/shareArtifacts.ts:203`) and `venueDirectionsUrl` (`lib/venueJourney.ts`):

- `uberRideHref(venue)`: current universal-link form
  `https://m.uber.com/looking?client_id=...&pickup=<urlencoded JSON>` with the
  VENUE as pickup (exact public coords + name + addressLine), **no dropoff**
  (the user's saved places live inside Uber; we never touch a home address).
  Env: `NEXT_PUBLIC_UBER_CLIENT_ID` (self-serve at developer.uber.com; no
  partnership). Hand-test both documented Uber URL forms on iOS + Android at
  implementation time; the docs disagree in places.
- `citymapperDirectionsHref(venue)`:
  `https://citymapper.com/directions?endcoord=..&endname=..&endaddress=..`
- Reuse `venueDirectionsUrl` (Google Maps transit) as the third link and the
  TfL Journey Planner link (already in SafeNightStrip) as the rot-proof floor.

Mounts: a quiet action row in
`components/map/inspector/VenueGettingHomeTab.tsx` (below LastTrainCard,
above SafeNightStrip) and the body of the `get_home` ending in
`components/night/RouteEndingCard.tsx:46`. Order the row by
`computeLastPintDecision` (`lib/tfl.ts:279`): a `train_risk` night promotes
the ride link above transit; otherwise last train leads (TfL-aligned:
cheapest safe route first).

Copy: "Get a ride from {venue}". No price, no ETA, no availability, no
safety promise. Analytics: reuse the existing `get_home` vocabulary only.

Tests: `__tests__/getHomeHandoff.test.ts` - exact params, URL encoding, venue
coords passed exact, the builder REFUSES viewer input (no lat/lng params
beyond the venue object), link presence in both mounts, voice fences green.

Demo gate: tap "Get a ride from {pub}" in Getting Home; Uber opens with the
pub prefilled as pickup.

## WP2 - Per-pal voices, metered honestly (M)

Keep the shipped Agents WebSocket loop. Add:

1. Per-pal identity: map `PAL_VOICES` (`lib/pubPal.ts:25` ember/velvet/signal)
   to three curated ElevenLabs voice ids (env `ELEVENLABS_VOICE_EMBER`,
   `_VELVET`, `_SIGNAL`). `voice-token/route.ts` returns `overrides` beside
   `signedUrl`: voice id + first message + system prompt derived server-side
   from the user's pal (species, sliders, relationship).
   `PubPalVoice.tsx` passes them to `startSession`.
2. Metering fixes (skeptic findings, REQUIRED):
   - Release the trial session when the CLIENT fails to connect (today a
     denied mic prompt burns a session; ten denials burn the month).
   - Hard session length cap (agent-side `end_call` + client timer).
   - Meter minutes, not session starts, toward the monthly allowance.
3. Register fence (REQUIRED): the system prompt switches to the
   SafeNightStrip register (plain, one fact per sentence, zero jokes) for
   get-home intents - AND the voice pal REFUSES to freestyle get-home
   decisions: it names the last train / ride options from grounded data and
   hands off to the Getting Home UI. It never says the user is fine for
   another drink and never assesses sobriety.
4. Honest control: the button must be what it says. Either implement true
   hold-to-talk or relabel to "Start voice chat" with a visible End state.

Tests: extend `__tests__/pubPalVoiceTokenRoute.test.ts` (overrides shape,
release-on-client-failure, cap fields; keyless 503 unchanged); new
`__tests__/palVoicePromptRegister.test.ts` pinning the register-switch text
and the propose-then-confirm sentence. Privacy sentence "No audio or
transcript becomes memory" stays true; any ElevenLabs data-handling change
updates `/privacy` in the same commit.

Demo gate: two pals with different voices sound different; a denied mic
prompt does not consume a session; asking the pal "should I have one more?"
gets the plain register and a pointer to Getting Home.

## WP3 - Food ending (S) - wave 1 scope reduced

Wave 1: the `food` plan-ending points at the EXISTING curated late-food lane
(`lib/lateFood.ts` - real venues, provenance, hours-confidence). That is the
honest answer at the get-home moment.

Delivery links (Just Eat `/area/<outcode>`, Deliveroo curated slugs) are
PARKED behind a captain decision - the skeptic's dissent: delivery-to-the-pub
is incoherent at closing time and the URL shapes are unofficial and rot-prone.
If approved later: new `lib/foodDeliveryHandoff.ts` + outcode extractor +
fixture tests, copy states exactly what the link does ("Opens Just Eat near
your last stop"), fallback to platform homepages.

## WP4 - Our brain in the pal's voice (M, wave 2)

New `app/api/pub-pal/llm/route.ts`: OpenAI-compatible SSE endpoint over the
`lib/ask` tool registry with deterministic answer composition, shared-secret auth
(`ELEVENLABS_LLM_SHARED_SECRET`); point the ElevenLabs agent's Custom LLM at
it. Until then the dashboard-configured LLM with a tight prompt is acceptable
wave-1. Demo gate: the pal speaks a venue price identical to text Ask's
answer for the same question.

## Order

WP1 first (independent). WP2 second. WP3 wave-1 scope with WP2. WP4 wave 2.
New external requirements across wave 1: one Uber client_id, three ElevenLabs
voice ids, the existing `ELEVENLABS_API_KEY` + agent id.

## Guardrails (law, verbatim into every package)

1. GEO EGRESS: `lib/getHomeHandoff.ts` accepts venue coordinates only, passes
   them exact, and must NOT be added to `VIEWER_COORDINATE_EGRESS_FILES`; if
   a viewer point is ever introduced, it must pass `coarsenViewerPoint` and
   join that list in the same commit, with `/privacy` updated.
2. VOICE REGISTER / HONEST COPY: get-home and food surfaces state only what
   the link does - never a price, ETA, availability, or safety promise - and
   no joke or playful line may render on them, including the pal's voice
   prompt when the topic is getting home. The pal never assesses sobriety
   and never guarantees an outcome.
3. ERROR CONTRACT: every new `app/api` route emits 4xx/5xx only through
   `publicApiError` and is auth-gated or consults `isLimited`;
   `__tests__/theLocalErrorContract.test.ts` must pass unmodified.
