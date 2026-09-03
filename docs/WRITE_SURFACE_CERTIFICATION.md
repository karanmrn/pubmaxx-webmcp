# Mutating API surface certification

Wave 0 treats every exported `POST`, `PUT`, `PATCH`, or `DELETE` handler as a
reviewed surface—even when a POST is semantically read-only. The regression test
`__tests__/writeSurfaceCertification.test.ts` scans the complete `app/api` tree.
Adding a mutating route or removing its authority/abuse boundary fails
CI until this certification is deliberately updated.

> **Inventory: 142 mutating handlers across 113 route files.** Each exported
> `POST`, `PUT`, `PATCH`, or `DELETE` is one reviewed surface. A file with two
> mutation methods contributes two entries. Read-only handlers do not enter this
> inventory. Both counts are merge-conflict coordination points.

## Certified mutation handlers

This list is matched exactly against TypeScript syntax-tree discovery. Handler
bodies are checked separately, including only local helpers each body calls.
Protection in a sibling method cannot certify another method.

<!-- mutation-handler-inventory:start -->
- `DELETE app/api/admin/session`
- `DELETE app/api/auth/session`
- `DELETE app/api/check-ins`
- `DELETE app/api/crawls/[slug]`
- `DELETE app/api/night-stories/[id]/contributors`
- `DELETE app/api/plans/[id]/group-prefs`
- `DELETE app/api/plans/[id]/invite-rsvp`
- `DELETE app/api/plans/[id]/invites/[inviteId]`
- `DELETE app/api/profiles/[handle]`
- `DELETE app/api/profiles/[handle]/avatar`
- `DELETE app/api/profiles/[handle]/cover`
- `DELETE app/api/profiles/[handle]/covers/[coverId]`
- `DELETE app/api/pub-pal`
- `DELETE app/api/pub-pal/memories/[memoryId]`
- `DELETE app/api/social-connections/[provider]`
- `DELETE app/api/social/crews/[crewId]/invitations/[invitationId]`
- `DELETE app/api/social/crews/[crewId]/join-requests`
- `DELETE app/api/social/crews/[crewId]/members/[memberId]`
- `DELETE app/api/social/interactions`
- `PATCH app/api/admin/import-notes`
- `PATCH app/api/crawls/[slug]`
- `PATCH app/api/profiles/[handle]/covers/[coverId]`
- `PATCH app/api/identity/onboarding`
- `PATCH app/api/night-moments/[id]/alt-text`
- `PATCH app/api/night-stories/[id]`
- `PATCH app/api/night-stories/[id]/contributors`
- `PATCH app/api/plans/[id]`
- `PATCH app/api/plans/[id]/session`
- `PATCH app/api/profiles/[handle]`
- `PATCH app/api/pub-pal`
- `PATCH app/api/pub-pal/memories/[memoryId]`
- `PATCH app/api/social/crews/[crewId]`
- `PATCH app/api/social/crews/[crewId]/invitations/[invitationId]`
- `PATCH app/api/social/crews/[crewId]/join-requests/[requestId]`
- `PATCH app/api/social/crews/[crewId]/members/[memberId]`
- `PATCH app/api/social/posts/[postId]`
- `POST app/api/admin/comments`
- `POST app/api/admin/community-prices`
- `POST app/api/admin/import-notes`
- `POST app/api/admin/profile-avatars`
- `POST app/api/admin/session`
- `POST app/api/admin/social-posts`
- `POST app/api/area-demand`
- `POST app/api/auth/session`
- `POST app/api/auth/change-password/verify`
- `POST app/api/auth/handle-password`
- `POST app/api/ask`
- `POST app/api/cheap-pint-ping`
- `POST app/api/check-ins`
- `POST app/api/citymcp/journey`
- `POST app/api/concierge`
- `POST app/api/crawls`
- `POST app/api/events`
- `POST app/api/heritage`
- `POST app/api/identity/adult-assertion`
- `POST app/api/identity/handle/claim`
- `POST app/api/identity/handle/rename`
- `POST app/api/identity/onboarding`
- `POST app/api/invite/[token]/reactions`
- `POST app/api/invite/[token]/rsvp`
- `POST app/api/me/pending-plan-recaps`
- `POST app/api/messages`
- `POST app/api/messages/[id]`
- `POST app/api/night-memories`
- `POST app/api/night-memories/[id]/moments`
- `POST app/api/night-stories`
- `POST app/api/night-stories/[id]/consents`
- `POST app/api/night-stories/[id]/contributors`
- `POST app/api/night-stories/[id]/moments`
- `POST app/api/night-stories/[id]/publish-confirmations`
- `POST app/api/night-stories/[id]/publish-proposals`
- `POST app/api/notifications`
- `POST app/api/operator-proposals`
- `POST app/api/pint-drops`
- `POST app/api/pint-drops/comments`
- `POST app/api/pint-drops/reactions`
- `POST app/api/plans`
- `POST app/api/plans/[id]/actions`
- `POST app/api/plans/[id]/complete`
- `POST app/api/plans/[id]/constraints`
- `POST app/api/plans/[id]/constraints/[constraintId]/resolve`
- `POST app/api/plans/[id]/group-prefs`
- `POST app/api/plans/[id]/invite-rsvp`
- `POST app/api/plans/[id]/invite-rotate`
- `POST app/api/plans/[id]/invites`
- `POST app/api/plans/[id]/invites/redeem`
- `POST app/api/plans/[id]/join`
- `POST app/api/plans/[id]/presence`
- `POST app/api/plans/[id]/proposals`
- `POST app/api/plans/[id]/proposals/[proposalId]/decision`
- `POST app/api/plans/[id]/proposals/[proposalId]/votes`
- `POST app/api/plans/[id]/recap`
- `POST app/api/plans/[id]/session`
- `POST app/api/plans/[id]/vibe-votes`
- `POST app/api/plans/generate`
- `POST app/api/presence`
- `POST app/api/price-confirm`
- `POST app/api/price-submit`
- `POST app/api/profiles/[handle]/follow`
- `POST app/api/profiles/[handle]/avatar`
- `POST app/api/profiles/[handle]/avatar/report`
- `POST app/api/profiles/[handle]/cover`
- `POST app/api/profiles/[handle]/covers`
- `POST app/api/profiles/[handle]/cover/report`
- `POST app/api/profiles/[handle]/covers/[coverId]/report`
- `POST app/api/pub-pal`
- `POST app/api/pub-pal/llm`
- `POST app/api/pub-pal/mastery`
- `POST app/api/pub-pal/memories`
- `POST app/api/pub-pal/voice-token`
- `POST app/api/push-tokens`
- `DELETE app/api/push-tokens`
- `POST app/api/step-out-nudge`
- `DELETE app/api/step-out-nudge`
- `POST app/api/ratings`
- `POST app/api/referrals/claim-attribution`
- `POST app/api/referrals/invite-link`
- `POST app/api/rounds`
- `POST app/api/rounds/[code]`
- `POST app/api/saved-pubs`
- `POST app/api/saved-pubs/list-follows`
- `POST app/api/social-connections/[provider]`
- `POST app/api/social/crews`
- `POST app/api/social/crews/[crewId]/invitations`
- `POST app/api/social/crews/[crewId]/join-requests`
- `POST app/api/social/crews/[crewId]/leave`
- `POST app/api/social/interactions`
- `POST app/api/social/posts`
- `POST app/api/social/tags`
- `POST app/api/starter-packs/[slug]/follow`
- `POST app/api/venue-operators/claim`
- `POST app/api/venue-photos`
- `POST app/api/venues/[id]/occupancy`
- `POST app/api/visit-reports`
- `POST app/api/wanted`
- `POST app/api/wanted/resolve`
- `POST app/api/weather-recommendations`
- `PUT app/api/me/night-profile`
- `PUT app/api/me/pending-plan-recaps`
- `PUT app/api/plans/[id]/session`
- `PUT app/api/profiles/[handle]`
- `PUT app/api/social/interactions`
<!-- mutation-handler-inventory:end -->

## Boundary classes

| Boundary | Purpose | Representative surfaces |
|---|---|---|
| Durable rate limit | Public/keyless abuse and provider-cost control | Events, discovery proxies, Pint Drops, crawl contributions, Plan creation, area-demand requests |
| Account | Supabase-authenticated ownership | Night Memories/Stories, Pub Pal, profiles, social connections |
| Capability | Narrow possession-based authority plus server validation | Plan actions, completion, invites, constraints, proposals, recap |
| Moderator | Staff-only operational mutation | Import notes and moderation |
| Confirmation | One-use confirmation for a consequential proposal | Night Story publication |
| Session revocation | Safe removal of caller-held authority | Admin session cookie removal |

These boundaries compose. For example, Plan creation is rate-limited and fails
closed when durable enforcement is unavailable; later lifecycle writes require a
Plan member capability and use idempotency keys or atomic store operations.

Referral writes are account-bound. `POST /api/referrals/invite-link` derives the
inviter from the verified JWT. `POST /api/referrals/claim-attribution` derives
the new account and its creation time from the same verified identity, then
resolves only an opaque invite code from its body. Neither route accepts an
account ID in its body, and neither returns either side of an invite edge.
Following the public invite route writes nothing. Auth callback code claims are
accepted only for newly created accounts in the same sign-in journey.

Social access is Supabase-only. `GET /api/social/access` calls
`resolveSocialAccess`, which accepts the caller's verified Supabase bearer or
resume cookie and reads the server-owned product account, profile, date of
birth, and adult assertion. It accepts no account ID, handle, or email from a
request body. When `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`, it returns preview before
session or account work. There is no Social access POST, Clerk session check,
Yoti migration, or account migration RPC in this path.

