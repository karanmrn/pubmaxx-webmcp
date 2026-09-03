# Referral integrity

A referral milestone is a MARK OF HONOUR. It confers recognition and never a
capability. This is the founding-member law ([`lib/foundingMembers.ts`](../lib/foundingMembers.ts))
applied to a second status: somebody who has invited five mates sees the same
map, the same prices and the same planner as somebody who has invited nobody.

Nothing in the product may branch on a referral count. A change that reads one
to decide whether a feature runs is the wrong shape.
`__tests__/referralMarkLaw.test.ts` is the fence.

## Boundaries

`lib/referralStore.ts` owns private invite codes, immutable account edges,
qualification events, and milestone history. `lib/referrals.ts` owns milestone
policy and the mark copy. Public profiles and contribution leaderboards must
not import either module.

Following an invite redirects with its opaque code in a URL fragment. No
referral cookie or server-side attribution state is created while the person
browses. Existing auth-attempt coordination carries the fragment through a
deliberate sign-up. Only a successful callback for a newly created account can
submit the code and record an edge. Before auth starts, the server signs the
browser auth-attempt ID and issue time. Claim verifies that proof and requires
the verified Supabase Auth account creation time to follow it. A delayed return,
another browser or device, an invalid code, or an existing account is not
attributed. These are absence of same-journey proof, so they never fall back to
a guessed attribution. Proof issuance is time-bounded, and both proof issuance
and attribution claims are fail-soft: either may be skipped without blocking
account sign-in.

An account edge alone is not a qualified referral. Qualification needs a first
accepted contribution carrying that invited account's verified auth ID. Current
contribution rows do not carry that proof, so no production route calls the
qualification seam.

## What a milestone is, and what it replaced

Reaching 1, 3 or 5 qualified referrals appends one milestone row and earns one
line of copy: "Brought a mate in", "Brought 3 mates in", "Brought 5 mates in".
The line is printed on the owner's own account surface and read nowhere else.

Until 2026-08-10 the model was the opposite. Each milestone named a pro feature
(`collaborative_night_credit`, `continuing_memories`,
`post_trial_collaboration`), the ledger could record a `feature_granted` event,
and one closed gate held it shut until person-level anti-abuse landed. A closed
gate is a mute button, not a decision: the model still existed and one flag
stood between it and shipping. Captain decision 2026-08-10 deleted it, in
TypeScript and in SQL (migration `0101` + rollback; captain applies).

The abuse argument goes with the grants. Somebody who games the count wins a
sentence about themselves and nothing else, which is why recognition may ship
where a grant could not. Two things follow:

- The mark stays on the owner's OWN private surface. Making it public would
  need the person-level check first, because a public mark is a claim about
  somebody made in front of everybody else.
- Direct self-edges and two-account circles are still rejected. Cheap integrity
  stays; it just no longer guards anything worth stealing.

## Identity handoff

Current invite-code ownership, invite edges, private status reads, attribution
claims, and erasure all key on Supabase Auth user IDs. A canonical contributor
identity would change each boundary:

- invite creation and private status must translate the signed-in account to
  the canonical contributor before reading or writing referral records
- same-journey attribution must write the canonical invitee identity while
  keeping the signed attempt start and verified Auth account creation time as
  evidence of new signup
- accepted contribution writes must attach that same canonical identity on the
  server before they may call the qualification seam
- person-level anti-self-referral checks must run before qualification, and
  before a mark is ever shown in public, because two Auth IDs do not prove two
  people
- account deletion must erase referral data through every Auth-account mapping
  attached to the canonical contributor

Existing referral rows need an explicit Auth-ID-to-contributor-ID migration when
that key lands. They must not be joined by handle, email, device token, or
caller-supplied account ID as a proxy.

## Privacy and erasure

Invite edges and both account IDs stay private. APIs return only the signed-in
account's own link and aggregate counts. Ordinary edge, qualification, and
ledger writes are append-only. Verified account erasure uses the dedicated
database erasure function so auditability does not override deletion rights.
Erasure also stores a one-way account-ID hash in a referral-only write block.
Every referral write checks that block, so a still-valid session cannot recreate
private referral data after deletion.
