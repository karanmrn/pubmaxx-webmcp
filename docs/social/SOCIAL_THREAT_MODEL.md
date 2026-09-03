# Historical Social threat model

Status: Retired pre-implementation security model for the Clerk and Yoti
Verified Social Night Loop. It is retained as historical context. The shipped
Social access path uses Supabase identity and the adult-answer policy in
`lib/socialAccessServer.ts` and `lib/socialLaunch.ts`; rollout policy lives in
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md).

This model identifies what Social must protect, where trust changes, and which controls must be proved before invite-beta rollout. Cross-product policy lives in [SOCIAL_BETA_CONTRACT.md](./SOCIAL_BETA_CONTRACT.md). Route and type details belong in implementation tasks and tests.

## Security objectives

Social must:

- keep full content inside verified-adult and per-object visibility boundaries;
- prevent identity, age, friendship, ownership, and consent claims from being supplied by the client;
- keep exact venue, movement, imported-place, direct-message, and safe-home context out of public surfaces;
- let people report harm without granting them a one-tap eraser;
- hold unchecked content when moderation dependencies fail;
- preserve enough case evidence for accountable moderation while honouring export and erasure;
- avoid presenting AI, contextual data, or safety tools as people or emergency monitoring;
- keep analytics consented, low-cardinality, and detached from content or precise location.

Availability matters, but confidentiality and consent win. A failed protected dependency may reduce Social to safe metadata preview. It must not open content or allow writes.

## Assets

Highest-risk assets are:

- stable product account ownership and the mapping between Clerk and legacy Supabase sessions;
- Yoti subject references, decisions, verified-at values, expiry, and audit state;
- post text, comments, photos, tag proposals, visibility, edit history, and moderation state;
- mutual-friend edges, blocks, crew membership, invitations, and roles;
- exact venue context, check-ins, live crawl state, direct messages, safe-home state, and crawl chat;
- private saves, unmatched imported places, local drafts, and Night Story consent;
- media originals, derived files, ownership records, moderation results, and signed-delivery grants;
- report contents, moderator actions, legal holds, and escalation records;
- notification endpoints and lock-screen payloads;
- consent state, Social analytics identifiers, allowlisted events, and service error measurements.

Public area and safe route-level preview copy are lower sensitivity, not no sensitivity. Repeated area events can still reveal movement patterns and need aggregation and rate limits.

## Actors and trust boundaries

Actors include logged-out visitors, signed-in but unverified people, verified adults, suspended accounts, mutual friends, post and crew owners, tagged people, moderators, the moderation backup, service operators, and attackers controlling a browser or account.

External processors include Clerk, Yoti, Supabase, OpenAI moderation, private media storage and delivery, web push providers, and the chosen Google import path. Their responses cross a server boundary and must be authenticated, validated, minimised, and mockable. Provider success never replaces PUBMAX ownership or visibility checks.

Main trust boundaries are:

1. Browser to Next.js routes and server actions.
2. Clerk session to stable PUBMAX product ownership.
3. Yoti callback to stored verified-adult state.
4. Server policy to Supabase service-role writes and browser-readable data.
5. Social stores to feeds, direct links, notifications, exports, moderation, and analytics.
6. Media upload to private storage, moderation, consent, and signed delivery.
7. Crew planning to live location, safe-home, direct messages, and expiring chat.
8. Import providers to unmatched private places and deliberate user sharing.
9. Moderator tools to reports, holds, suspension, hide, restore, and erasure exceptions.

RLS is a second line of defence. Server policy and stable product ownership remain the write path. Browser roles receive no secret, verification, private-save, direct-message, safe-home, or moderator capability fields.

## Abuse cases and required controls

### Session and account confusion

Threats include treating a Clerk session as a legacy account, binding verification to a handle, replaying migration, stealing a frozen handle, session fixation, and continuing access after suspension or expiry.

Controls:

- Resolve Clerk, stable product ownership, verified-adult state, suspension, and friendship on the server for every protected request.
- Require proof of both Clerk and legacy Supabase sessions for migration.
- Make migration retries idempotent and auditable.
- Keep every unowned handle frozen against account ownership and forbid
  first-touch claims.
- Bind Yoti state to stable ownership, not handle or client identifier.
- Re-check verification expiry and suspension on direct reads, writes, media grants, notifications, exports, and long-lived crawl connections.

Proof must include confused-session, replay, handle-rename, expired-verification, suspended-account, and stale-grant tests.

### Age-verification forgery and overcollection

Threats include forged callbacks, replayed decisions, account swapping after verification, leaked subject references, public age badges, and keeping identity material without need.

