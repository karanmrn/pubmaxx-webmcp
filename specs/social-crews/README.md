# Social Crew specification

Status: Historical slice handoff. The implementation now runs Social live by
default; `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` is the emergency rollback. Last
updated: 5 August 2026.

## Next Agent Prompt

Implement [Slice 2](slices/02-projection.md) from `12c451ccd`. Keep the authority
contracts from Slice 1 closed and use its reviewed store and routes rather than
adding a parallel read path. Start with projection RED tests. Do not edit Task 6
post, composer, media, tag, or moderation files. Do not apply migration 0075 to
a hosted database. Before ending, update this section with the last commit,
verification evidence, open findings, and the exact next pickup point.

- [x] Slice 1: authority foundation
- [ ] Slice 2: projected reads
- [ ] Slice 3: focused Plan collaboration
- [ ] Slice 4: live loop
- [ ] Slice 5: Crew Chat retention
- [ ] Slice 6: Safe Home
- [ ] Slice 7: weather and events context
- [ ] Slice 8: mobile closeout

Active warning: migration 0075 follows 0074. Captain applies it only after all
eight slices pass final review. Use current migration and rollout state from
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../../docs/SOFT_LAUNCH_RUNBOOK.md).

[Slice 1 handoff and verification evidence](../../.superpowers/sdd/2026-08-05-verified-social-night-loop/task-7-slice-1-report.md).

## Goal

Build London Social Crew Pages that connect one existing Planned Night to
verified Pubmaxxers for planning, live coordination, expiring chat, and explicit
Safe Home consent.

## Authority

Crew membership never creates or preserves friendship. Every protected read or
write resolves these facts again:

1. Verified Social actor and active PUBMAXX User ID.
2. Active Social Crew membership owned by that account ID.
3. Current reciprocal follows between stable profile IDs.
4. No block in either direction.
5. Operation-specific role, revision, and consent.

Owner is self-authorised. Other members need current friendship with owner for
the full Crew Page. Exact Venue projection also needs current friendship between
viewer and the member who shared it.

Account IDs, Clerk IDs, Plan capabilities, token hashes, and private legal-hold
IDs never enter browser DTOs. Handles are display values only.

The Planned Night remains the single owner of title, start time, Night Area,
status, route revision, Stops, and Plan state. Crew phase is derived from Plan
status: `draft | ready` is `planning`, `active | ending` is `live`, and
`completed | abandoned` is `ended`. Crew storage owns visibility and an
`authorityRevision` used only for membership and visibility conflicts. A Plan
without a Night Area remains valid and projects `nightArea: null`.

## Single owners

- `lib/socialRelationships.server.ts`: reciprocal follows and blocks.
- `lib/socialCrew.ts`: vocabulary, validation, transitions, permissions, DTOs.
- `lib/socialCrewStore.ts`: Crew authority and durable RPC adapter.
- `lib/socialCrewProjection.server.ts`: raw-row to safe DTO projection.
- `lib/socialCrewCollaborationStore.ts`: verified Plan proposal and vote wrappers.
- `lib/socialCrewLiveStore.ts`: live actions, Check-ins, and Venue shares.
- `lib/socialCrewChatStore.ts`: chat, reports, expiry, purge, and hold isolation.
- `lib/socialSafeHomeStore.ts`: grant, status, revoke, home, escalation.
- `lib/socialCrewContext.server.ts`: weather and events context.
- `lib/socialCrewRealtime.ts`: invalidation signals followed by API refetch.
- Migration 0075 and rollback: one sequential SQL owner. No parallel SQL edits.

No protected Crew write uses an in-memory fallback. Missing Production Store
dependencies return `503` and keep local product navigation usable.

## Core types

```ts
export type SocialCrewRole = "owner" | "cohost" | "member";
export type SocialCrewVisibility = "private" | "friends" | "open";
export type SocialCrewPhase = "planning" | "live" | "ended";

export type SocialCrewMemberDTO = {
  memberId: string;
  handle: string;
  role: SocialCrewRole;
  joinedAt: string;
};

export type SocialCrewPlanDTO = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  context: NightContext | null;
  actions: PlanActionDTO[];
  ending: CrawlEnding | null;
};

export type SocialCrewPreviewDTO = {
  kind: "preview";
  title: string;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  joinRequestState: "none" | "pending" | "declined";
  hostHandle?: string;
  stopVenueId?: string | null;
  stopVenueName?: string | null;
  memberCount?: number;
};

export type SocialCrewPageDTO = {
  kind: "member";
  crewId: string;
  title: string;
  visibility: SocialCrewVisibility;
  phase: SocialCrewPhase;
  nightArea: string | null;
  startsAt: string;
  authorityRevision: number;
  viewer: { memberId: string; role: SocialCrewRole };
  owner: { memberId: string; handle: string };
  members: SocialCrewMemberDTO[];
  plan: SocialCrewPlanDTO;
};

export type SocialCrewReadDTO = SocialCrewPreviewDTO | SocialCrewPageDTO;

export type SocialCrewListItemDTO = Pick<
  SocialCrewPageDTO,
  "kind" | "crewId" | "title" | "phase" | "nightArea" | "startsAt" | "viewer"
>;

export type SocialCrewListPageDTO = {
  items: SocialCrewListItemDTO[];
  nextCursor: string | null;
};
```

