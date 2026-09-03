# Slice 1: authority foundation

## Contract

A verified Plan host can bind one existing Planned Night to one Social Crew,
invite a current Mutual, accept one invitation once, decide one Join Request,
change cohost/member roles, transfer ownership, remove a member, or leave. No
operation creates a follow edge. Friendship loss or a block removes protected
authority on the next request without deleting membership provenance.

## Seam

`socialRelationshipBetweenProfiles(firstProfileId, secondProfileId)` returns
`self`, `mutual`, `not_mutual`, `blocked`, or `unavailable`. It never accepts a
handle.

`SocialCrewStore` owns `create`, `invite`, `acceptInvitation`, `requestJoin`,
`decideJoin`, `setRole`, `transferOwner`, `removeMember`, and `leave`. All inputs
receive actor authority from `requireVerifiedSocialActor()`. Mutations require a
16 to 128 character idempotency key and a server-derived payload digest.

`updateVisibility` is owner-only, accepts `private | friends | open` plus the
expected `authorityRevision`, and increments only that authority revision.
Crew title,
phase, start time, Night Area, route revision, and Plan state are derived from
the bound Planned Night and never copied into Crew storage.

Internal rows use `private_social_accounts.id`. Browser routes use scoped
`memberId` and `targetProfileId`, never account IDs.

## Migration 0075 foundation

Add `plans.social_owner_account_id`,
`plan_crew_members.social_account_id`, Social Crew, member, invitation, Join
Request, and write-receipt tables. Revoke browser roles. Grant service role.
Revoke RPC execution from public roles. Use fixed empty search paths.

Each Crew member keeps one immutable `plan_member_id`. `(plan_id,
social_account_id)` is unique when the account ID is present. Creation binds
the existing host Plan member to the owner. Invitation or Join Request
acceptance creates one Plan member and binds it in the same transaction, or
reactivates the prior Crew membership and reuses its retained Plan member.
Leave and removal end the Crew membership but retain both bindings as
provenance. They do not delete a Plan member or clear its Social account ID.
Existing legacy guests are not enrolled automatically.

Active Crew capacity is 20, including owner. Invitation states are `pending`,
`accepted`, `declined`, `revoked`, and `expired`. Join Request states are
`pending`, `accepted`, `declined`, `cancelled`, and `expired`. Each targeted
account has at most one pending row of each kind per Crew. Both expire at the
earlier of seven days after creation and `planScheduledEndMs(startTime)`, which
is the existing Plan start plus `ACTIVE_PLAN_POST_MS`; invalid or ended Plans
cannot mint a row. `now >= expiresAt` is expired. Membership states are
`active`, `left`, and `removed`. Owner and cohost may invite, revoke, and decide.
Invitee may accept or decline. Requester may cancel. Only owner changes roles,
transfers ownership, or changes visibility. Owner or cohost may remove a
non-owner. Any non-owner may leave, including after friendship loss or block.
Terminal rows remain immutable provenance. A later invitation or request may
reactivate the retained member and Plan-member binding.

`create_social_crew_atomic` locks Plan and host capability, binds the verified
account once, creates owner membership, revokes pending legacy Plan invites,
rotates legacy member token hashes, and records the idempotent result.

After conversion, central legacy Plan lookup treats the Plan as not found for
anonymous and capability requests. A server-only Social lookup can read it only
after Crew authority succeeds. Legacy join, invite redemption, member upgrade,
collaboration, action, recap, completion, and every old member capability are
rejected for the bound Plan.

## RED cases

- One-way follow is not friendship.
- Either-direction block overrides reciprocal follows.
- Handle rename changes display only.
- Membership creation does not change `follows`.
- Forged actor, owner, role, or account fields are rejected.
- Host capability binds only one verified account and only once.
- Anonymous join cannot enter a Crew-bound Plan.
- Anonymous or old-capability Plan read returns the same `404` after binding.
- Legacy invite redemption, upgrade, collaboration, action, recap, and
  completion cannot enter a Crew-bound Plan.
- Invitation and Join Request require current owner friendship.
- Double acceptance creates one membership.
- Same key and digest replay. Changed digest conflicts.
- A different idempotency key is an independent request.
- Invite, request, capacity, expiry, cancellation, and terminal provenance
  follow the closed state rules above.
- Visibility update requires owner role and current authority revision.
- Relationship failure returns `503`.
- Private denial is the same `404` as unknown Crew.
- Owner cannot leave. Transfer and leave races keep exactly one owner.
- Self-leave remains available after unfriend or block.
- Rollback reproduces pre-0075 catalog and privileges.

## Playable checkpoint

Use route fixtures to create Alice's Crew, invite Bob, accept twice, block Bob,
observe protected `404`, unblock, transfer ownership, then let Alice leave.

## Verification

Run the focused plan, PostgreSQL race test, typecheck, lint, and diff check.
Reviewers must inspect ownership, no-follow writes, legacy capability shutdown,
and rollback before Slice 2 starts.

## Delegated decisions

Internal helper names and test fixture UUIDs may change. Authority inputs,
states, status codes, table ownership, and race outcomes may not.
