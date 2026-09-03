# Historical Social invite-beta contract

Status: Retired pre-implementation policy. This document is historical context
for the Clerk and Yoti invite-beta design and does not describe the shipped
Social access path. Current launch, rollback, and deployment policy lives in
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md). Current route
authority lives in `lib/socialAccessServer.ts` and its tests.

> Historical only. Do not use this document for implementation or rollout
> decisions. Requirements below are retained as design history; the current
> authorities are the runbook and `lib/socialAccessServer.ts`.

This contract owns policy decisions that cross Social routes and domains. Implementation details belong in their task code and tests. The threat analysis lives in [SOCIAL_THREAT_MODEL.md](./SOCIAL_THREAT_MODEL.md).

## Product boundary

`/social` must be the canonical responsive Social shell. `/feed` and `/stories` must redirect to `/social`. `/discover` and `/drinks` must redirect to `/social?tab=discover`. Redirects must preserve no legacy access shortcut.

Social must ship as an invite beta for verified adults. It must not replace the price map, Pint Drops, Visit Reports, Night Memories, venue observations, or existing account ownership. Social posts may refer to those domains, but they must not become ratings and their engagement must not alter venue or price authority.

Feeds must be chronological. Paid reach, trends, popularity ranking, and venue ratings must remain outside the beta.

## Access and identity

One server policy seam must decide protected Social access. Every protected API and server-rendered read must use it. Client state may explain an access decision but must not grant access.

The access states are:

| State                       | Reader outcome                                  | Write outcome                                                       |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `preview`                   | Safe metadata preview only                      | Denied                                                              |
| `sign_in_required`          | Safe metadata preview plus sign-in boundary     | Denied                                                              |
| `age_verification_required` | Safe metadata preview plus adult-check boundary | Denied                                                              |
| `verified`                  | Content allowed by per-object visibility        | Allowed by ownership, friendship, moderation, and rate-limit policy |
| `suspended`                 | Safe metadata preview only                      | Denied                                                              |

Full Social content must require both a Clerk product session and verified 18+ state bound to stable product account ownership. A Clerk session must not be treated as a legacy Supabase account. Migration must require proof of both sessions, be idempotent, and produce an audit record. A client-supplied handle must never prove ownership.

Legacy unverified handles must stay frozen. First-touch ownership claims are forbidden. Pseudonyms are allowed. Public profiles, posts, previews, analytics, notifications, and media metadata must expose neither date of birth nor an age badge.

Adult verification must store Yoti subject reference, provider, decision, verified-at, expiry, and audit state on the server. Raw identity documents and public age data must not enter PUBMAX Social.

External identity or age service failure must leave protected actions closed. Keyless local tests must use explicit mocks and must never weaken production policy.

## Preview and visibility

Safe preview metadata must be the minimum needed to explain that Social exists and why content is unavailable. It may include route-level beta copy and aggregate availability derived by the server. It must exclude post text, photos, handles, comments, reactions, hashtags, venue context, crew membership, direct messages, check-ins, safe-home state, verification state, and stable object identifiers that would enable enumeration.

Post visibility must be decided on every read path, including feeds, direct links, search, notifications, reposts, quote posts, media delivery, caches, exports, and moderation views.

| Visibility | Who may read full post content                                          | Location rule                                                                                           |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `public`   | Any verified adult who is not suspended or blocked by moderation policy | Public area allowed. Exact venue context withheld unless viewer is a friend authorised for that context |
| `friends`  | Author and mutual friends                                               | Public area and friends-only venue context allowed                                                      |
| `private`  | Author only, plus authorised moderators for a recorded case             | Imported unmatched places and private context stay private                                              |

Friendship must mean mutual follow state. One-way following must not satisfy a friend gate. Saves must remain private. Photo tags must stay unpublished until the tagged person approves. Removing approval must remove the public identity link without rewriting photo provenance.

Reposts, quote posts, notifications, and signed media URLs must never widen source visibility. A visibility reduction must take effect across all derived surfaces. Product copy must not imply that PUBMAX can stop recipients taking screenshots or sharing information outside the service.

## Posts and interactions

Posts must support `standard` and `feature_request`. Authors must choose `public`, `friends`, or `private` per post and choose a comment policy. Authors may lock comments later. Edits must carry an edited marker and immutable audit metadata.

Cheers, comments, saves, reposts, and quote posts must use idempotent writes and bounded pagination. Engagement may support the direct interaction, but it must never buy reach or create a popularity feed. Feature requests must have staff status and response history without becoming a popularity vote.

OpenAI omni moderation must run after submission. Until an external moderation decision succeeds, publishable content must remain held in a queued state. A provider failure must not publish unchecked content. Local tests must replace the provider with deterministic outcomes.