Social post and Crew writes use one account boundary. Their routes call
`requireVerifiedSocialActor`, which returns the server-held product account ID,
stable profile ID, and current handle only after Supabase session verification,
product ownership, and the adult decision pass. No account ID, profile ID,
handle, moderation state, revision, or timestamp is accepted from request
bodies.

## Failure posture

- Anonymous paid spend (`concierge`, narrated `heritage`) and Plan creation pass
  `{ failClosed: true }` to the durable limiter.
- Keyless local development remains usable through the bounded process-local
  limiter when Supabase is not configured.
- Public community contribution paths use durable limits in production and a
  tightened degraded budget on transient limiter failures.
- Account, moderator, and Plan-capability routes reject missing authority before
  persistence. Confirmation-protected publication requires a separate one-use
  token.
- Read-only discovery remains available with caching and abuse controls; it never
  receives a write capability merely because the HTTP verb is POST.

## Route additions since the Wave 0 inventory

### `app/api/social/posts` - verified Social post creation (route 76)

- **Route / method:** `POST app/api/social/posts/route.ts`.
- **Authority:** `requireVerifiedSocialActor` derives the verified Social actor.
  The stable profile ID owns the row. The product account ID never enters the
  response or post table.
- **Abuse control:** Durable create and feed-read limiters use the shared salted
  digest of the stable profile ID, never the raw profile ID, handle or account
  ID. Feed reads partition budgets by lane and listed nearby area.
- **Validation:** Kind, visibility, text, listed area, hashtags and comment
  policy use `validateSocialPostCreate`. Public posts cannot carry an exact
  venue. Raw object keys and every client-supplied ownership, timestamp,
  revision or moderation field are rejected. Photo references remain closed
  until the ownership-checked upload task ships.
- **Moderation:** Durable creation starts in pending moderation and the same
  database write queues an OpenAI moderation job carrying body plus normalised
  hashtags. Pending content cannot reach direct reads or any feed. A protected
  cron drains isolated leased jobs with bounded provider timeouts. Terminal
  holds are counted and only an authenticated operator action can requeue them.
- **Freeze:** The Social freeze guard runs before identity, limiter or storage
  work and pauses creation while reads stay available.
- **Failure:** Invalid input returns 400, unavailable photo upload returns 409,
  unavailable identity or durable storage fails closed, and no fake success is
  returned.

### `app/api/social/posts/[postId]` - verified Social post editing (route 77)

- **Route / method:** `PATCH app/api/social/posts/[postId]/route.ts`.
- **Authority:** `requireVerifiedSocialActor` supplies the verified Social actor,
  and the store matches the row against that stable profile ID. No
  account ID or author field is accepted from the body.
- **Abuse control:** Edit and recoverable removal share a durable limiter keyed
  to the shared salted digest of the stable profile ID.
- **Validation:** Strict edit validation rejects status, revision, timestamp,
  moderation and raw storage fields. A transactional RPC advances private
  `mutation_version` for every successful edit and uses it for compare-and-swap,
  so a stale edit cannot overwrite newer visibility or comment choices. A real
  text, kind, hashtag or future photo change separately advances moderation
  `revision`, returns the row to pending moderation and binds its queued claim
  and decision. Visibility-only and comment-policy edits do not advance the
  moderation revision.
- **Removal:** `{ action: "remove" }` changes status to `removed`. It is a
  recoverable state change, never a delete, and removed content is excluded from
  direct reads and every feed.
- **Freeze:** The Social freeze guard runs before identity, limiter or storage
  work for edits and removals.
- **Failure:** A post outside stable profile ownership returns 403 or 404. A
  hidden, removed or moderation-held post never appears through the item read.

### `app/api/plans/[id]/group-prefs` - shared Plan group preferences (route 78)

- **Route / method:** `POST` and `DELETE` on
  `app/api/plans/[id]/group-prefs/route.ts` (Lane D shared group prefs). The
  route also exports a member-capability `GET` (list + merged hard constraints)
  which is NOT a mutating verb and is not counted.
- **Validation:** `parseGroupPrefWriteInput` (`lib/groupPrefs.ts`) requires a
  closed budget band (`under6` | `standard` | `flexible`) and atmosphere chip
  (`cosy` | `chatty` | `lively` | `music` | `food`); boolean must-haves are
  `zeroProof`, `accessibilityRequired`, and `weatherShelterRequired`. Invalid
  bodies 400 before the store is touched. The store and migration CHECKs
  re-validate.
- **Rate limit (boundary):** durable per-plan + hashed-IP `isLimited` with keys
  `plan-group-prefs:${id}:${hashIp(...)}` (POST) and
  `plan-group-prefs-clear:${id}:${hashIp(...)}` (DELETE). Raw IP never keyed.
- **Auth stance:** member-capability bound via `planMemberCapability`. The store
  admits only the host or a collaboration-authorized guest. Rows are keyed by
  `(plan_id, member_id)`; a token for plan A cannot read or write plan B.
- **Hard constraints:** `overlapGroupPrefs` merges the strictest budget and any
  zero-proof / step-free / covered-shelter ask into `hardConstraints` /
  `mustHaveLabels`. These must-haves are never silently relaxed when a looser
  mate joins.
- **Rollback / kill:** durable rows live in `public.plan_member_group_prefs` +
  `public.plan_member_group_pref_requests` (migration **0076**, RLS on,
  anon/authenticated revoked, service_role only). Forward:
  `supabase/migrations/20260806160000_0076_plan_member_group_prefs.sql`.
  Rollback:
  `supabase/migrations/rollback/20260806160000_0076_plan_member_group_prefs_rollback.sql`.

### `app/api/social/interactions` - verified Social interactions and governance (route 80)

- **Route / methods:** `GET`, `PUT`, `POST`, and `DELETE` share one reviewed
  route. GET reads bounded interaction pages. PUT and DELETE set Cheers,
  private saves, reposts, comment policy and blocks to explicit desired state.
  POST creates held comments and quotes, queues reports, changes owned
  notification state, appends feature-request history, or performs named staff
  moderation.
- **Authority:** `requireVerifiedSocialActor` derives the verified Social actor,
  product account and stable profile. Request bodies accept no account, profile
  or handle ownership. Database RPCs re-check current post visibility, mutual
  friendship, block state and authorship in the same transaction that mutates.
- **Abuse and retries:** the route uses a durable limiter keyed by the salted
  stable profile digest. Desired-state writes are naturally idempotent.
  Immediate threat and doxxing reports bypass that ordinary budget so reporting
  cannot be stopped during an incident; report identity and target deduplication
  still apply.
  Comments, quotes and feature updates require an idempotency header; only its
  salted hash and a payload digest reach durable storage, so retries return one
  result and key reuse with different content is rejected.
- **Privacy and visibility:** private saves have neither a public count nor a
  notification. Cursors are viewer and collection scoped. Reposts, quotes,
  counts and notifications re-authorise their source and apply block reductions
  on every read. Feeds stay chronological and engagement never enters map,
  venue, price or popularity ranking.
- **Moderation and governance:** comments and quote posts remain held moderation
  content until the OpenAI worker records an approval. Reports never auto-hide.
  Hide and restore require an active named staff role and append an audit row.
  Named moderators read the private report queue and explicitly resolve each
  report, retaining staff-role provenance.
  Feature-request status and response history are append-only and staff actions
  use the same private identity.
- **Failure and rollback:** the Social freeze runs before identity, limiter or
  storage work for ordinary writes. Reporting and moderation safety floors stay
  open. Deployed production selects the durable store and fails closed when
  migration 0073 is unavailable. Rollback removes only Task 4 tables and RPCs,
  leaving Social posts, profiles and follows intact.

### `app/api/social/tags` - verified photo-tag consent (route 81)

- **Route / method:** `POST app/api/social/tags/route.ts`.
- **Authority:** `requireVerifiedSocialActor` derives stable profile authority.
  Proposal IDs do not grant authority. The target can approve or decline, and
  the photo author can cancel. An approved target can withdraw later.
- **Consent:** identity appears only while proposal state is approved and the
  current block graph still permits the author-target edge. Each state change
  appends an immutable consent event.
- **Failure:** malformed requests return 400. Wrong actors, blocked edges and
  invalid state transitions use one denied response without exposing proposal
  state.

### `app/api/admin/social-posts` - named staff Social moderation (route 82)

- **Route / method:** `GET` and `POST app/api/admin/social-posts/route.ts`, plus
  `GET app/api/admin/social-posts/media/[mediaId]/route.ts` for protected photo
  previews.
- **Authority:** `isModerator` accepts the existing admin header or httpOnly
  admin session cookie. Each admin-only RPC also requires an active named
  moderator role. Client data cannot assert staff identity or role.
- **Moderation:** the queue reads only visible held posts and exposes no
  post-author identity. Approval or hide binds the current post and private media, keeps
  provenance, and appends the named staff action. The preview RPC returns an
  object key only for media attached to a held post; the route exchanges it for
  a short-lived signed URL. Neither action deletes the post, media audit, or tag
  consent history.
- **Failure:** malformed requests return 400, stale held rows return 409, and
  missing migration, named staff authority, or storage failures return 503.
  Responses are private and no-store. No partial moderation result is
  returned.

### Social Crew authority routes (routes 81-88)