Preview contains no Crew ID, Plan ID, full route, exact Venue, member identity,
chat, Check-in, Safe Home, or protected identifier. Private Crew denial and
unknown Crew both return `404`. Dependency failure returns `503`,
never a fake empty response.

Full Crew projection omits legacy `PlanState.crew`. Social members come only
from `SocialCrewMemberDTO`; old Plan guests are not projected as Social Crew
members and their legacy Plan member IDs never enter the browser DTO.

Crew collection is active-member-only and uses `SocialCrewListItemDTO`. Friend
or open previews stay detail-only because they contain no Crew identifier. Open
previews include host handle, start Venue/Place name, and member count.
The list never returns full Plan, Stops, actions, members, or Join Request
state.

## Slice graph

```text
1 Authority -> 2 Projection -> 3 Plan -> 4 Live
                          \-> 5 Chat
                          \-> 6 Safe Home
2 Projection ----------------> 7 Context -> 8 Mobile closeout
```

Slices 3 to 6 may be implemented independently only after Slice 2 contracts
land. Migration 0075 remains unshipped and may grow sequentially with each
slice. Rollback and catalog proof change in the same commit as each SQL change.

## Firewalls

- Do not use legacy bearer Plan invites, anonymous Plan join, token-only Crew
  membership, handle Check-ins, legacy handle DMs, `SafeNightStrip`, or
  analytics `/api/events` as Crew authority.
- Crew creation may verify the existing host capability once. It then binds
  the owner account and host Plan member, revokes pending legacy invites,
  rotates every legacy member capability to an unreachable random hash, and
  makes Social APIs the only access path. Creation accepts the host capability
  in the `Authorization` header and never stores or returns it.
- A Crew-bound Plan is absent from every legacy Plan read and write seam.
  Central legacy Plan lookup returns `not_found`; a separate server-only Crew
  lookup reads the bound Plan after current Social authority succeeds. Plan
  join, invite redemption, member upgrade, collaboration, action, recap, and
  completion RPCs also reject a bound Plan.
- Realtime carries invalidation only. Client refetches authoritative DTOs.
- Exact Venue never enters preview HTML, metadata, notifications, push or lock
  screen copy, analytics, logs, or error text.
- AI is not a Crew member, author, voter, weather publisher, or event publisher.
- No raw viewer coordinates are stored.
- Safe Home never claims journey monitoring or emergency-service contact.
- Task 6 Social Post and Photo Tag Proposal contracts remain green.

## Research decisions

- Apple Check In separates a chosen recipient, expected deadline, selected
  shared detail, and the failure path. PUBMAXX adopts explicit scope and
  deadline but does not copy automatic device monitoring:
  [Apple Check In](https://support.apple.com/en-euro/guide/personal-safety/ips56b5bc469/1.0/web/1.0).
- Apple Safety Check makes stop-sharing immediate and reviewable. PUBMAXX revoke
  follows that rule:
  [Apple Safety Check](https://support.apple.com/guide/personal-safety/safety-check-iphone-ios-16-ips2aad835e1/web).
- Signal exposes expiring chat as visible chat state. PUBMAXX fixes the server
  lifetime at 30 days and makes expiry database-owned:
  [Signal disappearing messages](https://support.signal.org/hc/en-us/articles/360007320771-Set-and-manage-disappearing-messages).
- Current social-planning products combine invitations, suggestions, votes, and
  event chat. PUBMAXX keeps those in one Planned Night while adding stronger
  friendship and consent boundaries:
  [SoKal](https://www.producthunt.com/products/sokal),
  [Howbout](https://www.producthunt.com/products/howbout), and
  [Planmesh](https://www.producthunt.com/products/planmesh).

## Standing verification

Every slice uses RED, GREEN, refactor, focused review, and exact rollback proof
when SQL changes. Every visual slice ends with an unprimed screenshot critique.
Where a prior PUBMAXX mobile frame is a target, compare candidate and target
before acceptance. Human visual feedback is useful but non-blocking. If no
reply arrives, record the evidence-based decision and continue.