Controls:

- Verify callback authenticity, intended environment, subject binding, freshness, and replay identifier on the server.
- Store only subject reference, provider, decision, verified-at, expiry, and audit state.
- Never accept date of birth, age result, or verification status from product clients.
- Keep verification fields out of public profiles, posts, analytics, logs, notifications, and browser-readable database grants.
- Revoke protected access when the decision expires or ownership changes.

### Visibility bypass and enumeration

Threats include insecure direct object references, cursor manipulation, cache mixing, search-index leakage, media URL reuse, friend removal races, quote-post leakage, notification previews, export overreach, and using aggregate counts to discover protected activity.

Controls:

- Apply visibility after loading current ownership, mutual friendship, blocks, suspension, and moderation state on every read path.
- Scope cursors to viewer and lane. Sign or validate cursor state and bound page sizes.
- Mark protected responses private and prevent shared-cache reuse.
- Issue short-lived, viewer-authorised media grants. Visibility reductions revoke future grants.
- Re-check the source object before rendering reposts, quote posts, notifications, and signed media.
- Return indistinguishable not-found results for protected objects where existence itself is sensitive.
- Keep safe preview free of stable protected object identifiers and sensitive counts.

Proof must cover direct links, each feed lane, search, notification, repost, quote, media, export, block, unfriend, delete, hide, and cache boundaries.

### Location and movement disclosure

Threats include publishing exact venues on public posts, reconstructing a crawl from area events, exposing live check-ins, leaking unmatched imports, or treating safe-home state as ordinary Social content.

Controls:

- Allow public area only. Exact venue context is friends-only.
- Keep check-ins, live crawl state, safe-home data, and unmatched imports out of public posts, previews, analytics, and notification payloads.
- Require mutual friendship and current membership for crawl joins, invitations, direct messages, and exact venue sharing.
- Rate-limit and coarsen area queries so repeated requests do not expose one person's movement.
- Make safe-home sharing explicit, scoped, revocable, and time-bounded by its domain.
- Never claim emergency-service monitoring or objective safety.

### Media, tags, and consent

Threats include malicious files, oversized uploads, metadata location leakage, unauthorised reuse, public tags without consent, withdrawn consent remaining in derivatives, non-consensual intimate media, and signed URLs surviving deletion.

Controls:

- Validate file type from bytes, size, dimensions, ownership, and moderation state before use.
- Store originals privately, strip unsafe metadata from published derivatives, and deliver through short-lived grants.
- Keep tag proposals private until the named product owner approves.
- Removing approval removes the identity link from every derivative surface.
- Hold media from publication while moderation is unavailable or unresolved.
- Revoke delivery and queue durable deletion when content or account is erased.
- Escalate non-consensual intimate media and child-safety reports immediately.

### Harassment, spam, and moderation abuse

Threats include targeted harassment, doxxing, hate, threats, spam, brigading, report flooding, evasion through edits or media, and reporters hiding lawful content through volume.

Controls:

- Use rate limits by stable actor and action, with stricter limits for new or recently verified accounts.
- Run OpenAI omni moderation after submission and hold content until a decision succeeds.
- Re-moderate changed text, media, and quoted context. Keep immutable edit and moderation audit metadata.
- Queue reports without automatic hiding. Only authorised moderators hide, restore, suspend, or resolve.
- Deduplicate report actions without discarding independent evidence.
- Provide block and comment-lock controls without creating popularity ranking.
- Keep primary and backup queue coverage capable of resolving reports within 24 hours.

P1 risk bypasses the normal queue order. Rate limiting must not stop a person reporting an immediate threat.

### Crew, chat, and safe-home misuse

Threats include unwanted crawl joins, role escalation, stalking through live venue state, abusive direct messages, chat surviving its promise, coercive safe-home requests, and false belief that PUBMAX is watching an emergency.

Controls:

- Friend-gate joins, invitations, direct messages, exact venue sharing, and crawl chat.
- Authorise every crew action against stable membership and closed role permissions.
- Expire crawl chat content and attachments after 30 days, including reader and moderator indexes unless a specific legal hold exists.
- Separate safe-home state from posts, chat, notifications, and AI planning.
- Require explicit consent for each safe-home share and escalation. Make revocation visible and immediate.
- Use direct wording that PUBMAX does not monitor emergencies or contact emergency services.

### AI impersonation and unsafe automation

Threats include AI appearing as a friend, author, crew member, or moderator, generated venue claims lacking grounding, composition assistance publishing without approval, and unsafe crawl suggestions framed as fact.

