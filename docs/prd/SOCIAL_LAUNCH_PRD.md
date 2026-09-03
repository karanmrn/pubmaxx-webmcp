# PRD: Friends-only social launch + uploaded profile pictures

> Status: APPROVED direction (captain, 2026-08-08): three locked decisions below.
> Executor: Cursor. One PR per work package unless a package notes a split.
> Sibling PRDs: `PUBPAL_CONNECTIONS_PRD.md`, `UI_UX_FIX_PRD.md`,
> `SOCIAL_NIGHT_OS_VISION_PRD.md` (next social waves after this launch floor).
> Panel evidence: firstmate builder and skeptic seat reports of 2026-08-08.
> Every file:line reference below was verified against the worktree at `46da5cb3`.
> Laws: root `CLAUDE.md` + `docs/VOICE.md` bind every package. The four
> guardrails at the bottom are law, not advice.

## Why we build (the mission, from the founder)

PUBMAXX is a D2C app for everyone, London-first. Instagram and TikTok glue
people to screens and pull them apart; we exist to put real people in real
places together - pubs, plans, crews, community. This wave gives the Social
Loop its two missing pieces: a face (uploaded, scanned, owned) and friends
(mutuals, formed as a byproduct of planning a night together). Every package
serves one test: does this help a real person get out, meet people, and get
home safe? Trust is the product: honest prices, honest copy, no invented
anything - and no unscanned face wearing a "moderated" label.

## Panel verdict

- Builder: the machinery mostly exists. The OpenAI omni-moderation adapter
  (`lib/socialPostModeration.ts:13`), a complete image-upload chain
  (`lib/socialPostMedia.server.ts`, migration 0074), the EXIF stripper
  (`lib/imageSafety.ts`), and the mutual-follow friend primitive
  (`lib/followStore.ts:47`) all ship today. The wave is re-plumbing, not
  invention.
- Skeptic: three SEV1s, all accepted as scoped work. (1) The production
  graph is empty - 0 follow edges, 2 claimed accounts - so a mutual-only
  feed demos as an empty room without a friend-forming step (WP7). (2) The
  current avatar is a hotlinked URL, so any pre-publish scan of it is
  theatre; only owned bytes may be scanned and served (WP2). (3) The
  moderation pipeline lives behind the beta stack this wave must not
  enable; it is ported to the Supabase-identity stack (D1, WP1/WP2).
- Skeptic CUT list: every cut is an explicit anti-goal below. Skeptic ADD
  list: every add is scoped work (WP2 tombstone deletion, WP4 report/hide
  lane + outage alert, WP6 one friends definition, WP7 graph formation).

## The captain's decisions (law, no open questions)

Recorded 2026-08-08 evening. These are settled. Do not reopen them.

### D1 - Identity authority: Supabase accounts

One product identity: the existing email (magic-link) sign-in plus claimed
handle carries social. `private_social_accounts` is auto-provisioned from
the Supabase session; the Clerk path stays dormant. The moderation pipeline
is ported to serve the Supabase-identity stack; the Clerk+Yoti beta
machinery is not enabled. This closes both panel hold keys
(`social-launch-identity-authority`, `social-stack-choice`).

### D2 - Age assurance: recorded 18+ answer

Social requires an 18+ answer. An existing date of birth decides the answer;
when it is absent, one recorded self-assertion can answer it. The unwired Yoti
promise on `/terms` and `/privacy` is removed honestly in the same PR that
opens the gate. Yoti may return later as a stronger assurance tier.

### D3 - Friends definition: unify on mutuals

Everything friends-gated means mutual follows, unified BEFORE faces ship.
Pint-drop one-way-follower visibility is closed; strangers following an
account see nothing personal.

### Earlier same-day locked context

- Social launches friends-only for eligible signed-in users: a Supabase session,
  claimed handle, and 18+ answer are required. It is live by default;
  `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` is the explicit emergency rollback.
- Profile pictures: user-uploaded, public on profile.
- Moderation: OpenAI omni-moderation pre-publish scan on OWNED storage
  bytes (upload pipeline, never hotlinked URLs), fail-closed, plus a
  report/takedown lane.
