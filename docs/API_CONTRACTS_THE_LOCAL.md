# API Contracts — THE LOCAL

Source of truth: **issue #252** ("Spec: The Local — companion-led activation, night areas, late food, and retention OS") plus the 2026-07-16 Hardening Manifest. This document describes the integrated local implementation; it is not a branch-comparison ledger.

**Status legend used throughout:**

- **BASELINE** — present at the fixed `origin/main` baseline.
- **IMPLEMENTED LOCALLY** — present in the reviewed hardening worktree but not pushed.
- **DEFERRED** — explicitly outside this manifest or still awaiting an owner decision.

**The four Lane-2 endpoints** (`sol.md`) and their reconciled reality:

| `sol.md` name | Reality | Status |
| --- | --- | --- |
| `POST /api/plans/generate` | Editable three-stop route generation | IMPLEMENTED LOCALLY |
| `PATCH /api/plans/:id` | Status, context, and route replacement | IMPLEMENTED LOCALLY |
| `POST /api/plans/:id/actions` | Arrived / skipped / swapped | IMPLEMENTED LOCALLY |
| `GET /api/night-areas/:slug` | Detail plus `GET /api/night-areas?city=` catalogue | IMPLEMENTED LOCALLY |

Adjacent endpoints Codex also built and this contract now governs: `POST /api/plans/:id/complete`, `GET /api/late-food`.

---

## 0. Reconciliation summary — read this first

These are the places where Codex's implementation diverges from #252 or `sol.md`. Each has a recommended "which side wins" call for the owner.

1. **Endpoint naming: `/api/plans/generate` vs #252's `/api/companion/recommend`.**
   #252's Implementation Decisions literally say `POST /api/companion/recommend`. Codex shipped `POST /api/plans/generate` instead, matching `sol.md`. **Recommendation: `sol.md` / Codex wins** — `/api/plans/generate` is already built and tested; treat `/api/companion/recommend` as a superseded alias in #252. Do not build a parallel companion route.

2. **Flat public errors are authoritative.** THE LOCAL clients consume `{ error: string, code: string, retryable: boolean, details? }`. `publicApiError()` emits that shape with `no-store`. The older nested `apiError()` is retained only for the shipped Heritage response and is not a THE LOCAL contract. See §7.

3. **Rate-limit scope.** `POST /api/plans/generate` uses one privacy-safe hashed client key for both memory and Supabase limiters. Read/member-route budgets remain a separate owner decision; the matrix in §11 records current behavior without calling it implemented.

4. **`plan-generate` isolation is fixed.** Both limiters receive `plan-generate:${hashIp(clientIp(request))}`. Raw IP addresses are neither persisted nor passed to the limiter.

5. **Analytics vocabulary diverges from #252's registry.** #252 mandates a named set (`activation_started`, `area_selected`, `companion_selected`, `recommendation_returned`, `recommendation_accepted`, `plan_shared`, `plan_joined`, `late_food_viewed`, `late_food_added`, …). Codex instead added its own names (`night_description_submitted`, `planned_night_status_changed`, `planned_night_action`, `planned_night_completed`, `pub_pal_adopted`, `plan_invite_sent`, `plan_invite_opened`, `crew_committed`, `district_viewed`, …). **Open question: which registry wins?** See §8.

6. **"Companion" is shipped as "Pub Pal."** #252 says "companion" and `POST /api/companion/recommend`. Codex shipped the persona system as **Pub Pal** (`lib/pubPal.ts`, `app/api/pub-pal/*`). Same concept, different surface name. Contract treats them as synonyms; owner should pick one product noun.

7. **Late-food is evidence-gated.** All 20 Night Area slugs are represented. Only options with active official-operator evidence are returned; empty areas stay empty. ISO `at=` values affect weekly-hours ranking, and `fromLat`/`fromLng` compute an estimate from the actual final stop. Unknown opening/hygiene/walking-route evidence is labelled, never inferred.

8. **`GET/PUT /api/me/night-profile` is built.** It is owner-scoped by verified Supabase Auth id, backed by memory/Supabase stores, protected by optimistic concurrency and RLS, and mirrored by a validated versioned device adapter for anonymous use. Merge detection never chooses a winner; Account Hub requires explicit confirmation. See §9.

---

## 1. Shared conventions