All eight route files resolve a verified Social actor before parameter, header,
or bounded JSON reads. No body can assert account ownership, role authority, or
an owner. JSON objects use exact keys, so unknown keys fail. Every mutation
requires a header-only `Idempotency-Key` of 16 to 128 trimmed characters. Body
fallback is not supported. A salted stable-profile budget limits writes to 30
per minute. Every success and failure is `private, no-store` JSON. Statuses are
stable: 401 for sign-in, 403 for Social policy, 404 for unknown or protected
denial, 409 for write conflict, 422 for invalid input, 429 for the write budget,
and 503 for unavailable authority or storage. Store transactions re-check
membership, current reciprocal follows, blocks, role, state, and revision.

#### `app/api/social/crews` (route 81)

`POST` binds one existing Planned Night. Creation alone reads the one-time
legacy host capability from the `Authorization` bearer header. Body accepts
only Plan ID and Crew visibility. Capability is never returned or stored.

#### `app/api/social/crews/[crewId]` (route 82)

`PATCH` changes visibility through owner authority and an expected authority
revision in PostgreSQL `int4` range 0 to 2147483647. Sibling `GET` returns only
the projected Crew DTO and is not a mutating route.

#### `app/api/social/crews/[crewId]/invitations` (route 83)

`POST` invites one stable target profile. It accepts no target account ID or
caller role.

#### `app/api/social/crews/[crewId]/invitations/[invitationId]` (route 84)

`PATCH` lets target accept or decline. `DELETE` lets current owner or cohost
revoke a pending invitation. Neither method reads legacy host capability.

#### `app/api/social/crews/[crewId]/join-requests` (route 85)

`POST` requests membership for verified actor. `DELETE` cancels that actor's
pending request. Neither body accepts another requester.

#### `app/api/social/crews/[crewId]/join-requests/[requestId]` (route 86)

`PATCH` accepts or declines one scoped Join Request. Durable authority decides
whether actor is current owner or cohost.

#### `app/api/social/crews/[crewId]/members/[memberId]` (route 87)

`PATCH` changes cohost or member role, or transfers ownership. `DELETE` removes
one non-owner. Path uses scoped Crew member ID, never account ID or Plan member
ID.

#### `app/api/social/crews/[crewId]/leave` (route 88)

`POST` leaves as verified actor. Self-leave stays available after friendship
loss or a block; owner leave remains a durable conflict until ownership moves.

### `app/api/cheap-pint-ping` - weekday push preference

- **Authority:** `resolveContributionIdentity` derives the stable profile actor
  from the authenticated account. The request cannot choose an account, actor,
  or public handle.
- **Validation:** `action` is limited to `qualify`, `opt-in`, or `decline`.
  Opt-in also requires a decoded browser PushSubscription that passes the shared
  web push token and endpoint allowlist.
- **Abuse boundary:** durable `isLimited` keys each action by stable actor and a
  salted IP hash. The raw IP is never stored or used as a key.
- **Storage and failure:** preference writes and push-token registration use
  server stores. Store failure returns the flat 503 public error. Responses are
  no-store so another browser cannot reuse private preference state.

### `app/api/push-tokens` — native/web push registration (route 61)

- **Route / method:** `POST app/api/push-tokens/route.ts` (Capacitor shell via
  `lib/nativePush.ts`; installed web app via the explicitly-invoked
  `lib/webPush.ts`, never on boot).
- **Validation:** `validatePushToken` (`lib/pushTokenStore.ts`) — trimmed
  non-empty `token` ≤ 2048 chars, `platform` ∈ {`ios`, `android`, `web`}; web
  values must decode to a PushSubscription with bounded browser-generated
  `p256dh`/`auth` keys. Its network destination must match the maintained exact
  Google FCM, Mozilla Autopush, or Apple Web Push HTTPS host/path allowlist on
  the default TLS port; IP literals, localhost, arbitrary/lookalike hosts, and
  custom ports are rejected again at provider send time. Native platforms
  cannot smuggle a web subscription; malformed or
  invalid payloads 400 in the flat public envelope before the limiter or store
  is touched.
- **Rate limit (dual boundary):** durable per-IP `isLimited` with key
  `push-tokens:${hashIp(clientIp(request))}` (raw IP never keyed), budget
  10/hour — a device registers once per boot — PLUS a route-wide global
  backstop (`push-tokens:global`, 300/hour across all callers). The per-IP key
  derives from forwarding headers an attacker can rotate per-request where the
  edge doesn't overwrite them; the global ceiling makes key rotation pointless
  and is the table-growth bound. Either exceed → 429
  `{ error, code: "RATE_LIMITED", retryable: true }`. Fail-open on limiter
  outage (no anonymous paid spend behind this route).