- `OPENAI_API_KEY` reaches Vercel env (captain) when WP2 ships.

## Work packages

Builder sizing: S/M/L. Sequencing is in its own section below.

### WP1 - Open the gate: friends-only social for all signed-in users (L)

**Goal:** every signed-in Supabase account with a claimed handle and an 18+
answer reaches `verified` Social access; the whole surface returns to preview
only when `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`.

**Files to touch:**
- `lib/socialAccess.ts` - replace the beta+Yoti decision branch
  (`lib/socialAccess.ts:47-75`) with: flag off -> `preview`; no Supabase
  session -> `sign_in_required`; suspended -> `suspended`; no claimed
  handle or no adult answer -> the honest blocking state; else `verified`.
- `lib/socialAccessServer.ts` - fix the module-scope env read at
  `lib/socialAccessServer.ts:205-208` to a call-time read per the
  `lib/opsFreeze.ts:10-12` doctrine (pre-existing defect; fix it
  regardless); resolve the actor from the Supabase session; auto-provision
  `private_social_accounts` (new RPC or widened
  `migrate_social_product_account`, migration 0071).
- `app/api/social/access/route.ts`.
- `lib/trustedHandoffFlags.server.ts` + `lib/trustedHandoffFlags.ts` -
  register `PUBMAX_SOCIAL_FRIENDS_LAUNCH` with `ownerLane`,
  `removalCondition`, `offBehavior`.
- `app/page.tsx` + `components/landing/LandingPage.tsx`,
  `app/we-are-out/page.tsx` + `WeAreOutClient.tsx` - the honesty ternaries
  read the new flag.
- `app/terms/page.tsx` + `app/privacy/page.tsx` - replace the Yoti promise
  with the self-asserted 18+ posture (D2) in this same PR.
- SQL: new migration for the auto-provision RPC (SQL only; see deploy notes).

**New files:** the migration; `lib/socialLaunch.ts` only if the decision
logic outgrows `socialAccess.ts`.

**Tests:** extend `__tests__/socialAccessRoute.test.ts` (new states;
call-time env read now stubbable); retarget
`__tests__/landingSocialHonesty.test.ts` and
`__tests__/weAreOutSocialHonesty.test.ts` regexes to the new flag;
`__tests__/legalPages.test.ts` (age copy); new unit tests for
auto-provision.

**Demo gate:** with `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`, `/social` shows the
preview state and every CTA says Open Memories. With the live default, a fresh
Supabase sign-in + handle claim + 18+ answer lands in `verified` and sees the
friends-only feed; an under-18 answer is refused honestly; mutual-follow
visibility is spot-checked with two accounts.

### WP2 - Avatar upload pipeline (server) with inline pre-publish moderation (L)

**Goal:** a profile picture is owned bytes: uploaded, EXIF-stripped,
scanned BEFORE it is publicly addressable, stored under our bucket, and
deleted when the account dies.

**Files to touch:**
- `lib/profileStore.ts` - avatar object key + generation + moderation-state
  fields (beside the existing `cleanAvatar` seam at
  `lib/profileStore.ts:80-83`).
- `app/api/profiles/[handle]/route.ts` - public projection
  (`toPublicProfile`, the ONLY public-field allowlist) swaps `avatarUrl` to
  the served URL.
- `next.config.mjs` only if the route needs `maxDuration` headroom for the
  10s moderation budget.

**New files:**
- `lib/profileAvatarMedia.server.ts` - copy the `lib/socialPostMedia.server.ts`
  shape, but use the pint-drop Chain C ordering (`lib/pintDropsStore.ts:859-881`):
  `magicBytesOk` -> `stripImageMetadata` (GPS removal as an asserted
  invariant, not an encoder side effect) -> sharp `.rotate()` -> resize 512
  inside -> jpeg -> re-probe. Key `avatars/{profileId}/{generation}/image.jpg`
  with a CHECK-pinned prefix (precedent: migration 0074:27-28). UUID and
  generation keys only, never user-influenced filenames.
