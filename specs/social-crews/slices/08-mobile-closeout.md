# Slice 8: mobile closeout

## Contract

Ship `/social/crews` and `/social/crews/[crewId]` with compact
`Plan | Live | Chat` sections, persistent Safe Home action, sourced context,
legal disclosure, and complete browser and PostgreSQL proof.

## UI rules

- 44 px minimum targets.
- No repeated helper copy.
- Safe Home action remains reachable without covering content.
- Keyboard order reaches Back, Plan, Live, Chat, Safe Home, and primary action.
- Reduced motion removes nonessential transitions.
- No horizontal overflow at 320, 390, or 430 px.
- A protected `404` or `503` clears cached protected state before fallback.
- Signals trigger authoritative refetch.

## Legal rules

Privacy and terms disclose membership, invitations, Join Requests, Check-ins,
30-day Crew Chat expiry, case-specific legal holds, Safe Home grant/status/
escalation records, no journey monitoring, and no emergency-service contact.

## Browser proof

Cover signed-out, unverified, owner, member, preview, blocked, failure, Plan,
Live, Chat, and Safe Home states. Capture 320, 390, and 430 px light and dark
frames. Run Axe, keyboard, focus restoration, reduced motion, target geometry,
and horizontal-overflow checks.

Run an unprimed screenshot critique last. Compare against current Social mobile
chrome only for header, bottom-tab clearance, density, and tap geometry.

## Final gate

Run focused PostgreSQL forward/rollback and races, focused Playwright, full
`npm run verify`, isolated `npm run ci`, and independent security and visual
review. Beta remains off. Captain alone applies migration 0075.