Controls:

- AI may assist composition and planning but never appears as a participant.
- Generated drafts require the person's explicit review and submission.
- Weather and event context shows source and freshness and never appears as a post from AI.
- Planning cannot bypass venue truth, age, friendship, consent, or safety policy.
- Provider failure leaves drafts recoverable and protected writes closed.

### Import and OAuth abuse

Threats include excessive OAuth scopes, forged import callbacks, server-side request forgery through URLs, accidental public matching, duplicate retries, and imports surviving erasure.

Controls:

- Use explicit user export or the minimum OAuth scope needed for Google Maps saved places.
- Validate callback state and account binding. Keep provider credentials server-side and encrypted.
- Do not fetch arbitrary user-supplied URLs.
- Make import retries idempotent.
- Keep unmatched places private until the owner deliberately links or shares them.
- Include imported data and provider connection metadata in export. Never export access tokens, refresh tokens, or other provider credentials. Erasure must revoke upstream grants and delete locally held provider credentials.

### Deletion, evidence, and backup conflicts

Threats include soft-deleted content remaining public, media grants remaining live, exports omitting derived records, moderation logs becoming a shadow profile, legal holds being broad or permanent, and restored backups resurrecting erased Social data.

Controls:

- Remove erased content from public, friend, search, notification, and media surfaces immediately.
- Revoke delivery grants and schedule durable deletion across all Social stores and processors.
- Export posts, interactions, crews, media metadata, notifications, verification references, imports, and analytics identifiers in a usable form.
- Restrict legal holds to a recorded case, authorised staff, minimum fields, and a reviewable end condition.
- Define live-store, backup, provider, and hold deletion windows before rollout and publish matching `/privacy` and `/terms` wording when code changes the practice.
- Test restore and retry paths so deletion remains idempotent and erased data does not return to product reads.

### Analytics and notification leakage

Threats include events before consent, raw coordinates, handles or free text in properties, high-cardinality identifiers reconstructing activity, notification content on a lock screen, and product metrics feeding popularity ranking.

Controls:

- Emit Social events only after analytics consent through a closed registry.
- Drop unknown properties before transmission.
- Exclude raw viewer coordinates, precise location, handles, content, hashtags, media, imports, verification references, and direct-message data.
- Keep push opt-in. Use generic lock-screen copy for protected activity and fetch authorised detail after open.
- Delete Social analytics identifiers through account erasure.
- Keep measurement separate from feed ordering and reach.

### Operator, dependency, and availability risk

Threats include compromised service-role keys, moderator credential theft, unreviewed queue access, processor outage, callback forgery, dependency compromise, denial of service, and logs containing protected content.

Controls:

- Keep secrets server-only, scoped by environment, rotated, and absent from keyless local use.
- Require named moderator access, least privilege, auditable actions, and immediate revocation.
- Validate processor callbacks and responses. Use bounded timeouts, idempotency keys, and replay protection.
- Fail protected actions closed and keep providers mockable for deterministic tests.
- Rate-limit expensive reads, writes, media, verification starts, reports, and imports.
- Log stable internal case identifiers and outcomes, not Social content, verification references, or raw locations.
- Run dependency audit, migration forward and rollback proof, accessibility checks, focused browser suites, `npm run verify`, and `npm run ci` before rollout.

## Release threat gates

Task 9 cannot enable invite-beta flags until each gate has evidence:

| Gate                            | Required evidence                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity and adult verification | Confused-session, migration replay, expiry, suspension, forged callback, and handle-freeze tests                         |
| Visibility                      | Cross-viewer route, feed, media, cache, notification, repost, quote, search, and export tests                            |
| Moderation                      | Held-on-outage proof, edit recheck, report dedupe, hide and restore audit, P1 escalation drill, named primary and backup |
| Consent                         | Photo-tag approval and withdrawal, Night Story contributor approval, safe-home grant and revocation                      |
| Retention and erasure           | 30-day crawl-chat expiry, complete export, complete erasure, media revocation, restore and retry proof                   |
| Analytics                       | Consent-off silence, property allowlist rejection, no raw coordinates, deletion of identifiers                           |
| Mobile and accessibility        | 320px, 390px, and 430px layouts, no horizontal overflow, keyboard, screen reader, reduced motion                         |
| Operational quality             | `npm run verify`, `npm run ci`, focused Playwright, migration forward and rollback proof, no P1 defects                  |

Beta expansion stops when confidentiality, age, consent, moderation coverage, or erasure controls fail. Safe metadata preview may continue only after direct verification that it exposes no protected content.