- `lib/profileAvatarModeration.ts` - thin reuse of the
  `OpenAISocialPostModerationAdapter` call shape, image-only input. Its
  verdicts are read through the advisory policy in
  `lib/uploadedImageScan.server.ts`.
- `app/api/profiles/[handle]/avatar/route.ts` - `export async function POST`
  multipart + `DELETE`; `gateHandleAction` ownership (Supabase JWT, same
  gate as the existing PATCH); `isLimited` per-actor with
  `failClosed: true` (each accepted upload spends an OpenAI call); every
  4xx/5xx via `publicApiError`. Inline scan order: normalise -> store to a
  private staging key -> sign a 180s URL -> call the adapter synchronously.
  Flagged -> refuse and delete the staging object. Approved -> promote to
  the serving key, state `approved`.
  SUPERSEDED 2026-08-10 (captain decision): scan outage or no decision no
  longer refuses. The scan is advisory (`lib/uploadedImageScan.server.ts`),
  a scanner we cannot reach lets the upload through as `approved` with one
  logged skip, and the report/hide moderator lane is the safety net.
- Migration: profiles avatar columns + storage key CHECK, SQL only.

**Tombstone deletion (skeptic ADD, in this package):** migration 0078
stamps `tombstoned_at` only; nothing deletes a stored face today. The
account-deletion path that sets the tombstone also deletes the avatar
storage objects (all generations) and nulls the avatar fields. A deleted
account's face may not persist in storage or cache. Test asserts object
deletion is invoked on tombstone.

**Tests:** new `__tests__/profileAvatarRoute.test.ts` (refusal on flagged,
advisory skip on outage, EXIF strip asserted via `lib/imageSafety` fixtures,
ownership, rate limit, tombstone deletion); new
`__tests__/profileAvatarModeration.test.ts` mirroring
`__tests__/socialPostModeration.test.ts` including the no-identifier
assertion; re-run `__tests__/profilesRoutePrivacy.test.ts` to confirm no
new substring leaks. The error-contract sweep enrols the route
automatically.

**Demo gate:** upload a normal photo - it appears on `/u/[handle]` after
one request. Upload a test-flagged image - instant honest refusal. Remove the
moderation keys - upload proceeds with one logged scan skip. EXIF GPS fixture -
stored object carries no GPS. Tombstone the account - storage object gone.

### WP3 - Serving + rendering: the avatar everywhere the handle shows (M-L)

**Goal:** the scanned avatar renders on the profile and the Social Loop
surfaces, with the initials fallback everywhere it is missing, hidden, or
unscanned. Blocked on WP2 and WP6 (no face renders before the friends
definition is unified).

**Files to touch:**
- `components/profile/ProfileHeader.tsx` - served URL + `onError` initials
  fallback (`components/profile/ProfileHeader.tsx:65-78` has none today).
- `components/profile/ProfileEditor.tsx` - replace the URL input
  (`components/profile/ProfileEditor.tsx:175-181`) with an upload/remove
  control.
- Feed DTOs `lib/feed.ts`, `lib/forYou.ts`, `lib/pintDropLookup.ts`,
  `lib/contributorLeaderboard.ts` - optional avatar field via one batch
  resolver (no N+1).
- Render sites: `components/feed/FeedCard.tsx` (drop, spill, check-in
  cards), `components/profile/OutTonightBoard.tsx`,
  `components/discovery/TonightBoard.tsx`,
  `components/feed/PresenceStrip.tsx`,
  `components/social/ConfirmFollow.tsx`,
  `components/pintdrop/CommentThread.tsx`,
  `app/social/SocialPageClient.tsx`, `app/p/[id]/page.tsx`,
  `components/contributors/ContributorRecord.tsx`, `lib/profiles.ts`.
- IdP-photo precedence: the uploaded avatar wins wherever
  `profiles.avatarUrl` renders; the nav keeps its separate IdP photo
  (`components/auth/SignInButton.tsx:222-231`), and IdP photos are never
  auto-copied into profiles (they were never scanned by our moderation).
- Existing stored remote-URL avatars: stop rendering them (initials
  fallback); do not migrate them.

