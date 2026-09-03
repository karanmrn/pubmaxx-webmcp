# PUBMAXX Moment to Story

Status: first production vertical slice implemented locally on 2026-07-15.

## Product promise

PUBMAXX helps a Pubmaxxer keep the people, places, drinks, events and side quests that made a night memorable. Capturing a personal Moment and logging a factual Pint Drop are related actions, but they are not the same action.

## Journey contract

1. **Moment** opens `/moment`, never the map.
2. A Moment starts private and remains recoverable on the device before sign-in.
3. **Pint Drop** remains the explicit `/map?log=1` flow for venue, drink and price evidence.
4. **Stories** opens `/feed`, never Discover or the map.
5. **You → Memories** is the private workspace where a Pubmaxxer shapes captured Moments into a Story.
6. Publishing remains a separate proposal-and-confirmation action. Capture never publishes automatically.

## Implemented slice

- Dedicated mobile-first Moment composer with camera/library selection, up to four JPEG, PNG or WebP photos, optional per-photo editing, caption, night title and optional venue reference.
- IndexedDB draft persistence with a versioned schema, local metadata fallback and cross-tab revision notification.
- Guest-to-account draft recovery after sign-in.
- Authenticated server upload through the existing normalized private-photo pipeline; browser code never receives storage credentials.
- Private signed media URLs on the owner-only Night Moments endpoint.
- Explicit partial-failure recovery: unsaved media remains in the draft.
- Canonical five-tab navigation: Map, Tonight, Moment, Stories and You.
- Social feed creation controls for both Moment and Pint Drop.
- Direct Moment entry from the You Memory studio.
- Neutral light and dark surfaces with coral reserved for creation and selection.
- Deliberate 4:5 mobile crop for the landing drink-signal image.

## Quality bars

- 44px minimum interactive targets and visible keyboard focus.
- No capture/publish ambiguity.
- No autoplay, forced motion or dependence on WebGL.
- Private media is normalized and metadata-stripped server-side.
- Draft survives refresh and a provider/network failure.
- Mobile navigation does not cover the camera action label.

## Next implementation gates

1. Add a first-class published Night Story card model to the feed; the current stream still primarily renders Pint Drops.
2. Add consent and tagging UI for friends appearing in photos before a Story can publish.
3. Replace free-text venue references with a fast map/place chooser backed by the existing venue domain.
4. Add video only after a server-side transcoding, size, poster and moderation pipeline exists. Do not send raw videos directly to public storage.
5. Add Memory ordering, cover selection and Story preview inside You.
6. Add delete/export UI for photos and complete account-erasure coverage.

## Success measures

- Activation: first private Moment captured in the first session.
- Journey success: Moment draft completion and Story preview completion.
- Trust: zero unintended publications and zero lost recoverable drafts.
- Retention: Pubmaxxers returning to Memories within 7 and 30 days.
- Performance: p95 interaction response below 200ms for local draft actions and no route regression above the existing web-vital budgets.
