# Slice 4: live loop

## Contract

The Crew can move from planning to live to ended, append actor-bound Plan
actions, Check in against the current route revision, and share an exact Venue
with selected current Mutuals.

## Seam

`SocialCrewLiveStore` owns state transition, action, Check-in, and Venue-share
RPCs. Check-in input contains Venue ID, expected route revision, and idempotency
key. Server resolves stop membership and actor account.

## RED cases

- Member removal racing a live action writes no post-removal action.
- Route replacement racing Check-in yields current revision or conflict.
- Old-revision Check-in is not current.
- Check-in survives handle rename with stable authorship.
- Non-Mutual member sees status but no exact Venue.
- Revoke, unfriend, or block removes exact Venue immediately.
- Exact Venue never reaches notification, analytics, log, preview, or metadata.

## Playable checkpoint

Start a Crew, Check in at one Crawl Stop, replace route, observe stale Check-in
leave current state, then revoke a Venue share.

## Verification

Run Plan action journal, route revision, Check-in, projection, and privacy tests.
Realtime remains an invalidation signal only.