**New files:**
- `app/api/avatar/[profileId]/[generation]/route.ts` - GET streaming from
  the private bucket; `Cache-Control: public, max-age=300, s-maxage=3600`;
  `immutable` only on generation-keyed paths so a moderator hide propagates
  within an hour; hidden or absent -> 404, client falls back to initials.
- `lib/avatarResolve.ts` - batch handle-to-served-URL map, one query.

**Explicit exclusions (assert in tests):** ledger redaction surfaces
(`lib/ledger.ts:173-192`), anonymous spills (`lib/spillPreview.ts:184`),
NightCrawlMode crew free-text names, and the anti-goal surfaces below
(public invite pages, night-story public surfaces, unlinked/legacy
handles).

**Tests:** new `__tests__/avatarServeRoute.test.ts` (hidden/absent -> 404,
cache headers); extend `__tests__/mobileChromeFit.test.ts` only if phone
row geometry changes; render tests for two representative sites; exclusion
tests for ledger, anonymous, and unlinked-handle surfaces.

**Demo gate:** avatar visible on profile, feed card, out-tonight board and
comment thread; anonymous spill and ledger page show no avatar; an unlinked
handle shows initials even with a legacy `avatar_url` stored; deleting the
avatar returns initials everywhere within one cache window.

### WP4 - Report/takedown + admin lane + operator alert + legal pages (M)

**Goal:** the load-bearing second half of moderation. Omni-moderation's
image coverage is six categories only (sexual, self-harm x3, violence x2);
it does not flag someone else's face, a non-sexual photo of a minor, a QR
or spam image, or a defamatory-but-clean photo. The report/hide lane is
therefore required, not decoration. Develops against the WP2 schema in the
same branch train.

**Files to touch:**
- `app/admin/AdminClient.tsx` - new avatar lane, two-lane reported/hidden
  shape (pattern: visit reports).
- `app/privacy/page.tsx` + `app/terms/page.tsx` - widen the OpenAI
  processor row (`app/privacy/page.tsx:600-609`) from social post content
  to profile pictures; add avatar retention/removal sentences.
- `lib/profileStore.ts` (or the avatar store) - report metadata +
  hide/restore stamps; hide never deletes.

**New files:**
- `app/api/profiles/[handle]/avatar/report/route.ts` (or an action on the
  avatar route) - server-derived reporter actor per
  `app/api/visit-reports/route.ts:67-69`; a flag queues, never auto-hides.
- `app/api/admin/profile-avatars/route.ts` - `isModerator`
  (`lib/adminAuth.ts:43-56`); GET reported/hidden lanes; POST hide/restore;
  hide flips serving to 404.

**Moderation-outage operator alert (skeptic ADD, in this package):** owned-image
scans are advisory, so a provider outage is recorded as a scan skip and the
report/hide lane remains the safety net. The Social-post queue can still strand
posts `pending` on outage. Add an operator lane: the freshness/notify pattern
(`lib/freshnessNotify.ts`) or a cron check that reports a growing `pending`
backlog and repeated moderation failures as their own named finding. An outage
must never read as "nothing to review".

**Tests:** new moderation-route test copying
`__tests__/communityPriceModeration.test.ts` shape (flag queues; only a
moderator hides; hide reversible; reporter identity never in the moderator
DTO); extend the `__tests__/legalPages.test.ts:135-145` block with
profile-picture assertions on both pages; alert-lane unit test (stranded
`pending` -> reported).

**Demo gate:** reader flags an avatar - nothing changes publicly. Moderator
hides - initials within a cache window, row survives with provenance.
Restore works from the hidden lane. Simulated moderation outage - operator
lane reports it.

### WP5 - Launch-state verification + demo dress rehearsal (S-M)

**Goal:** prove the explicit rollback is byte-identical to the safe preview and
rehearse the live captain demo end to end. Blocked on WP1-WP4, WP6, WP7.

**Files to touch:** `e2e/smoke.spec.ts` (preview-state assertion moves to
the new flag), `.env.example` (document `PUBMAX_SOCIAL_FRIENDS_LAUNCH` +
the `OPENAI_API_KEY` avatar note), `docs/SOFT_LAUNCH_RUNBOOK.md`
(launch-switch entry: flip = env change + redeploy;
`PUBMAX_SOCIAL_FREEZE` stays the independent ops brake).