### 1.1 Auth model — keyless-first + member-token

THE LOCAL follows the existing plans pattern: **value before sign-in.** There is no API key and no required account for the core loop.

- **Public read** (`GET /api/plans/:id`, `/getin`, `/complete`, `/api/night-areas*`, `/api/late-food`): no auth. Link-visibility only — anyone with the Plan id can read it. BASELINE pattern.
- **Create** (`POST /api/plans`, `POST /api/plans/generate`): keyless. On a write, the server mints an opaque **member token** (`memberToken`, returned once in the create/join response body; the server stores only its salted SHA‑256 hash). BASELINE.
- **Member-scoped writes** (`PATCH /api/plans/:id`, `POST /api/plans/:id/actions`, `POST /api/plans/:id/complete`, `POST /api/plans/:id/presence`): require the caller to present their member token, proving they belong to the crew.
  - Canonical transport: `Authorization: Bearer <memberToken>` header. Body field `memberToken` is accepted as a migration fallback. Helper: `lib/planMemberCapability.ts` (`planMemberCapability(request, body.memberToken)`). IMPLEMENTED LOCALLY.
  - `POST /api/plans/:id/actions` accepts the Bearer header and retains `body.memberToken` only as a migration fallback.
- **Authenticated profile** (`/api/me/night-profile`): verified Supabase Auth bearer session; the caller id is server-derived and never accepted from body/query.

The member token is never logged or serialised back after the initial mint (`planMemberCapability` comment; `planStore` stores `token_hash` only).

### 1.2 Response caching

Most THE LOCAL routes are `Cache-Control: no-store` (`jsonNoStore` and flat `publicApiError` both enforce it). The two Night Area GETs are the static-data exception: `jsonCached` sets `public, max-age=0, s-maxage=3600, stale-while-revalidate=86400` because their bodies are deployment facts plus review timestamps.

### 1.3 City scoping

`cityId` is validated by `parseCityId` (`lib/cities.ts`); `DEFAULT_CITY_ID = "london"`. A Night Area belongs to exactly one city; generate returns `422` if the selected area's `cityId` ≠ the request `cityId`. IMPLEMENTED LOCALLY.

---

## 2. Core lifecycle types (per #252 TL-1)

Defined in `lib/nightPlanning.ts` and `lib/plan.ts`. **Status: IMPLEMENTED LOCALLY** unless noted.

### 2.1 NightContext + Daypart

```ts
// lib/nightPlanning.ts
export const DAYPARTS = ["daytime", "after_work", "evening", "late_night", "get_home"] as const;
export type Daypart = (typeof DAYPARTS)[number];

export const PARTY_TYPES = ["solo", "friends", "work"] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const BUDGETS = ["value", "standard", "treat"] as const;
export type Budget = (typeof BUDGETS)[number];

export type NightAreaSlug =
  | "clapham" | "victoria" | "piccadilly-soho" | "canary-wharf" | "barnes" | "chiswick"
  | "shoreditch" | "camden" | "brixton" | "bermondsey-london-bridge" | "kings-cross" | "islington"
  | "dalston" | "peckham" | "greenwich" | "hammersmith" | "balham" | "marylebone" | "richmond" | "putney";

export type NightContext = {
  nightArea: NightAreaSlug | null;
  daypart: Daypart;
  partyType: PartyType;
  groupSize: number | null;      // 1..30, floored
  budget: Budget;
  atmosphere: string[];          // e.g. ["quiet","lively","historic","cosy","sports","music"], max 8 short strings
  foodNeeds: string[];           // e.g. ["kebab","pizza","chips","vegan","vegetarian","halal"]
  accessibility: string[];       // e.g. ["step-free"]
  transportConstraints: string[];// e.g. ["tube","walking"]
};

// Attribution of *why* the inferred context looks the way it does:
export type ContextReason = { field: keyof NightContext; evidence: string; explanation: string };
export type InferredNightContext = { context: NightContext; confidence: number; reasons: ContextReason[] };
```

Validators/parsers (server-owned, reuse — do not fork): `inferNightContext(query, now?)`, `cleanNightContext(value)` (strict: requires area+daypart+partyType+budget), `cleanNightContextPatch(value)` (partial merge), `isNightAreaSlug`, `isDaypart`, `isPartyType`, `isBudget`.

