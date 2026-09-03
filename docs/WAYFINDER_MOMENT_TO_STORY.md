# Wayfinder: Moment to Story

## North star

Turn a night out into a private, editable memory first; let the Pubmaxxer choose if and when it becomes social.

## Current map

| Surface | User intent | Canonical route | State |
| --- | --- | --- | --- |
| Map | Find places and factual prices | `/map` | Existing |
| Pint Drop | Log venue, drink and price evidence | `/map?log=1` | Existing, preserved |
| Tonight | Decide what to do now | `/tonight` | Existing, preserved |
| Moment | Capture personal media and context | `/moment` | Implemented |
| Stories | Browse the social stream | `/feed` | Navigation fixed; Story cards next |
| You / Memories | Own, edit and shape the night | `/u/you#night-memories` | Entry integrated; editor expansion next |

## Delivery sequence

- **M1 — Route truth:** complete. Moment and Stories have canonical destinations across desktop and mobile navigation.
- **M2 — Recoverable capture:** complete. Versioned private drafts, guest recovery, multi-photo capture and partial-failure protection.
- **M3 — Private persistence:** complete for photos. Authenticated normalized uploads and owner-only signed retrieval.
- **M4 — Memory workspace:** in progress. Direct entry exists; ordering, covers, place chooser and additional media controls remain.
- **M5 — Story publishing:** next. Feed card model, tagged-person consent, audience preview, proposal and explicit confirmation.
- **M6 — Social graph:** next. Handle-aware authorship, replies, saves and following applied to Night Stories without duplicating the existing profile graph.
- **M7 — Certification:** mobile light/dark, accessibility, privacy, performance, failure recovery and moderation matrix before push or deployment.

## Guardrails

- Moment does not silently become a Pint Drop.
- A draft does not silently become a Story.
- A Story does not publish without confirmation.
- Alcohol quantity does not drive status or progression.
- Existing map filters, prices, planning routes and public URLs remain unchanged.
- Implementation stays local until an explicit push or deployment request.