- **Auth stance:** deliberately anonymous — native registration happens
  pre-sign-in, and a row carries no identity (only "this device/browser can
  receive public pushes"). Web registration is invoked only after a real user
  action and granted browser permission. Upsert on token keeps re-registration
  idempotent, so table
  growth is bounded by distinct tokens × the IP budget.
- **Rollback / kill:** remove VAPID/APNs provider credentials to select the
  transport-specific loud no-ops, or 503 the registration route. Both client
  seams degrade fail-soft. Durable rows live in `public.push_tokens`
  (migrations 0039 + 0046, RLS on, anon/authenticated revoked);
  `truncate public.push_tokens` is a safe reset — devices re-register on next
  boot.

### `app/api/check-ins` — "we're out" check-in, including the out-tonight beacon (route 63)

- **Route / method:** `POST app/api/check-ins/route.ts` (Social Loop v1,
  `feat/social-loop-v1`) creates a check-in; `DELETE app/api/check-ins/route.ts`
  (`fm/out-tonight-beacon`) ends every check-in the caller authored ("turn off").
  The route also exports a read-only `GET` (the "Your lot" / area read) which is
  NOT a mutating verb and is not counted.
- **The out-tonight beacon is this same check-in, not a new table.** A beacon is
  a check-in with no note and visibility `friends` — the You-page toggle
  (`components/profile/OutTonightToggle.tsx`) is a thin POST/DELETE surface over
  this route, and the crew line (`components/profile/OutTonightCrewLine.tsx`)
  reads it back through `GET ?viewer=`. Two tables both answering "is this
  handle out" would be two sources of truth.
- **Validation:** `validateCheckInInput` (`lib/checkIn.ts`) — a normalised handle,
  an OPTIONAL area (a blank area normalises to `null`, a plain "out tonight"
  signal; a named area must be a known night-area slug — area-level location
  only, never a coordinate, and an unknown area is rejected, never coerced), an
  optional trimmed venue tag, a cleaned/capped note, and a visibility from the
  `{friends, area}` allowlist (defaults to `friends`). Malformed bodies 400
  before the store is touched.
- **Rate limit (boundary):** durable per-handle + hashed-IP `isLimited` with key
  `check-in:${handle}:${hashIp(clientIp(request))}` (raw IP never keyed) — 429 on
  exceed, on both POST and DELETE. This is the certification boundary
  (rate_limit class).
- **Auth stance:** the author is the self-asserted handle resolved through
  `resolveMessageHandle` (JWT-linked handle wins when signed in) and gated by
  `gateHandleAction` — the same demo identity boundary as a pint drop, on both
  POST and DELETE. A follow no longer shares it: both follow lanes refuse a
  caller with no bearer (401 `UNAUTHENTICATED`), because an add link needs an
  account.
- **DELETE stance:** deliberately skips `socialFreezeResponse()` — turning off is
  safety-reducing, so a solo-operator emergency freeze of social writes must
  never block it. It hard-deletes every check-in the caller authored
  (`deleteForHandle`); a check-in is single-purpose (one "we're out" state per
  handle) and short-lived (12h TTL), so no extra scoping is needed. Idempotent:
  deleting with no active check-in still returns 200.
- **Privacy:** friends-only by default; the single choke `lib/socialFeed.ts`
  decides which check-ins reach which viewer (mutual follows only), so a
  friends-only post can never reach a public query. Rows auto-expire after 12h
  (`expires_at`; `CHECK_IN_TTL_MS` is the one law — no second TTL constant).
  Durable rows live in `public.check_ins` (migration 0043; `area_slug` made
  nullable by migration 0083, RLS on, anon/authenticated revoked);
  `truncate public.check_ins` is a safe reset.
- **Related privacy change (same migration):** 0043 drops the `follows_public_read`
  policy so the follow graph is service-role-only — follow edges are private to the
  two parties and no follower counts are public.

### `app/api/plans/[id]/vibe-votes` — crew vibe vote (route 64)

- **Route / method:** `POST app/api/plans/[id]/vibe-votes/route.ts` (Vibe Layer
  share loop, `feat/vibe-votes`, docs/VIBE_LAYER_SPEC_2026-07-19.md surface 3).
  The route also exports a read-only `GET` (the aggregate tally: counts + top
  vibe) which is NOT a mutating verb and is not counted.
- **Validation:** `isVibeChipId` (`lib/vibeChips.ts`) — the vote must be one of
  the seven owner-locked chip ids (`bender`, `lit`, `quiet`, `cheeky`, `match`,
  `quiz`, `date`); anything else 400s before the store is touched. The store
  re-validates (defence in depth) and the migration's `check` constraint plus the
  RPC guard reject a bad value at the durable layer too.
- **Rate limit (boundary):** durable per-plan + hashed-IP `isLimited` with key
  `plan-vibe-vote:${id}:${hashIp(clientIp(request))}` (raw IP never keyed) — 429
  `{ retryable: true }` on exceed. This is the certification boundary (rate_limit
  class); the route also carries the Plan member capability (see below).
- **Auth stance:** member-capability bound — `planMemberCapability` resolves the
  private member token (Authorization bearer, path-scoped cookie, or body
  fallback) and the store admits only the host or a collaboration-authorized
  guest, the same authority as a route proposal vote. Upsert on (plan, member)
  keeps a revote idempotent and table growth bounded by crew size.
- **Read stance:** the `GET` tally is tokenless — counts only, no member
  identity — so the public share card (`app/api/plan-card`) and the read endpoint
  can render the crew tally without a capability, consistent with the plan card
  already being publicly renderable from its unguessable id.
- **Rollback / kill:** durable rows live in `public.plan_vibe_votes` +
  `public.plan_vibe_vote_requests` (migration 0044, RLS on, anon/authenticated
  revoked, service_role only); `truncate` both is a safe reset. Until the owner
  applies 0044 the durable write 503s and the tally read drops the share-card
  line (the card still renders) — no crash, no fake success.

### `app/api/area-demand` — unsupported-area demand capture (route 65)

- **Route / method:** `POST app/api/area-demand/route.ts` (Wayfinder 3.2,
  `lane/area-demand-capture`). Backs the demand ask on the honest unsupported-
  area preview (`components/coverage/UnsupportedAreaPreview`), which always shows
  the nearest supported patch as a live alternative BEFORE the ask (value first,
  never a form-wall — taste doctrine).
- **Validation:** `parseAreaDemandInput` (`lib/areaDemand.ts`) — `area` is
  REQUIRED (normalised, whitespace-collapsed, ≤ 80 chars) or 400 `INVALID_AREA`;
  `email` is OPTIONAL and, when a non-empty value is offered, must pass
  `parseEmail` or 400 `INVALID_EMAIL`. A blank/absent email is valid: demand is
  captured WITHOUT contact. `source` is coerced to the
  `{near-empty, area-picker, map-miss}` allowlist; `matchedPatchId` is re-derived
  server-side (an arbitrary body match is never trusted). No coordinates are
  ever accepted or stored. Validation runs BEFORE the limiter so a bad body 400s
  cheaply.
- **Rate limit (boundary):** durable per-IP `isLimited` with key
  `area-demand:ip:${hashIp(clientIp(request))}` (raw IP never keyed), budget
  8/min — a genuine user registers a handful of areas — PLUS a route-wide global
  circuit breaker (`area-demand:global`, 200/min across all callers) that bounds
  table growth against a distributed flood. Either exceed → 429
  `{ error, code: "RATE_LIMITED", retryable: true }`. This is the certification
  boundary (rate_limit class). Public contribution posture: NOT fail-closed — a
  transient limiter outage degrades to a tighter in-memory budget rather than
  refusing genuine signals (no anonymous paid spend behind this route).
- **Auth stance:** deliberately anonymous. Demand is a keyless community signal;
  a row carries no identity beyond an optional self-offered email. There is no
  account or capability gate by design — requiring sign-in to say "cover my area"
  would be exactly the form-wall the doctrine forbids.
- **Rollback / kill:** durable rows live in `public.area_demand` (migration 0045,
  RLS on, anon/authenticated revoked, service_role only); `truncate
  public.area_demand` is a safe reset. Until the OWNER applies 0045 the store
  fails soft to process-memory (`lib/areaDemandStore.ts`) — capture keeps working
  and becomes durable the moment the table lands, no code change (the same soft
  degradation vibe votes ship with). A hard durable-store write failure answers
  503 `STORE_UNAVAILABLE` rather than a fake success. Disabling is
  consequence-free: delete/503 the route and the preview's capture button fails
  soft to a quiet retry line while the alternative (nearest patch) still renders.

### `app/api/visit-reports` — structured Visit Reports (route 66)

- **Route / method:** `POST app/api/visit-reports/route.ts` (Wayfinder 3.4,
  `lane/visit-reports`). An individual account of one dated visit: observed
  busyness, noise, seating, bar wait, and an optional short note. The route also
  exports read-only `GET` paths for newest-first venue rows and exact visible
  counts by contributor. Neither read carries a score, average, or aggregate
  verdict, and neither is counted as a mutating verb.
- **Validation:** `validateVisitReport` (`lib/visitReports.ts`) requires the
  venue plus the handle derived from the authenticated account; body handles
  are ignored. Every structured field is coerced to a fixed allowlist (unknown
  → null, mirrored by the DB CHECK constraints in migrations 0046 and 0058);
  the note is cleaned, capped at 140 chars, and **slop-filtered at write time**
  (`lib/slopFilter`); `visitedAt` resolves to a London day key (a bare
  `YYYY-MM-DD` is taken verbatim and must be a real calendar day; a full
  timestamp folds through the London "evening date", so pre-dawn hours belong to
  the night before), and a date later than today in London or older than
  `MAX_VISIT_AGE_DAYS` (90 calendar days, both ends inclusive) is rejected —
  the date is authority-bearing because the public
  lane sorts on it, so the window is enforced HERE and the composer's `min`/`max`
  only mirror it; at least ONE signal must survive or the body 400s
  (`INVALID_REPORT`) before the limiter/store is touched.
- **Rate limit (boundary):** durable per-profile + hashed-IP `isLimited` with key
  `visit-report:${contributor.actor}:${ipHash}` (raw IP never keyed) —
  429 `{ code: "RATE_LIMITED", retryable: true }` on exceed. The public `report`
  action carries the same two-axis flood cap as Pint Drops (per-target + a
  per-actor budget of 1). This is the certification boundary (rate_limit class).
- **Moderation (boundary):** the `restore` / `hide` actions require the admin
  token (`isModerator` — moderator class). A public `report` records a
  per-actor-deduped flag but never changes visibility; this prevents an
  anonymous flag from becoming a one-tap eraser. Flagged, undecided rows surface
  in the admin moderation queue (`GET ?status=reported`), where a moderator can
  keep one visible or hide it without deleting its provenance. A hide is
  reversible from the same surface that made it: hidden rows keep their own
  moderator lane (`GET ?status=hidden`), carrying the identity a `restore` needs
  to put the account back on public reads.
- **Auth stance:** creation requires `resolveContributionIdentity`, which
  derives public attribution and the private actor from the authenticated
  account's immutable profile id. Missing or expired auth returns
  `sign_in_required`; incomplete profile setup returns `onboarding_required`.
  Creation pauses under the solo-operator social freeze; reporting and
  moderation stay open. Historic unlinked rows keep their stored attribution.
  One report per handle per venue per night: the store upserts on
  `(venue_id, handle, visited_at)`.
- **Rollback / kill:** durable rows live in `public.structured_visit_reports`
  (migrations 0046 + 0058, RLS on, anon/authenticated revoked, service_role only
  — a NEW table, distinct from the Pint Drop `visit_reports` table); `truncate` is
  a safe reset. Until the OWNER applies both migrations the store fails soft to process-memory
  (`lib/visitReportsStore.ts`) — capture keeps working and becomes durable the
  moment the table lands, no code change (the same soft degradation area demand
  ships with). A hard durable-store write failure answers 503
  `STORE_UNAVAILABLE` rather than a fake success. Disabling is consequence-free:
  delete/503 the route and the venue-sheet panel says it could not check rather
  than claiming no visits exist.
- **V1 moderation gap:** the queue is manual and reactive. It has no automated
  text classification, appeals, bulk actions, moderator assignment, or response
  target. The storage and public flag seam preserve all information needed to
  add those workflows later.

### `app/api/night-moments/[id]/alt-text` — author-confirmed alt text (route 67)

- **Route / method:** `PATCH app/api/night-moments/[id]/alt-text/route.ts`
  (Wayfinder 5.6, `lane/alt-text-authoring`). The author confirms (or clears) the
  alt-text description on their OWN photo Moment — the act that unblocks that
  photo for publication. A private authoring write, never itself a publication.
- **Validation:** body `altText` normalised by `cleanText(..., 200)` in
  `setMomentAltText` (`lib/nightMemoryStore.ts`); an over-long pre-normalisation
  payload 400s early. A non-empty description gains a fresh server-stamped
  `altTextConfirmedAt`; an empty one clears the stamp (and re-blocks the photo).
- **Auth stance (boundary):** `callerUserId` (account class). `setMomentAltText`
  additionally refuses unless the caller OWNS the Moment AND it carries media —
  a non-owner or a non-photo Moment answers 403. No account/memory identifiers
  are returned (mirrors the other Night surfaces).
- **Publication gate (belt & braces):** the description feeds the single publish
  choke — `proposeNightStoryPublication` / `confirmNightStoryPublication` refuse
  any selected photo Moment lacking author-confirmed alt text (naming it via
  `findPublishAltTextGap`), and `getPublishedRecapSource` never emits an
  UNCONFIRMED description as author text — composed AFTER the 5.5 redaction belt
  (departed contributors' media is dropped first; the alt-text belt then only
  touches surviving media). Private Memory saves never consult it.
- **Grandfathering:** already-published Stories are never retroactively
  unpublished; a pre-gate photo simply reports "no confirmed description" and its
  media still emits (the recap belt only nulls the unconfirmed text, not the
  photo). The gate applies to publishes going forward.
- **Rollback / kill:** durable in the additive `night_moments.alt_text` /
  `alt_text_confirmed_at` columns (migration 0047 — additive, idempotent, length
  CHECK ≤ 200; the OWNER applies with this release). Reads tolerate the columns'
  absence (report null); a Moment saved without a description never references
  them, so private capture keeps working pre-apply. Disabling is
  consequence-free: 503/remove the route and photos simply can't be described
  (and so can't be published) until it returns.

## Internal cron routes (excluded from the mutating-verb inventory)

The Vercel cron freshness plane schedules routes under `app/api/cron/*`
(inventory: `vercel.json`; runbook: `docs/CRON_PLANE_RUNBOOK.md`). They
are **mutating by effect** (weather writes to the durable `weather_snapshots`
store; What's-On stamps `feed_freshness`) but are deliberately **NOT counted in
the mutating-route inventory** (see the count at the top of this document):

- **They are `GET` handlers.** Vercel Cron dispatches `GET` (its dispatcher also
  accepts `POST`); the inventory scans for public `POST/PUT/PATCH/DELETE`
  handlers (`MUTATION_EXPORT`), which these do not export. The structural count
  is therefore unchanged by them.
- **They are internal, `CRON_SECRET`-gated schedulers, not a public surface.**
  Authority is `Authorization: Bearer $CRON_SECRET` enforced twice — by Vercel's
  cron dispatcher and again inside each handler (`lib/cronAuth.ts`,
  constant-time compare; unset secret in production ⇒ `401`, refuses to run).
  This is the certification boundary for these routes (an internal-secret gate,
  analogous to the moderator token) even though they are not part of the
  public mutating-verb tally.
- **Failure posture is no-fake-success:** provider outage ⇒ `502` with nothing
  written; durable write failure ⇒ `503`; per-area contract failures are skipped
  and reported. See `docs/CRON_PLANE_RUNBOOK.md`.

If a cron route is ever converted to a `POST` (or a public mutating verb is added
under `app/api/cron/*`), it MUST be folded into the inventory count in the same
commit.

### `app/api/venue-operators/claim` — venue operator claim (route 68)

- **Route / method:** `POST app/api/venue-operators/claim/route.ts` (Wayfinder
  3.5, `lane/operator-rail`). A signed-in account claims to run a venue and
  records HOW it can be verified (an email on the venue domain, a phone behind the
  bar, a document). v1 only RECORDS the claim; the OWNER verifies it manually in
  the admin queue. The route also exports a read-only `GET` (the caller's OWN
  claim state, or the moderator review queue) which is NOT a mutating verb and is
  not counted.
- **Validation:** `validateOperatorClaim` (`lib/venueOperators.ts`) — `venueId`
  required (≤ 120 chars), `evidenceKind` ∈ {`email-domain`, `phone`, `document`},
  a cleaned/capped (≤ 500) non-empty `evidenceNote`. Malformed bodies 400
  (`INVALID_CLAIM`) before the limiter/store is touched; the DB CHECK constraints
  in migration 0048 mirror the allowlists.
- **Auth stance (ACCOUNT — the CREATE boundary):** `account_id` is the VERIFIED
  Supabase uid from the bearer JWT (`callerAuthIdentity`), never a body value; an
  anonymous caller is 401. Idempotent per `(account_id, venue_id)` — a re-claim
  UPDATES in place and reopens the row to `pending`, so table growth is bounded by
  distinct account×venue pairs.
- **Rate limit (boundary):** durable per-account + hashed-IP `isLimited` with key
  `venue-operator-claim:${accountId}:${hashIp(clientIp)}` (raw IP never keyed),
  budget 10 — an operator may run a few pubs. 429 `{ code: "RATE_LIMITED",
  retryable: true }` on exceed. This is the certification boundary (rate_limit
  class).
- **Moderation (boundary):** `verify` / `reject` / `revoke` require the admin
  token (`isModerator` — moderator class); they set the verification state and
  stamp the review. Verification is the gate a proposal must pass (see route 69).
- **Freeze stance:** deliberately NOT wired to the solo-operator SOCIAL freeze — a
  venue operator asking to be verified is venue-BUSINESS content, not a social
  post. The freeze seam is intentionally absent (documented exemption).
- **Rollback / kill:** durable rows live in `public.venue_operators` (migration
  0048, RLS on, anon/authenticated revoked, service_role only); `truncate` is a
  safe reset. Until the OWNER applies 0048 the store fails soft to process-memory
  (`lib/venueOperatorsStore.ts`) — the flow keeps working and becomes durable the
  moment the table lands. A hard durable write failure answers 503
  `STORE_UNAVAILABLE`, never a fake success.

### `app/api/operator-proposals` — reviewed operator proposals (route 69)

- **Route / method:** `POST app/api/operator-proposals/route.ts` (Wayfinder 3.5,
  `lane/operator-rail`). A VERIFIED operator proposes an attributed, structured
  update (`correction` / `event` / `offer` / `response`) that routes through
  REVIEW. The route also exports a read-only `GET` (the moderator review queue by
  status) which is NOT a mutating verb and is not counted.
- **Validation:** `validateOperatorProposal` (`lib/operatorProposals.ts`) —
  `venueId` + `type` required; the flat structured payload (title/body/field/
  startsAt) is cleaned/capped and must carry the type's required fields
  (correction → field+body, event → title+startsAt, offer → title+body, response
  → body) or 400 `INVALID_PROPOSAL`.
- **Auth stance (ACCOUNT + CAPABILITY — the CREATE boundary):** `account_id` is
  the VERIFIED uid (`callerAuthIdentity`; anonymous → 401), AND the caller must
  ALREADY be a VERIFIED operator of the venue
  (`venueOperatorsStore().isVerifiedOperator`) or the proposal is 403
  `NOT_VERIFIED_OPERATOR`. The verification check fails CLOSED on a storage wobble
  (returns false), so no proposal slips through unverified.
- **Rate limit (boundary):** durable per-account + hashed-IP `isLimited` with key
  `operator-proposal:${accountId}:${hashIp(clientIp)}`, budget 20 — 429
  `{ retryable: true }` on exceed. This is the rate_limit-class boundary; the
  route also carries the moderator class (accept/decline).
- **Moderation + the admin acceptance seam (boundary):** `accept` / `decline`
  require the admin token (`isModerator`). TRUSTED DATA IS UNTOUCHED — a proposal
  NEVER writes a venue fact. Only the `accept` branch (the admin acceptance seam)
  materialises an accepted payload into served evidence, and even then only as a
  `FactSource` of authority `operator` (rank 0, `factClaims.
  acceptedProposalFactSource`): additive, attributed, and exposed as a CONFLICT if
  it disagrees with the observed corpus, never a silent overwrite. A fence test
  (`__tests__/operatorProposalFence.test.ts`) asserts the proposal store/module
  import NO venue-fact module — the acceptance route is the sole bridge.
- **Freeze stance:** NOT under the SOCIAL freeze (venue-business content), same
  exemption as route 68.
- **Rollback / kill:** durable rows live in `public.operator_proposals` (migration
  0048, RLS on, anon/authenticated revoked, service_role only); `truncate` is a
  safe reset. Fails soft to process-memory until 0048 lands
  (`lib/operatorProposalsStore.ts`); a hard write failure answers 503.

### `app/api/price-submit` - community price and venue-signal submissions (route 70)

- **Route / method:** `POST app/api/price-submit/route.ts` (`fm/price-submission`).
  A drinker standing in the pub logs tonight's price for one drink category; it
  shows on the venue sheet at once, and the pin/card restamp only after the
  trust gate (second independent submitter, 30-day window - policy in
  `lib/communityPrice.ts`). Sibling of `POST /api/price-confirm`, which only counts
  vouches for an already-displayed figure; this is where a figure first enters
  the map from the community. It is no longer the only door: a Round's itemised
  drink lines (`POST /api/rounds/[code] { action: "recordSpend" }`) reach
  `submitCommunityPrice` only when the writer passes the same authenticated
  account and public-handle boundary. Anonymous lines remain in the private
  Round diary. Direct and Round price
  writes use the account's stable profile actor. The same POST also carries the
  community VENUE SIGNAL shape (`{ kind: "venue-signal", venueId, signalKey,
  signalValue }` → 201 `{ ok, signal }`): a categorical observation of
  character, step-free entrance, step-free toilets, door policy or whether people are eating
  (`lib/communityVenueSignals.ts`). It is a second shape, not a second route -
  deliberately, so it inherits this route's identity, limiter and moderation
  boundaries rather than growing a parallel set. The route also exports
  read-only `GET` branches - the freshest community prices AND venue signals
  for a venue (`?venueId=` answers `{ prices, signals }`, with `degraded: true`
  when either read could not be trusted, so "could not check" never reads as
  "none"), the cross-venue no-alcohol lens index (`?lens=no-alcohol`), and
  `?scope=provisional-base`, which answers which of up to
  `MAX_PROVISIONAL_BASE_VENUE_IDS` on-screen `venue-uk-*` pins carry a fresh
  uncorroborated pint report. Every id on that branch is validated as a stable
  salted base id server-side and the answer carries ids only, never a figure,
  so viewport visibility cannot reach the price merge. None of the three is a
  mutating verb and none is counted.
- **Validation:** `validateCommunityPrice` (`lib/communityPrice.ts`), the SAME
  browser-safe validator the submit UI runs, so client and server can never
  drift - `venueId` cleaned/capped at 64 chars, `drinkCategory` restricted to the
  closed `DRINK_CATEGORIES` union, and `priceGbp` held to the plausible envelope
  £1 - £30. Out-of-envelope or malformed input 400s with reader-facing copy before
  the limiter or store is touched; the store re-checks the penny envelope and
  migration 0054 adds the same CHECK, so three layers agree. The `venueId` must
  also exist in the slim venue index (`getVenueIndex`), or - for a `venue-uk-*`
  id - in the UK base id index (`lib/ukBaseIndex.ts`); an unknown id 400s
  without storing anything, and when the index itself is unavailable (its
  documented degraded mode is an empty map) the route answers 503 (retryable),
  never a 400 and never a stored row. The venue-signal shape runs the same venue
  resolution (pub kinds and `venue-uk-*` ids only, same 400/503 split) behind
  `validateCommunityVenueSignal`, whose `signalKey`/`signalValue` pairs are a
  CLOSED vocabulary the browser and the server share and migration 0060 repeats
  as a CHECK, so an off-vocabulary answer cannot be stored by any door.
- **Auth stance:** price and venue-signal writes require a verified account,
  account-owned public handle, and completed private profile. Both public
  attribution and the private `profile:<profile-id>` actor are derived on the
  server. Body-supplied handles, actors, `submittedAt`, and `source` are
  ignored. This stable profile actor is the de-duplication and corroboration
  key and never leaves the store. The reader-report branch stays public and
  uses its separate abuse-controlled actor because reporting an existing row
  is not a contribution.
- **Rate limit (boundary):** two durable `isLimited` tiers on the POST. An
  account-wide cap keyed `price-submit-actor:profile:<profile-id>` (30/hour)
  stops one account spraying observations across the whole map by rotating
  `venueId`; then `price-submit:profile:<profile-id>:${venueId}` stops the same
  account churning one pub's figure. Exceed either → 429. Both tiers are one
  helper (`communityWriteIsLimited`) and a venue-signal write charges the SAME
  two keys, so signals cannot buy extra budget or spray one pub. An authorised
  Round's drink lines use the same account-actor key namespace and cap, charged
  one unit per line before a saved pending line becomes ready for promotion
  (`lib/roundPriceBudget.ts` owns that budget and its degraded allowance, which
  answers 503 with `Retry-After` rather than 429, because a spent degraded
  allowance is our limiter being unreachable, not the drinker's doing). The
  `?scope=provisional-base` READ carries its own durable tier keyed
  `provisional-base:${actor ?? "anon"}` (120 per minute, refused with
  `Retry-After`): unlike the other two GET branches it pages the durable store
  per request, so a scripted sweep of the country is budgeted while a session
  of panning - which asks only for ids it has not already read - sits well
  inside it.
- **Provenance (the honesty boundary):** the route only ever APPENDS to
  `community_prices`. It touches NOTHING in the versioned venue dataset, the
  scraped price CSV, or `visit_reports` - a submission cannot overwrite a scraped
  or sourced price. The venue sheet renders the community price on its own dated,
  badged row ABOVE the price on record, which still renders untouched. A venue
  signal is held to the same line: it is an OBSERVATION, never a venue fact, so
  it never edits the dataset's amenity, access or character fields and the sheet
  words it as drinkers' reports (`lib/communityVenueSignals.ts` owns that copy
  and the `unknown` | `reported` | `established` trust states a surface may read).
  The only row a signal write can touch is this account's own earlier answer to
  the same question, which it replaces.
- **Rollback / kill:** durable rows live in `public.community_prices` (migration
  0054, with optional contributor attribution and retained quality stamps added
  by migration 0059; RLS on, no anon/authenticated policy, service_role only).
  `truncate` is a safe reset and cannot damage dataset prices. Migration 0060
  widens that one table to hold venue signals too - nullable
  `drink_category`/`price_pennies` plus `signal_key`/`signal_value`, a CHECK that
  a row is exactly one shape, and a unique `(venue_id, signal_key, actor)` so
  one actor answers each question once. Its revoked
  `public.community_contributor_counts` view remains an internal actor-key
  roll-up and does not feed the public contributor record. Dropping the two
  signal columns reverts that surface without touching a price. Until 0054 is
  applied the store fails soft to process-memory outside production
  (`onMissingDurableWrite` refuses the ephemeral fallback in a deployed
  production instance), so keyless dev keeps working; a hard durable write
  failure answers 503, never a fake success.

### `app/api/admin/community-prices` - community observation moderation (route 71)

- **Route / method:** `POST app/api/admin/community-prices/route.ts`
  (`fm/trust-quickfixes`), actions `hide` and `restore` on ONE community
  observation. The receiving side of route 70: until this existed, a wrong or
  malicious community price had no moderator removal path, and the only
  remediation was hand-written SQL. The route also exports a
  read-only `GET` (the reported/hidden review queue) which is NOT a mutating verb
  and is not counted. ONE queue, TWO shapes: each queue row says which it is
  (`kind`), so a wrong character or step-free claim is removed here rather than
  through a second console or a second API.
- **Auth stance:** moderator-gated by `isModerator` (`lib/adminAuth.ts`) on BOTH
  verbs - the `x-admin-token` header or the httpOnly admin session cookie, never
  a query-string token; with `ADMIN_TOKEN` unset the gate opens only in dev/test,
  so a preview deploy is never wide open. Same gate as the Pint Drop and comment
  queues.
- **Validation:** `action` restricted to `hide` | `restore` (anything else 400s,
  and there is deliberately no `delete`), `id` required (400 when missing, 404
  when unknown), and the free-text `note` is control-char-stripped and capped at
  280 chars in the store.
- **Reader-side flag (no new route):** readers complain through the existing
  `POST /api/price-submit { action: "report", id }` - the id of EITHER shape,
  carried on the venue read - which is durably
  one-report-per-actor (`community_price_reports`' unique pair) plus two
  `isLimited` tiers. Reporting NEVER auto-hides - unlike Pint Drops, whose
  threshold auto-hide is safe because a drop is one person's post; a community
  price is the figure the map is made of, and an anonymous threshold here would
  be a one-tap eraser for any price a griefer disliked.
- **Hide, never delete (the honesty boundary):** `hide` stamps `hidden_at`; the
  observation, its answer, its date and its report metadata all survive, so a
  wrong call is one `restore` away and the audit trail is intact. Each shape is
  filtered in ONE place in `lib/communityPriceStore.ts` (`freshestPerCategory`
  for prices, `freshestVenueSignals` for venue signals), so a hidden price leaves
  the venue sheet, the corroboration count, and the map candidate together, and a
  hidden signal leaves the sheet, the corroboration count and the established
  answer together - there is no second place that can remember either.
- **Rollback / kill:** the columns and the report ledger live in migration 0055
  (`community_prices.hidden_at` et al. + `public.community_price_reports`, RLS
  on, no anon/authenticated policy, service_role only), and cover venue signals
  unchanged because 0060 keeps them in the same table. Clearing `hidden_at`
  restores everything; the store fails soft to process-memory until 0055 lands,
  and an unavailable durable read degrades the queue to empty rather than 500.

### `app/api/weather-recommendations` - authored weather Recommendations (route 72)

- **Route / method:** `POST app/api/weather-recommendations/route.ts`
  (`fm/weather-recommendations`) creates or updates one Pubmaxxer's opinion for
  one venue and condition. The same POST accepts moderator-only `hide` and
  `restore` actions for one row. Its `GET ?venueId=...` is read-only and is not
  counted.
- **Validation:** `validateWeatherRecommendation`
  (`lib/weatherRecommendations.ts`) is shared by client and server. It requires
  a canonical venue, normalized Pubmaxx handle, 8 to 160 character plain
  reason, and exactly one closed condition from `warm`, `clear`, `raining`,
  `cold`, or `windy`. The database repeats those bounds. Unknown venues and
  off-vocabulary conditions are rejected before persistence.
- **Identity and attribution:** creation requires
  `resolveContributionIdentity`, which derives the public handle and a
  profile-based actor (`profile:${profile.id}`) from the authenticated account's
  immutable profile id. Body handles are ignored. Missing or expired auth
  returns `sign_in_required`; incomplete profile setup returns
  `onboarding_required`. Historic unlinked rows keep their stored attribution.
  The handle is public authorship; the actor never leaves the store and is never
  accepted from the body.
- **Rate limit (boundary):** an actor-wide durable `isLimited` budget keyed by
  the profile-based actor allows 30 writes per hour across venues. A second
  per-actor, per-venue budget allows five per hour. One natural row per
  `(venue, condition, contributor_handle)` means edits under the same handle
  replace the author's earlier reason rather than increasing their contribution
  count.
- **Moderation (boundary):** `hide` and `restore` require `isModerator`; a
  reader cannot hide a Recommendation. Hiding is reversible, keeps authorship
  and moderation provenance, removes the row from venue reads and contributor
  counts together, and never deletes it.
- **Weather and read honesty:** the GET uses only the existing store-first
  Open-Meteo snapshot and nearest Night Area. Known current conditions filter
  human-authored rows. Missing, future, or expired weather returns
  `weatherStatus: "unavailable"` and surfaces authored rows unconditionally, so
  "we could not check" never becomes "nobody recommended this". Weather never
  authors, verifies, scores, or ranks a Recommendation.
- **Payload and contributor-record seam:** venue reads start from at most 20 newest
  rows and enforce an 8 KiB serialized response ceiling, reporting `truncated`
  if the runtime ceiling removes any. `countForContributor` derives the visible
  count for profile surfaces, while the public contributor record combines
  visible Recommendations with its other identity-backed lanes. Neither count
  nor any aggregate score or venue rank appears in this venue API response or
  the venue UI.
- **Rollback / kill:** durable rows live in
  `public.weather_recommendations` (migration 0058, with moderation fields and
  the contributor-record aggregate added by 0059; RLS on, anon/authenticated
  revoked, service-role only). A missing migration falls back to memory outside
  deployed production; production writes fail with 503. Reads carry `degraded`
  when durable storage cannot answer. Truncating this table removes authored
  Recommendations and their contributor counts, but cannot change weather,
  reviews, prices, Night Signals, or venue data.

### Contributor identity onboarding

- **Routes / methods:** `POST` and `PATCH` on
  `app/api/identity/onboarding/route.ts` claim an account-owned handle and edit
  optional private full name and sex. Date of birth is required on the signup
  POST. Its sibling GET is read-only.
- **Authority:** every method derives the account from a verified Supabase JWT
  through `callerUserId`. Missing authority returns 401 before any read or
  write. Handle ownership is enforced transactionally by
  `complete_contributor_onboarding`; reserved handles are rejected by shared
  code policy.
- **Privacy:** date of birth, optional full name and optional sex stay in the
  private account table and are not returned by public profile routes. Date of
  birth stays until profile deletion; full name and sex stay until edited,
  cleared or profile deletion. No contribution eligibility is derived.
- **The PATCH creates the row it edits.** An account that claimed its handle
  through the early path stores no date of birth, so it has no
  `private_account_identities` row at all, and the save was refused for that
  row's own absence. An owner may now save private details whatever the
  onboarding status says. Two real refusals remain, and they are two findings:
  no profile at all is 409, and a first save carrying no date of birth is 400,
  because the column is NOT NULL.

### `app/api/identity/adult-assertion` - the recorded 18-or-over tap

- **Route / method:** `POST` on `app/api/identity/adult-assertion/route.ts`
  records that this account tapped "I'm 18 or over" (captain decision
  2026-08-10, migration 0103). Idempotent: a second tap keeps the first instant.
- **Authority:** the account comes from the caller's own verified bearer token
  through `callerUserId`, and from nothing in the body, because an assertion
  made about somebody else is not an assertion. Missing authority is 401.
- **Rate limit (boundary):** `isLimited` (`lib/pintDrops.ts`) on a per-account
  key.
- **What it is not:** not a capability. The single reader is `accountIsAdult`
  (`lib/socialLaunch.ts`), which answers the age question for Social and for
  pub photo walls. A stored date of birth still decides when there is one, in
  both directions, so a recorded assertion can never overturn an under-18 date
  the account itself gave. The reply carries no access state: the caller
  re-asks `/api/social/access`, which stays the one authority on what a viewer
  may see.

### `app/api/invite/[token]/rsvp`, `app/api/invite/[token]/reactions`, `app/api/plans/[id]/invite-rsvp`, and `app/api/plans/[id]/invite-rotate` - Plan public invite RSVP, reactions, and link rotation (route 89)

- **Route / method:** `POST` on `app/api/invite/[token]/rsvp/route.ts`,
  `GET` + `POST` on `app/api/invite/[token]/reactions/route.ts`, host-only
  `DELETE` on `app/api/plans/[id]/invite-rsvp/route.ts`, and host-only `POST`
  on `app/api/plans/[id]/invite-rotate/route.ts`. Public guest writes stay on
  the invite bearer URL; host removal and rotation live under
  `/api/plans/[id]/…` so the path-scoped HttpOnly member cookie can authorize
  after a hard `/invite/[token]` open.
- **Identity is handle-free by design:** the RSVP POST accepts a
  server-hygiened display name and a Going/Maybe status, keyed by
  `hashActor(submitterId)` where `submitterId` is the visitor's own device id
  from `lib/anonId.ts`. No account, no Pubmaxx handle, no session. A unique
  `(plan_id, submitter_hash)` row means resubmitting from the same device
  updates that device's own RSVP rather than adding a second guest.
- **Token boundary:** public invite writes resolve the token through
  `resolveClassicInvitePlan` (`lib/planInviteResolve.ts`), which requires the
  same classic-plan `planStateResult` gate as the invite page (Crew-bound plans
  404). Neither public write route accepts a plan id from the client.
- **Text hygiene (boundary):** guest display names pass through
  `cleanText`/`readString` (`lib/textClean.ts`), the same hygiene already used
  for handles and comments, before persistence.
- **Rate limit (boundary):** `isLimited` (`lib/pintDrops.ts`) allows 8 RSVP
  writes per submitter-hash and 32 per invite-token hash per 60 seconds, plus
  40 reaction writes per submitter-hash per 60 seconds. Missing submitter ids
  are rejected.
- **Freeze gate:** mutating invite routes call `socialFreezeResponse`
  (`lib/opsFreeze.ts`) first, the same ops-freeze posture as every other social write.
- **Host-only removal:** RSVP `DELETE` on `/api/plans/[id]/invite-rsvp`
  requires a valid plan-member session resolved through
  `planMemberCapability`/`planMemberIdentity` and rejects a guest member with
  403. Only the host may remove another guest's RSVP.
- **Host-only link rotation:** `POST` on `/api/plans/[id]/invite-rotate`
  requires the same `planMemberCapability`/`planMemberIdentity` host check and
  rejects a guest or missing capability with 403. A successful rotation mints
  a fresh `invite_token` (`rotateInviteToken`, `lib/planStore.ts`) and
  overwrites the plan's stored token, so the old `/invite/[token]` link 404s
  on its very next use through `resolveClassicInvitePlan`.
- **Guest-list caps:** `GUEST_LIST_DISPLAY_CAP` (40, `lib/planInvite.ts`)
  trims the invite page's visible guest list; `counts` still tallies every
  row, so the shown "+N more" line stays honest. `RSVP_PLAN_CEILING` (200)
  is a hard write-side limit enforced in both `PlanInviteRsvpStore`
  implementations: a brand-new guest is refused with `RsvpCapExceededError`,
  surfaced as a 409, once a plan already holds that many RSVP rows; an
  existing guest may still change Going/Maybe at the ceiling.
- **Rollback / kill:** durable rows live in `plan_invite_rsvps` and
  `plan_invite_reactions` (migration 0081, shipped not applied). RLS denies
  `anon`/`authenticated` outright; every access is service-role only, the same
  posture as the Social interaction tables. A missing migration falls back to
  memory outside deployed production; production writes fail closed. Truncating
  these tables removes only RSVPs and reactions, never the Plan itself.

### `app/api/auth/change-password/verify` - caller-owned password proof

- **What it writes:** nothing. The route uses the caller's verified Supabase
  email to run `signInWithEmailPassword` and discards the temporary grant.
  Password replacement stays in the signed-in browser through GoTrue's
  owner-bound `updateUser` call.
- **Boundaries:** same-origin only, verified bearer required, and eight
  attempts per hashed IP per 15 minutes with fail-closed durable limiting.
  Missing, short, or wrong current passwords share one 401 response.
- **Rollback / kill:** remove the route and make the password form use the
  create flow only. Existing password creation remains signed-in and
  owner-bound.

### `app/api/auth/session` - durable sign-in resume cookie

- **What it writes:** an HttpOnly, SameSite=Lax, 30-day first-party cookie
  holding the caller's Supabase refresh token and verified account email
  (`lib/authSessionResume.ts`). No database row is written; the cookie is the
  only state.
- **Boundaries:** every mutating action consults `isLimited` per hashed IP
  (`persist`/`clear` 60/hour, `redeem` 60/hour, `resume` 6 per 15 minutes -
  `resume` sends a magic-link email, so it mirrors the manual form's budget).
  Mutating methods refuse plainly cross-site callers via `Sec-Fetch-Site` /
  `Origin` on top of SameSite=Lax. `persist` requires a bearer token that
  passes `verifyCallerAuth` whenever verification is available and refuses a
  token that fails it; `redeem` exchanges the cookie's refresh token at
  Supabase Auth server-side, so a forged cookie yields nothing. `resume` only
  accepts a same-origin `/auth/callback` redirect target.
- **Rollback / kill:** delete the route; cookies die at Max-Age. Sessions fall
  back to localStorage-only persistence (the pre-cookie behaviour).

## Certification command

```bash
npx vitest run __tests__/writeSurfaceCertification.test.ts __tests__/rateLimit.test.ts
```

## Production evidence — 17 July 2026

- The production `check_rate_limit` RPC returned `false`, `false`, then `true` for
  three sequential hits against a limit of two. The disposable certification row
  was removed immediately afterward.
- Both Vercel production projects, `chengdu` and `pubmax`, contain the required
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SALT`, and `ADMIN_TOKEN`
  variable definitions. Values are sensitive and are never printed or committed.
- Route and limiter tests prove the fail-closed option returns the documented 429
  path before a Plan or paid-provider request proceeds.

### `app/api/venue-photos` - pub photo walls (route 73)

- **Route / method:** `POST app/api/venue-photos/route.ts`
  (`fm/feature-pub-photo-walls`) adds one community photo to a venue's wall from
  a multipart body carrying the photo and its details. The same POST accepts a
  public `report` action and moderator-only `hide` and `restore` actions for one
  row. Its `GET ?venueId=...` wall page and the moderator `?status=` lanes are
  read-only and are not counted. The public serve route
  `GET app/api/venue-photo/[venueId]/[photoId]/route.ts` is read-only too.
- **Validation:** `validateVenuePhotoSubmission` (`lib/venuePhotos.ts`) requires
  a venue id narrow enough to be a storage key segment, takes an optional tag
  from the one closed drink taxonomy (`lib/drinks.ts`, repeated by the database
  CHECK in migration 0098) and an optional caption cleaned and capped at 140
  characters. An off-taxonomy tag is rejected rather than quietly dropped,
  because a silently untagged photo reads to its author as one that took.
- **Identity and attribution:** creation requires `resolveContributionIdentity`,
  which derives the public handle and a profile-based actor
  (`profile:${profile.id}`) from the authenticated account's immutable profile
  id, plus an 18-or-over check through the one shared gate (`accountIsAdult`):
  the account's own stored date of birth, or its recorded one-tap assertion
  (migration 0103). Body handles and body ages are ignored. The stored row
  carries the stable actor, so a public handle rename never strands a photo; the
  public wall projects the handle, avatar and founding number through the ONE
  shared projection (`publicProfileFromRecord`), never a second field list.
- **Rate limit (boundary):** every upload costs one paid safety scan, so the
  per-account durable `isLimited` budget is `failClosed` - a limiter that cannot
  be reached refuses rather than handing the provider bill to whoever asks. The
  budget and the per-account-per-venue cap are both counted BEFORE any bytes are
  prepared, staged or scanned. Reporting carries its own per-target and
  per-actor budgets, with the reporter actor derived from the request origin.
- **Cap (boundary):** 100 photos per account per venue, counted in
  `venuePhotoStore().countForAuthorAtVenue` against that account's own live rows
  for that venue. A moderator hide gives the slot back, because a removal is not
  a spent slot. The composer hides its button at the cap as a courtesy; the
  route is the fence.
- **Media path:** the shared upload journey (`lib/uploadedImage.server.ts`,
  the same one the owned profile images take) - declared type, size, magic
  bytes, asserted metadata strip, sharp rotate, resize into the wall's portrait
  box, JPEG, re-probe. Bytes are staged privately, signed for a short window,
  and reach the venue's serving key ONLY on an approval from the image scan
  adapter (`lib/profileAvatarModeration.ts`), which fails closed with no key
  configured. A refused or unscannable photo leaves nothing public.
- **Moderation (boundary):** `report` records a per-actor-deduped flag for the
  human queue and never hides; `hide` and `restore` require `isModerator`.
  Hiding is reversible, keeps the row, its bytes and its report provenance, and
  removes the photo from the wall, the pages and the author's cap count
  together. A flag after a keep re-opens a still-visible row.
- **Crosspost honesty:** "Also share to your feed" is a request, never a
  guarantee. The feed write goes through the existing Social post machinery
  behind `requireVerifiedSocialActor`, so the wall never buys a lane around
  Social's own gate or moderation queue. The reply carries a three-state
  `crosspost` answer (`off`, `posted`, `unavailable`); a feed failure is
  reported and never fails the wall, because the photo is already approved and
  stored by then.
- **Read honesty:** a wall page carries the store's own `status`, so an empty
  wall and a failed lookup are two different sentences. A tile whose author has
  been tombstoned is dropped from the page and its serve route answers 404; the
  tombstone trigger in migration 0098 deletes both the rows and their Storage
  objects when an account leaves.

### `app/api/starter-packs/[slug]/follow` - follow a whole starter pack (route 90)

- **Route / method:** `POST app/api/starter-packs/[slug]/follow/route.ts`.
- **Actor (boundary):** the same seam as the single follow, and the same law.
  `resolveMessageHandle` prefers the JWT-linked handle over anything in the
  body, a caller with no bearer is refused (401 `UNAUTHENTICATED`) whatever
  handle the body names, and `gateHandleAction` then refuses a signed-in caller
  acting as a handle another account owns. Both follow lanes state one rule: a
  follow needs an account, so an unlinked handle plus no bearer writes no edge
  here and none through `POST /api/profiles/[handle]/follow`.
- **Rate limit (boundary):** ONE per-actor plus hashed-IP `isLimited` spend for
  the whole pack, not one per member, because the drinker made one decision. The
  budget is deliberately small (6 per minute): a pack follow is a considered act.
- **Idempotence:** a follow edge is idempotent, so a second tap answers 200 with
  every member reported `already`. No edge is written twice and no notification
  is emitted twice - `followOnce` (`lib/followWrite.server.ts`) is the one edge
  write both this route and the single follow go through.
- **Honesty:** the reply carries a per-member outcome (`followed`, `already`,
  `self`, `unavailable`, `failed`) and a summary that names the number that did
  not go through. A member the write refused because they are gone is
  `unavailable`, its own word, because rounding a permanent refusal into
  `failed` reads as a fault the drinker could retry. One member's storage
  failure never fails the eleven beside it and is never rounded up into a
  success. Membership itself is `lib/starterPacks.ts`: claimed,
  live accounts placed by their own public location or holding a founding
  number, never a seeded or invented member.
- **Scope:** a pack below the member floor answers the same 404 as an unknown
  slug, so the refusal discloses nothing about who is in it. The pack list in
  `GET app/api/starter-packs` is public and `no-store`; an optional viewer makes
  the response personalised and returns that viewer's follow count tri-state,
  so a failed count is never read as "follows nobody".

### `app/api/venues/[id]/occupancy` - crowd occupancy readings (route 91)

- **Route / method:** `POST app/api/venues/[id]/occupancy/route.ts` writes one
  now reading of seats for a venue. The same POST accepts a public `report`
  action and moderator-only `hide` and `restore` actions for one reading. Its
  `GET` is public, read-only, and not counted.
- **Validation:** `parseOccupancyLevel` (`lib/occupancy.ts`) takes one of the
  three closed levels (empty / some seats / full); anything else is refused.
  The venue id is trimmed to a storage-key-sized segment.
- **Identity (boundary):** a reading requires `callerUserId`, and the stored
  `reporter_user_id` is the authenticated account. The browser sends no actor.
  Writes are idempotent per account per pub per 15 minutes, and the printed
  corroboration figure counts DISTINCT accounts rather than rows, so one
  drinker's retakes never read as agreement nobody gave.
- **Rate limit (boundary):** a reading spends a per-account durable `isLimited`
  budget. A reader flag spends its own per-target and per-actor budgets, with
  the actor derived from the request origin (`hashActor` over `hashIp`), never
  from the body.
- **Write target:** `resolveWritableVenueId` (`lib/venueWriteTarget.server.ts`)
  is the one resolver every community write shares, so an alias cannot split
  one pub's readings across two keys. The public GET canonicalises through
  `resolveCanonicalVenueId` alone, because the writable resolver would refuse
  an unknown id on a read that is allowed to answer "no reports".
- **Moderation (boundary):** the same shape community prices and pub photo
  walls already use. `report` records a per-actor-deduped flag through
  `report_occupancy_report` (migration 0109) and never hides; `hide` and
  `restore` require `isModerator`. Hiding is reversible and keeps the row and
  its flag provenance, and a hidden reading leaves the now answer, the printed
  age and the reporter count together. `venue_occupancy_flags.actor_hash` is
  NOT NULL with an `anonymous` sentinel, because NULLs never conflict and every
  unattributed flag would otherwise insert a fresh row and inflate the count.
  The flag stamp is `flagged_at`; `reported_at` stays the observation time, so
  a complaint can never promote a stale reading into the live now window.
- **Deploy order:** either order is safe. The store asks for 0109's columns and
  drops to 0107's for the life of the process on a PostgREST 42703 (the table
  is there, the column is not), rather than degrading every venue sheet.
- **Read honesty:** the read carries its own state (`fresh`, `stale`, `none`,
  `degraded`), so a failed lookup is never worded as a pub nobody has reported.
  A write that landed still thanks the tap when the read-back degrades.

### `app/api/plans/[id]/session` PUT and PATCH - Plan account claim and recovery (route 92)

- **Route / method:** `PUT app/api/plans/[id]/session/route.ts` binds a
  guest-created Plan membership to the signed-in account. `PATCH` restores a
  lost member capability from the account's stamped seat. The existing `POST`
  capability exchange is unchanged, and `GET` stays read-only and uncounted.
- **Identity (boundary):** both handlers require `verifyCallerAuth` to answer
  `verified`; an unavailable verifier is a retryable 503, never a quiet 401.
  The claim additionally requires the path-scoped HttpOnly member cookie
  (`planMemberCookieCapability`), so a bearer alone cannot claim a seat it
  never held, and a cookie alone cannot bind a seat to nobody.
- **Rate limit (boundary):** the claim spends a per-IP `isLimited` budget; the
  recovery spends a global per-IP ceiling plus a per-IP/account/Plan budget and
  requires an idempotency key. Server-side account/Plan idempotency derives the
  stable rotated member token, so concurrent recovery requests converge.
- **Write:** one RPC each (`claim_plan_membership`,
  `recover_plan_account_membership_atomic`), so a partial claim can never leave
  a Plan attached to two accounts and a recovery can never mint a second seat.
  A membership held by a different account is an honest 409. The missing-function
  fallbacks preserve keyless and development parity after identity verification
  when the current Plan schema is present; a genuine write failure remains a
  refusal.
- **Browser proof:** `e2e/plan-capability-recovery.spec.ts` runs in the
  `law-pins` job. Its signed-out case proves that a lost capability does not
  trigger a recovery PATCH. The signed-in case remains deliberately skipped in
  the keyless server: without `SUPABASE_SERVICE_ROLE_KEY`, `getSupabaseAdmin()`
  is null, `verifyCallerAuth` answers `unavailable`, and both the claim PUT and
  recovery PATCH answer 503. The complete journey remains in the spec for a
  future authenticated browser lane; shared doubles live in
  `e2e/helpers/authDoubles.ts`.

The structural scan, live atomic-limiter check, and deployment configuration must
all remain green. A future route added without a reviewed boundary fails the closed
inventory count and boundary assertions in CI.