**New files:** `e2e/profile-avatar.spec.ts` (upload -> render -> report ->
hide loop against the production build; keyless webServer env pattern from
`playwright.config.ts`); optionally `e2e/social-open.spec.ts` behind an env
opt-in.

**Tests:** the e2e specs are the deliverable; `npm run ci` with the live
default proves the launch path, and `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` proves
the rollback preview.

**Demo gate (the captain demo script):** rollback state equals the safe preview.
Live default = sign in, claim handle, answer the adult check, upload avatar,
join a plan crew and gain a mutual, friends-only post visible to the mutual
and invisible to a third account, with a flagged upload refused live.

### WP6 - One friends definition: unify on mutuals (D3) (M) - EARLY

**Goal:** D3 as code. Every friends-gated read means mutual follows, and
this closes BEFORE avatars render anywhere (WP3 is blocked on it). Today
pint drops use author + author's one-way followers
(`lib/pintDrops.ts:406-412` `qualifiesForFriends` checks
`viewer.followingHandles` only), while check-ins use mutuals
(`lib/socialFeed.ts:10-12`). A stranger who follows an account may read its
friends-only dated venue drops; attach a face and that becomes "which pub
this face is in tonight".

**Files to touch:** `lib/pintDrops.ts` (`qualifiesForFriends` requires
mutuality), `lib/feed.ts` / `lib/pintDropViewer.ts` (viewer context carries
the mutual set, not the one-way following set, for friends gating),
any friends-lane copy that described followers.

**New files:** none expected.

**Tests:** extend the pint-drop visibility tests: a one-way follower reads
nothing friends-only; a mutual reads it; author always reads their own.
Check-in tests unchanged (already mutual).

**Demo gate:** account A follows B; B does not follow back; A sees none of
B's friends-only drops. B follows back; A sees them.

### WP7 - Friend-graph formation: crews, search, invites (M-L)

**Goal:** answer the skeptic's first SEV1. Production has 0 follow edges
and 2 claimed accounts; a mutual-only feed without a friend-forming step
demos as an empty room. The minimum viable loop is the one the repo already
has: plans and invite links. The friend graph is a byproduct of planning a
night together, not a vanity prerequisite.