### 2.2 PlannedNight lifecycle

```ts
// lib/plan.ts
export const PLANNED_NIGHT_STATUSES = ["draft", "ready", "active", "ending", "completed", "abandoned"] as const;
export type PlannedNightStatus = (typeof PLANNED_NIGHT_STATUSES)[number];

// Legal transitions (canTransitionPlannedNight): identity always allowed, plus:
//   draft   → ready | abandoned
//   ready   → draft | active | abandoned
//   active  → ending | completed | abandoned
//   ending  → active | completed | abandoned
//   completed → (terminal)
//   abandoned → (terminal)

export type CrawlEnding = "food" | "get_home" | "keep_going";

export type PlanActionDTO = {
  id: string;
  type: "arrived" | "skipped" | "swapped" | "ending";
  stopPosition: number | null;
  ending: CrawlEnding | null;
  createdAt: string;
};
```

### 2.3 Plan DTOs

```ts
// lib/plan.ts
export type PlanDTO = {
  id: string;
  title: string;
  startTime: string;      // ISO
  createdAt: string;      // ISO
  routeRevision?: number | string; // incremented ONLY when the ordered route is replaced; legacy = 1
  status?: PlannedNightStatus;     // legacy records default to "draft"
};

export type PlanStopDTO = { venueId: string; venueName: string; position: number };

export type PlanState = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: CrewMemberDTO[];        // { id, name, status, joinedAt, updatedAt } — see lib/crew
  context?: NightContext | null;
  actions?: PlanActionDTO[];
  ending?: CrawlEnding | null;
};

export type PlanCompletionDTO = {
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  finalPintDropId: string | null;   // always null for now — attaching one is refused (see §5.4)
  routeRevision: number;
  routeSnapshot: PlanStopDTO[];
  completedAt: string;
};
```

`PlanDTO`, `PlanStopDTO`, `PlanState.{plan,stops,crew}` and `isPlanId` are BASELINE. Route revision, lifecycle, ending, action, completion, context and selected-ending fields are IMPLEMENTED LOCALLY.

### 2.4 NightArea catalogue

```ts
// lib/nightAreas.ts
export type CoverageStatus = "discovered" | "captured" | "reviewed" | "route_ready" | "paused";

export type RouteReadyGateCode =
  | "venue_density" | "identity_conflict" | "price_coverage" | "amenity_coverage" | "opening_hours"
  | "transport_anchor" | "route_feasibility" | "terminal_get_home" | "terminal_food"
  | "stale_review" | "unreviewed_source";

export type RecentSignal = {
  id: string; sourceUrl: string; publisher: string; publishedAt: string; claim: string;
  confidence: number; reviewStatus: "reviewed"; expiresAt: string;
};

export type GateCheck = {
  code: RouteReadyGateCode; required: boolean; passed: boolean;
  observed: number | string | null; threshold?: number | string; evidenceRefs: string[];
};
export type NightAreaGate = { version: 1; passed: boolean; checks: GateCheck[] };

export type NightArea = {
  slug: NightAreaSlug;
  cityId: CityId;
  name: string;
  aliases: string[];
  centre: { lat: number; lng: number };
  radiusKm: number;
  transportAnchors: string[];
  demandWave: 0 | 1 | 2 | 3;
  description: string;
  daypartGuidance: Record<Daypart, string>;
  recentSignals: RecentSignal[];            // currently seeded empty
  coverageStatus: CoverageStatus;
  coverageScore: number;
  routeReadyReasons: RouteReadyGateCode[];
  missingEvidence: RouteReadyGateCode[];
  gate: NightAreaGate;
  lastReviewedAt: string | null;
  reviewExpiresAt: string | null;
};
```

