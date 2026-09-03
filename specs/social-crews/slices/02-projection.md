# Slice 2: projected reads

## Contract

Crew list and Crew Page reads expose only current authority. Private denial is
`404`. A Mutual may receive a narrow friends preview and Join Request state.
A signed-in non-mutual can receive a narrow open preview if the plan is `open`.
Only an active member who remains a current Mutual with owner receives full Plan
state. Crew list is member-only; friend and open previews stay detail-only
because they have no Crew identifier.

Title, start time, nullable Night Area, and phase are projected from the Planned
Night. Full detail also carries Plan `routeRevision` and Crew
`authorityRevision`; collection deliberately omits both revisions.

For open previews, host handle, member count, and stop-1 venue/place name are
projected for public list rendering.

## Seam

`projectSocialCrewRead(raw, viewer)` is the only detail raw-row to browser
boundary. `projectSocialCrewListPage(raw, viewer, encodeCursor)` is the only
collection boundary. Store injects the cursor encoder; projector validates raw
position coherence and returns the final DTO without internal cursor fields.
`SocialCrewReadDTO` is the only detail response and `SocialCrewListPageDTO` is
the only collection response. Cursors bind HMAC
signature to viewer profile ID, lane, timestamp, and row ID. Cursor position
never grants authority.

Canonical list types live in the parent Social Crew specification.

One atomic list snapshot filters current authority before cursor and limit. It
returns narrow item rows plus the last returned membership position only when
another authorised row exists. A valid active actor with no Crews receives an
empty `200`; stale account or profile binding receives `404`; database or
signing-key failure receives `503`; invalid cursor receives `422`.

## RED cases

- Preview excludes route, exact Venue, identities, chat, protected IDs, Check-ins,
  and Safe Home.
- Current membership without owner friendship gets `404`.
- A block clears protected DTOs on next refetch.
- Dependency failure returns `503`, not empty or `404`.
- Actor A cursor fails for actor B.
- List never performs per-item detail reads or returns full Plan state.
- Authority filtering happens before `LIMIT + 1` and cursor position.
- Legacy Plan tokens never return member projection for a Crew-bound Plan.

## Playable checkpoint

Owner sees full page. Uninvited Mutual sees friends preview. Pending requester
sees the same preview plus pending state. A signed-in non-mutual sees open
preview only when allowed. Stranger, blocked member, and private denial see the
same not-found surface.

## Verification

Run DTO snapshot, route, cache-header, cursor, and legacy-firewall tests. No
visual proof is required before Slice 8.