## Crew and complete-night safety

Crawl joins, invitations, direct messages, and exact venue sharing must be friend-gated. Crew roles must never bypass per-post, media, or verification policy.

Crawl chat must expire after 30 days. Expiry must remove message content and attachments from reader and moderator surfaces, subject only to a narrower legal hold recorded against a specific case. Expired chat must not become an analytics or activity archive.

Safe-home sharing and escalation must be explicit, revocable, and consent-based. PUBMAX must not imply that it monitors emergencies or contacts emergency services. Weather and event cards must show source and freshness and must never appear as posts from AI. AI may assist composition and planning but must never appear as a participant, friend, crew member, author, or moderator.

Night Stories must remain drafts until every required contributor and photo-tag consent check passes. Imported Google Maps places must arrive through explicit export or OAuth consent. Unmatched places must stay private until the owner deliberately links or shares them.

## Moderation operations

Social must reuse existing moderation queues where their contracts match. Reports must queue content for review. A report must not silently delete or hide another person's content. Only an authorised moderator may hide, restore, or resolve it, and every action must keep an audit trail.

Primary and backup moderation ownership must be a launch control, not a documentation placeholder:

| Duty              | Named owner | Launch state |
| ----------------- | ----------- | ------------ |
| Primary moderator | Unassigned  | Blocking     |
| Backup moderator  | Unassigned  | Blocking     |

Both people must accept access to the queue, the escalation route, and the duty to resolve reports within 24 hours before any invite-beta flag is enabled. Task 9 records their names and proof of an exercised handover. Until then, every Social invite-beta flag remains off outside deterministic test environments.

P1 risk, credible threats of harm, child-safety concerns, non-consensual intimate media, doxxing, and compromised moderator credentials must use an immediate escalation path. The operational runbook must name the path before rollout. Product code must support suspending accounts and holding content without destroying the evidence needed for a specific case.

## Retention, deletion, and export

Retention must follow purpose limitation:

- Crawl chat content and attachments must expire after 30 days.
- Posts, interactions, crews, media, notifications, and verification references must exist only while needed for the feature, moderation, or a recorded legal hold.
- Local drafts must stay on the user's device unless the user submits them.
- Unmatched imported places must remain private and deletable. They must never acquire public status through an import retry or background match.
- Analytics must exclude raw viewer coordinates, handles, free text, direct-message content, verification references, and imported-place content.

Task 8 must deliver account export and complete erasure across Social posts, interactions, crews, media, notifications, verification references, imported places, provider connection metadata, and analytics identifiers. Export must never contain access tokens, refresh tokens, or other provider credentials. Erasure must remove public and friend-visible content immediately, revoke signed media delivery and upstream provider grants, delete locally held provider credentials, and schedule durable data deletion. Any legally required exception must be minimal, case-specific, access-controlled, and excluded from product reads.

Exact deletion windows for live stores, backups, provider records, and moderation holds must be agreed, implemented, and reflected in `/privacy` and `/terms` before beta rollout. This documentation task changes no data practice, so it does not edit those pages.

## Analytics contract

Social funnel events must fire only after analytics consent. The shared analytics registry must own a closed event and property allowlist. Unknown properties must be dropped before transmission.

Properties must be low-cardinality and must exclude raw viewer coordinates, precise location, handles, post or message text, hashtags, media contents, imported places, direct identifiers, and companion names. Area-level measurement may be used only where it cannot expose exact venue or movement history. Product metrics must never become reach ranking.

Task 9 must prove the consent boundary, allowlist, deletion path, and error-rate measurement in browser and route tests before rollout.

## Rollout and beta exit

New Social surfaces must use progressive invite-beta flags. Identity, age, visibility, moderation, consent, deletion, and analytics controls must be server-enforced and must not be bypassed by a client flag.

The beta flag must stay off until:

- Tasks 2 through 8 and their safety dependencies are complete.
- Moderation primary and backup are named, have working queue access, and have exercised the handover.
- Account export and complete erasure are proven.
- Signed-out preview, unverified adult boundary, verified posting, visibility, moderation, crew join, safe-home, deletion, and mobile layouts pass browser tests.
- Migration forward and rollback proof, accessibility checks, `npm run verify`, and `npm run ci` pass.

PUBMAX must exit beta only after 25 verified adults, 10 completed loops, two stable weeks, report handling within 24 hours, no P1 defects, and Social API error rate below 1%.

If any exit condition regresses, PUBMAX must stop expansion. P1 defects, broken visibility, broken age enforcement, unavailable moderation coverage, or failed erasure must disable protected Social reads and writes until the control is restored. Safe metadata preview may remain only when it does not disclose protected content.