**Scope:**
1. **Mutual edges from plan-crew join.** When a signed-in, handle-claimed
   account joins a plan crew, create the mutual follow edges between the
   joiner and the host (and offer, not force, edges to other members).
   Consent stays visible: the join surface says plainly that joining
   connects you with the host. Uses the existing crew membership seams
   (migration 0075 `social_relationship_between_profiles`, blocked-first)
   and the public invite fix (#939, migration 0081).
2. **Handle search.** A minimal find-a-friend surface: search claimed
   handles, open `/u/[handle]`, follow from there. Today the only follow
   affordance is the profile page itself with no way to find it.
3. **Invite links.** Surface the existing invite-link path in the social
   shell so a user can pull a friend in with one link.

**Files to touch:** crew join path (`lib/socialCrewHttp.ts` and the crew
routes), `lib/followStore.ts` (edge creation honouring blocks),
`app/social/SocialPageClient.tsx` (search + invite entry points),
`app/invite/[token]/page.tsx` consent copy. New search route obeys
`isLimited` + `publicApiError`.

**New files:** search API route + component as needed.

**Tests:** crew-join creates the mutual pair exactly once, never across a
block, never for unclaimed handles; search returns claimed handles only;
rate-limited; error contract sweep passes.

**Demo gate:** a fresh account joins a plan crew via an invite link and
immediately shares a mutual with the host; the friends feed is no longer
empty; search finds a handle and follow works from it.

## Anti-goals (law, from the skeptic's CUT list + standing contracts)

- **Avatar-by-URL is retired.** The paste-a-URL input goes away in WP3; the
  API stops accepting remote URLs; stored remote URLs stop rendering
  (initials fallback), and none are migrated. A hotlinked avatar is a
  TOCTOU hole, an IP/referer leak to an attacker-chosen host, and is
  CSP-broken for almost every host today (`proxy.ts:210`).
- **No avatars on unlinked or legacy handles.** 21 of 23 production
  profiles are unlinked and accept anonymous demo edits
  (`lib/profileOwnership.ts:12-14`). A face on an unclaimed handle is an
  impersonation vector. Only a claimed, owned profile may wear an uploaded
  avatar.
- **No avatars on public invite pages or night-story public surfaces this
  wave.** The public plan invite page prints host handle, route stops and
  start time to any link holder (`app/invite/[token]/page.tsx`, migration
  0081); adding a face turns that into face + route + start time. Night
  stories' `public` tier likewise stays face-free.
- **Legacy Social access is retired.** The former provider-specific beta is not
  a supported configuration value or access path. The launch switch is live by
  default, and `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` is the captain-controlled
  emergency rollback.
- Standing honest-path anti-goals (root `CLAUDE.md`) apply unchanged: no
  growth engine, no referral feature grants ever, no payments theatre, no AI
  that fabricates.

## Guardrails (law, verbatim into every package)

1. **Privacy/egress:** Strip EXIF (including GPS) with `lib/imageSafety.ts`
   BEFORE bytes reach storage, and send OpenAI only a short-lived signed
   image URL - never the handle, profile id, account id, or any user text
   alongside it (`__tests__/socialPostModeration.test.ts:53-54` is the
   fence to copy).
2. **Moderation fail-closed:** posts only. A post the moderation call
   cannot decide stays unpublished (`lib/socialPostModeration.ts:19-22,67-74`).
   OWNED IMAGES took the opposite decision on 2026-08-10: an avatar, cover
   or wall photo whose scan is unconfigured, times out, errors, or returns
   no usable decision is stored and served, because a broken provider had
   blocked every upload on the site. A real negative verdict still refuses.
   See `lib/uploadedImageScan.server.ts` and the AGENTS.md bullet.
3. **Honest copy and honest fallbacks:** During the explicit rollback, no
   surface may say "Open Social" (the `__tests__/*SocialHonesty.test.ts`
   fences must keep passing), and a missing, hidden, or unscanned avatar
   always renders the initials fallback - never a broken image, never a
   placeholder that implies the user chose it.
4. **Age gate:** Social requires a signed-in account, claimed handle, and 18+
   answer. An existing date of birth decides when present; otherwise one
   recorded self-assertion can answer the question. The legal pages describe
   this current policy and do not promise a hosted Yoti check.

## Sequencing

**Cursor can start today (no decision or package blocks them):**
- WP2 - avatar upload pipeline + inline moderation + tombstone deletion.
  Works keyless with advisory scan skips; a real negative verdict still refuses.
- WP4 - report/takedown lane + operator alert + legal pages (develops
  against the WP2 schema in the same branch train).
- WP6 - unify friends on mutuals (independent; must land before WP3).

**Lands after:**
- WP1 - the gate (decisions D1/D2 are settled; it is large and touches the
  legal pages, so it follows the WP2/WP4 start).
- WP3 - rendering (blocked on WP2 and WP6).
- WP7 - friend-graph formation (after WP1's identity plumbing; before the
  demo, or the room is empty).
- WP5 - e2e + dress rehearsal (last; blocked on everything).

## Deploy notes

- **Migrations ship as SQL only.** Agents and Cursor commit migration files;
  firstmate applies them. Never run a migration against production from a
  work branch.
- **`OPENAI_API_KEY`:** already listed in `.env.example`; the captain adds
  it to Vercel env for Social post moderation. Owned-image uploads remain
  available without a scanner, with one logged scan skip; a real negative
  verdict still refuses.
- **`PUBMAX_SOCIAL_FRIENDS_LAUNCH`:** the launch switch, registered in
  `lib/trustedHandoffFlags.server.ts` with `ownerLane`, `removalCondition`
  and `offBehavior`. Unset, empty, `1`, or `true` keeps Social live; `0`
  returns it to preview. `PUBMAX_SOCIAL_FREEZE` remains the separate ops
  brake and is not a launch control.