Catalogue is **reviewed application data**, not inferred at request time (per #252). `validateNightAreaCatalogue` runs at import (unique slugs/aliases, valid coords, ≥1 transport anchor). `isNightAreaRouteReady(area, now?)` remains a confidence label rather than a generation gate. **Status: IMPLEMENTED LOCALLY.** All 20 London areas are represented.

---

## 3. `POST /api/plans/generate` — grounded Plan generation

**Status: IMPLEMENTED LOCALLY.** (This is `sol.md`'s `/api/plans/generate`; supersedes #252's `/api/companion/recommend`.)

Keyless. Produces a grounded three-stop draft route from a Night Area + NightContext, with per-stop reasons and explicit context attribution. Does **not** persist a Plan — it returns a draft the client can then create/save via `POST /api/plans`.

### Request

```ts
type GeneratePlanRequest = {
  cityId?: string;              // default "london"; validated by parseCityId
  query?: string;              // free-text night description; parsed by inferNightContext
  context?: Partial<NightContext> | NightContext; // merged over inference; MUST resolve a nightArea
  anchor?: {                    // the accepted pub, when the person kept one first
    venueId: string;
    source: PlanningIntentSource;   // "near" | "map-search" | "tonight" | "pal"
    acceptedArea: PlanningIntentArea;
    startsAt: string | null;
  };
};
// At least one of `query` or `context` is required.
```

### Accepted-pub anchor

An `anchor` is always authoritative; a request without one keeps the generic,
unanchored selection path. The anchored lane answers `200` with an `outcome`:

| `outcome` | Meaning | Body shape |
| --- | --- | --- |
| `route` | The anchor is Stop 1 of a full grounded route | ordinary `stops` plus `anchored`, `anchorVenueId`, `anchorSource`, `groundingProof` |
| `anchor-only` | The anchor stands, but too few companions ground a route | one Stop, `routeReady: false`, `reason: "ANCHOR_COMPANIONS_INSUFFICIENT"` |
| `anchor-conflict` | The anchor itself cannot carry a route now | `stops: []`, `grounded: false`, plus `reason` and a reader-visible `message` |

`anchor-conflict` is a `200` with no Stops, so a caller must branch on
`outcome` before it treats an empty `stops` array as no match.

Merge rule (`mergeContext`): a complete `cleanNightContext` wins; else a `cleanNightContextPatch` is layered over the inferred context; else the inferred context is used. `context.nightArea` must resolve — a `null` area is a `422`.

### Response `200`

```ts
type GeneratePlanResponse = {
  inferredContext: NightContext;        // the merged context actually used
  confidence: number;                   // 0.62 (no area match) .. 0.86 (area matched in text)
  explanations: ContextReason[];        // { field, evidence, explanation }[] — WHY the context was inferred
  stops: Array<{
    venueId: string;
    venueName: string;
    position: number;                   // 0..2
    reason: string;                     // per-stop grounded reason (distance + up to 2 context reasons)
    alternatives: Array<{ venueId: string; venueName: string }>; // next-best swaps
  }>;
  contextEffects: string[];             // WHICH NightContext fields affected ranking:
                                        //   always ["budget","daypart"], plus conditionally
                                        //   "groupSize","partyType","atmosphere","foodNeeds"
  missingContextEvidence: string[];     // data we could not honour: e.g.
                                        //   "venue_accessibility","per_venue_transport","food_terminal_specificity"
  relevantSignals: RecentSignal[];      // area.recentSignals (reviewed only)
};
```

**"Explains which context values affected the result" (#252 requirement — SATISFIED):** three complementary fields — `contextEffects` (the list of NightContext fields that moved the ranking), per-stop `reason` (human-readable grounding per venue), and `explanations` (why the context was inferred). `missingContextEvidence` is the honest counterpart: constraints the engine could not yet ground.

### Errors

| Status | Condition | Current body |
| --- | --- | --- |
| `400` | malformed JSON | `MALFORMED_REQUEST` |
| `400` | neither `query` nor `context` | `NIGHT_CONTEXT_REQUIRED` |
| `400` | invalid `cityId` | `INVALID_CITY` |
| `422` | no `nightArea` resolved | `NIGHT_AREA_REQUIRED` |
| `422` | area not in requested city | `NIGHT_AREA_NOT_IN_CITY` |
| `422` | fewer than 3 grounded venues in radius | `INSUFFICIENT_VENUES` |
| `429` | rate limited | `RATE_LIMITED` (`retryable: true`) |

Every row uses the flat body described in §7. Coverage/confidence warnings are returned with successful editable routes; coverage readiness does not block generation.

### Rate limit

`plan-generate` scope, default budget **8 requests / 60s**. Memory and durable paths share the same hashed per-client key; warmup `GET` is not limited.

### Idempotency

Non-idempotent but side-effect-free: it persists nothing, so retries are safe.

### Keyless-mode behaviour

Fully keyless. No token minted (persistence happens later on `POST /api/plans`).

### Analytics

Emit `night_description_submitted { area, daypart }` on submit; the owner-resolved event mapping remains documented in §8.

---

## 4. `PATCH /api/plans/:id` — revise a Planned Night

**Status: IMPLEMENTED LOCALLY.** Member-scoped. One of three mutations (never combined in a way that conflicts):

### Request

```ts
type PatchPlanRequest = {
  memberToken?: string;              // fallback if no Authorization: Bearer header
  status?: PlannedNightStatus;       // must be a legal transition from current status
  context?: NightContext;            // full context (strict cleanNightContext)
  stops?: Array<{ venueId: string }>;// 3 to 6 distinct Venue Dataset ids → canonical route replacement
  expectedRouteRevision?: number;    // REQUIRED with `stops` — optimistic concurrency
  groundingProof?: string;           // with `operationKey`: claims this replacement is the grounded upgrade
  operationKey?: string;             // the generation operation the proof was minted for
};
```

Rules:
- `stops` replacement requires `expectedRouteRevision` and must NOT be combined with `status`. Stops are re-resolved server-side via `canonicalPlanRoute` (3 to 6 distinct ids, per `isPlanStopCount`, that exist in a shipped city dataset; returns canonical names). Replacing the route increments `routeRevision`.
- The grounded upgrade is permanent and unflagged: a `stops` replacement carrying a `groundingProof` plus an `operationKey` is verified against the exact new order, and only that path raises a one-Stop anchor draft to a grounded route and emits `plan_accepted` once. A legacy V1 creation proof is not an upgrade claim and takes the ordinary update path. Every V2 proof failure is a `422`.
- `context` must pass strict `cleanNightContext` or `400`.
- At least one of `status` / `context` / `stops` must be present.
- `status` change is rejected if `canTransitionPlannedNight(current, next)` is false (`403`/`400` via store).

### Response `200`

Full `PlanState` (updated).

### Errors (current)

| Status | Condition |
| --- | --- |
| `404` | bad/unknown plan id |
| `400` | malformed body / invalid context / bad stop set / missing revision / nothing to update |
| `403` | member token cannot edit this Plan |
| `409` | `expectedRouteRevision` stale — `"That Crawl Route has changed. Refresh and try again."` |
| `422` | grounded upgrade refused - `PLAN_ANCHOR_PROOF_*` (expired, route mismatch, operation mismatch, invalid) or `PLAN_ANCHOR_OUTCOME_MISMATCH` |

### Idempotency

Route replacement is **optimistically concurrent** via `expectedRouteRevision` → `409` on mismatch (this is the idempotency/lost-update guard). Status transitions are idempotent (identity transition allowed).

### Rate limit

**DEFERRED.** No limiter currently on PATCH; the owner must set the member-write budget.

### Analytics

`planned_night_status_changed { status }` (Codex). #252 equivalent: `recommendation_accepted` on first accept.

---

## 5. `POST /api/plans/:id/actions` — record a stop action

**Status: IMPLEMENTED LOCALLY.** Member-scoped live tracking.

### Request

```ts
type PlanActionRequest = {
  memberToken?: string;         // migration fallback; Authorization: Bearer is canonical
  type: "arrived" | "skipped" | "swapped";  // "ending" is REJECTED here (goes via /complete)
  stopPosition: number;         // integer 0..7 (validated against PLAN_STOP_MAX=8); THE LOCAL routes are 3 stops, so 0..2 in practice
};
```

### Response `201`

Full `PlanState` (with the new action in `actions[]`). Side effect: recording any action moves a `draft`/`ready` plan to `active`.

### Errors (current)

| Status | Condition |
| --- | --- |
| `404` | bad/unknown plan id |
| `400` | malformed body / invalid `type` or `stopPosition` |
| `403` | member token cannot update this Plan |

### Idempotency

Non-idempotent (append-only action log). Each POST inserts a new `PlanActionDTO`.

### Rate limit

**DEFERRED.** No limiter currently; the owner must set the member-write budget.

### 5.4 Adjacent: `POST /api/plans/:id/complete` (+ `GET`)

**Status: IMPLEMENTED LOCALLY.** Terminal transition to a completed Planned Night.

```ts
// POST body
type CompletePlanRequest = {
  memberToken?: string;            // or Authorization: Bearer (planMemberCapability)
  ending: "food" | "get_home" | "keep_going";
  expectedRouteRevision: number;   // required, > 0 — optimistic concurrency
  terminalVenueId?: string;        // required when ending === "food"
  endingSelection: EndingSelection; // required; canonicalized against server-owned evidence
  finalPintDropId?: unknown;       // MUST be absent — presence returns 400 (ownership not yet verifiable)
};
```

- `POST` → `{ plan, completion }`. HTTP `201` when newly created, `200` when already completed (**idempotent** via `complete_plan_atomic` returning `already_completed`).
- `GET /api/plans/:id/complete` → `{ completion: PlanCompletionDTO | null }` (public read).
- Errors: `404` unknown plan; `400` invalid/malformed/missing terminal-for-food/`finalPintDropId` present; `403` member cannot complete; `409` route revision changed; `503` store error.
- Completion writes the chosen ending, ending action, completion record, and terminal status atomically (Supabase RPC `complete_plan_atomic`). A completion without `endingSelection` is rejected.

**Safety invariant (#252):** the default/encouraged endings are `food` and `get_home`; `keep_going` exists but the product must never frame more drinking as success. Food terminals are late-food places, never pint-price pins (see §10).

---

## 6. `GET /api/night-areas` and `GET /api/night-areas/:slug`

**Status: IMPLEMENTED LOCALLY.** Keyless read of the reviewed catalogue.

### `GET /api/night-areas?city=<cityId>` (#252 shape)

```ts
// 200
type NightAreasListResponse = {
  cityId: CityId;
  areas: NightArea[];
};
```
- `400` if `city` missing/invalid; `404` if no areas for that city.

### `GET /api/night-areas/:slug` (`sol.md` shape)

```ts
// 200
type NightAreaDetailResponse = NightArea;
```
- `404` if `slug` is not a known `NightAreaSlug` (`isNightAreaSlug`).

Neither response serialises `routeReady`. It is derived state because it changes when the review window expires. Read `lastReviewedAt` and `reviewExpiresAt` from the cached body, then call `isNightAreaRouteReady(area, new Date())` at read time. That helper checks the evidence gate and review timestamps; do not cache or persist its boolean result.

### Rate limit

**DEFERRED** on both pending an owner-approved public-read budget.

### Error envelope

Flat `PublicApiError`; routes retain the human-readable `error` string while adding stable `code` and `retryable` fields.

### Analytics

Codex: `district_catalogue_viewed`, `district_viewed { district, coverageStatus, demandWave }`, `district_route_blocked`, `district_route_ready_selected`, `route_ready_gate_failed`. #252 equivalent: `area_selected`. Prop values for these events are hard-allowlisted to catalogue identifiers/gate codes in `sanitizeEvent`.

### Keyless-mode behaviour

Fully public. Availability counts / coverage are visible without auth so first-time visitors can choose an area before sign-in (#252 "value before sign-in").

---

## 7. Shared flat public error envelope

**Canonical THE LOCAL shape** (`lib/apiError.ts`):

```ts
type PublicApiError = {
  error: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};
export function publicApiError(error, code, status, options?): Response;
```

`error` remains a string for existing callers. New callers branch on `code`; `retryable` distinguishes a safe retry from a correction the person must make. Structured conflict/current-state payloads live under `details`. The legacy nested `apiError()` remains intentionally separate for Heritage compatibility and must not be introduced into THE LOCAL routes.

---

## 8. Analytics events

Registry: `lib/analyticsEvents.ts` (`ANALYTICS_EVENTS`), first-party, low-cardinality, no free-text/handles/coords (dropped by `sanitizeEvent`). BASELINE framework; new events IMPLEMENTED LOCALLY.

**Codex added (branch reality):** `night_description_submitted {area,daypart}`, `planned_night_status_changed {status}`, `planned_night_action {type}`, `planned_night_completed {ending}`, `pub_pal_adopted {pal}`, `pub_pal_summoned {surface}`, `pub_pal_memory_changed {action,category}`, `discovery_viewed {surface,daypart}`, `plan_invite_sent {channel}`, `plan_invite_opened {source}`, `crew_committed {source,participants}`, `account_claimed {source}`, `social_account_connected {provider,connectionType}`, `night_moment_saved {kind,visibility}`, `night_story_published {contributors,moments}`, `next_night_committed {windowDays,source}`, `draft_recovered {kind,surface}`, `web_vital {metric,value,rating}`, `guest_plan_participated {action}`, plus district events `district_catalogue_viewed`, `district_viewed`, `district_route_blocked`, `district_route_ready_selected`, `route_ready_gate_failed`.

**#252 mandated names (not yet present):** `activation_started`, `area_selected`, `companion_selected`, `preferences_completed`, `recommendation_returned`, `recommendation_accepted`, `plan_shared`, `plan_joined`, `late_food_viewed`, `late_food_added`, `briefing_viewed`, `briefing_opened`, `voice_started`, `recap_viewed`, `return_prompt_opened`.

**Open question (§0.5):** adopt #252's exact registry, keep Codex's vocabulary, or map. Suggested mapping if Codex wins: `activation_started`→`night_description_submitted`, `area_selected`→`district_viewed`, `companion_selected`→`pub_pal_adopted`, `recommendation_accepted`→`planned_night_status_changed`, `plan_joined`→`crew_committed`/`guest_plan_participated`, `recap_viewed`→`night_story_published`.

---

## 9. `GET/PUT /api/me/night-profile`

Authenticated durable Night Profile, implemented with keyless browser parity.

```ts
type NightProfile = {
  version: 1;
  cityId: CityId;
  context: NightContext;
  briefingPreferences: { muteAll: boolean; mutedAreas: NightAreaSlug[]; mutedTopics: string[] };
  voicePreference: "off" | "tts" | "ptt";
  pubPalId: string | null;       // owned pub_pals.id only; name/species are never duplicated
  updatedAt: string;
  createdAt: string;
};
```

Contract requirements:
- `GET` returns `200 { profile: NightProfile | null }`; it requires verified auth and is always `no-store`.
- `PUT` body is `{ profile: NightProfileInput, expectedUpdatedAt: string | null }`. `null` is create-only; stale writes return `409 NIGHT_PROFILE_CONFLICT` with the current profile in `details`.
- The route validates that `pubPalId`, when present, belongs to the caller. Pal name/species stay canonical in `pub_pals`.
- Anonymous profile stays under the validated versioned key `pubmaxx.night-profile.v1:device`. No coordinates, location history, voice content, secrets or Pal memories are stored.
- Account Hub shows device/account differences and requires an explicit “Bring this device” choice before PUT. “Keep account preferences” performs no account mutation.
- Reads are limited to 60/minute and writes to 30/minute per verified user/IP.

---

## 10. `GET /api/late-food` — crawl-ending food terminals

**Status: IMPLEMENTED LOCALLY** (`app/api/late-food/route.ts`, `lib/lateFood.ts`). Keyless.

### Request (query params)

```text
GET /api/late-food?near=<area>&at=<iso>&fromLat=<lat>&fromLng=<lng>&tags=<csv>&limit=<n>
```
- `near` (or `area`): normalized via `normalizeLateFoodArea` (aliases `soho`/`piccadilly` → `piccadilly-soho`). Required. All 20 canonical Night Areas are accepted; areas without eligible evidence return zero terminals.
- `tags`: CSV, max 8, matched against `category` / `dietary` / name substring.
- `limit`: default and hard maximum `MAX_LATE_FOOD_HANDOFFS` (3, `lib/lateFood.ts`). A crawl ending offers a shortlist, not a directory; larger values clamp down rather than widen.
- `at`: optional ISO instant used to rank operator-evidenced weekly hours.
- `fromLat` and `fromLng`: optional pair for an estimate from the actual final route stop.

### Response `200`

```ts
type LateFoodTerminal = {
  id: string; name: string; area: LateFoodArea;
  category: "kebab" | "pizza" | "cafe" | "restaurant";
  dietary: Array<"vegan" | "vegetarian" | "gluten-free">;
  hours: { service: string; verifyOnNight: true; weekly: Record<string, unknown[]> };
  walkingDetour: { minutes: number | null; distanceKm: number | null; basis: string; note: string };
  provenance: { kind: "official_operator"; source: string; sourceUrl: string; observedAt: string; reviewedAt: string; expiresAt: string };
  anchor: { label: string; price: number; sourceUrl: string; observedAt: string };
  confidence: "high" | "medium" | "low";
  openAtRequestedTime: boolean | null;
};
type LateFoodApiSuccessResponse = {
  area: LateFoodArea;                 // canonical slug
  terminals: LateFoodTerminal[];      // ranked by walkingDetour.minutes asc (unknown last), capped at 3
  rankingSignals: string[];
  missingEvidence: string[];
};
```

### Errors

`400` uses the flat `PublicApiError` envelope. The compatibility payload `{ terminals: [] }` remains both top-level and in `details` for legacy clients.

### Invariants (#252, honoured)

- Records returned by `/api/late-food` remain modelled **separately** from the Venue Dataset: no `venueId`, pint prices, or pub amenities. `anchor` is one named, dated, operator-sourced dish price, never a pint price and never a menu. Hand-curated `kind: food` and `kind: restaurant` map pins are a separate discovery lane; their sourced item anchors are not pint prices, and they are excluded from Pint Drops.
- Unknown opening hours are **labelled** (`verifyOnNight: true`, `missingEvidence`), never assumed open.

### Rate limit

**DEFERRED.** No public-read budget has been approved.

### Deferred evidence

FSA hygiene and routed walking time are not asserted until a scheduled, permissible evidence source is available. The route returns fewer or zero choices rather than substituting competitor or unverified data.

---

## 11. Rate-limit + envelope coverage matrix

| Route | Method | Rate limit | Error envelope | Auth |
| --- | --- | --- | --- | --- |
| `/api/plans/generate` | POST | ✅ `plan-generate` (8/60s; hashed per client) | flat `PublicApiError` | keyless |
| `/api/plans/anchor` | GET | ✅ `plan-anchor` (60/60s; hashed per client) | flat `PublicApiError` | keyless |
| `/api/plans/:id` | PATCH | ❌ deferred | flat `PublicApiError` | member token |
| `/api/plans/:id/actions` | POST | ❌ deferred | flat `PublicApiError` | Bearer member token; body fallback |
| `/api/plans/:id/complete` | POST/GET | ❌ deferred | flat `PublicApiError` | member token (POST) / public (GET) |
| `/api/night-areas` | GET | ❌ deferred | flat `PublicApiError` | keyless |
| `/api/night-areas/:slug` | GET | ❌ deferred | flat `PublicApiError` | keyless |
| `/api/late-food` | GET | ❌ deferred | flat `PublicApiError`; compatibility terminals top-level and in `details` | keyless |
| `/api/me/night-profile` | GET/PUT | ✅ 60/30 per minute | flat `PublicApiError` | Supabase Auth |

Existing shared limiter: `isLimited(localKey, durableKey, limit=8, windowMs=60_000, {failClosed?})` from `lib/pintDrops.ts`, with per-domain wrappers (e.g. `lib/lastRideRateLimit.ts`, `lib/roundsReadRateLimit.ts`). Reuse the wrapper pattern; do not invent a new limiter.

---

## 12. Owner decisions (resolved 2026-07-16) + remaining open questions

**Decided by the owner:**

1. **Endpoint name — RESOLVED:** `/api/plans/generate` supersedes #252's `/api/companion/recommend`. The #252 path is a historical alias; do not build it.
2. **Error envelope — RESOLVED:** flat `PublicApiError` wins: `{ error, code, retryable, details? }`. The nested Heritage helper remains compatibility-only.
3. **Analytics registry — RESOLVED:** keep Codex's event names (already emitting; renaming buys nothing). #252's registry is amended to the shipped vocabulary; the §8 mapping table records the correspondence.
4. **Product noun — RESOLVED:** "Pub Pal" wins over #252's "Companion" everywhere (UI, code, analytics).

**Still open:**

5. **Rate-limit budgets:** confirm budgets for read routes (night-areas, late-food) and member writes (PATCH, actions, complete). Plan generation is already isolated per hashed client.
6. **Late-food evidence expansion:** continue scheduled official/open-data acquisition; empty results are intentional until evidence passes validation.

---

*Updated against the local hardening implementation on 2026-07-16. The work remains local until exact-commit review and authorization.*
