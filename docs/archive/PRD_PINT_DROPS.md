# PRD — Pint Drops: the Community Heritage Layer

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md

> Synthesised from conversation via `to-prd`. Vocabulary follows `CONTEXT.md`; decision recorded in `docs/adr/0002-community-heritage-layer.md`. Publish to the issue tracker with the `ready-for-agent` label once the tracker vocabulary is configured (`/setup-matt-pocock-skills`).

## Problem Statement

A PubMaxing user can see what a pint costs and plan a Crawl Route, but the map holds no human memory of London's pubs. The knowledge that makes a pub matter — a story handed down from a parent, a childhood local, why an old boozer is worth the detour — lives only in people's heads, and the generation that holds it has no way to pass it to the generation discovering these places. The price data is a commodity anyone can copy; the memory is not, and today the product captures none of it.

## Solution

Let anyone attach a **Pint Drop** to a Venue: a pint photo, a Venue photo, the price they paid, and a **Passed-Down Note** — a short memory or inherited story, tagged with the era it belongs to. Pint Drops appear in the Venue detail and light up a "story" marker on the map, turning the price map into a living archive of London's pub culture that both surfaces cheap real prices (backed by photo evidence) and lets one generation hand its knowledge to the next. Editorially seeded notes make the map feel alive before the first user arrives, and every claim shows its Provenance so sourced history and bar-stool legend never blur together.

## User Stories

1. As a visitor, I want to see Pint Drops on a Venue, so that I understand its character and history, not just its price.
2. As a visitor, I want to add a Pint Drop after a visit, so that I can share what I paid and what the place was like.
3. As a visitor, I want to attach a photo of my pint, so that my reported Pint Price is believable rather than a bare claim.
4. As a visitor, I want to attach a photo of the Venue, so that others can see the room, the garden, or the frontage.
5. As a knowledge-holder (30–50s), I want to write a Passed-Down Note about a pub my family drank in, so that the story is not lost when I am.
6. As a knowledge-holder, I want to tag a Passed-Down Note with an era (e.g. "1970s", "my childhood"), so that a memory is anchored in time.
7. As a discoverer (Gen Z), I want to read the Passed-Down Notes on a pub, so that I feel the generational history before I walk in.
8. As a visitor, I want to report the observed Pint Price with the drink name, so that the map's price colouring reflects real recent prices.
9. As a visitor, I want my newly reported Pint Price to update the Venue's cheapest-pint marker, so that I see my contribution take effect.
10. As a visitor, I want to see which claims are Sourced, which are Contributor, and which are Anecdote, so that I can weigh how much to trust each one.
11. As a visitor, I want to attach a Contributor Handle to my Pint Drop without creating an account, so that I can contribute with near-zero friction.
12. As a returning visitor, I want my chosen Contributor Handle remembered on this device, so that my Pint Drops are attributed consistently.
13. As a visitor, I want to browse a Venue's Pint Drops newest-first, so that recent prices and memories lead.
14. As a crawl planner, I want a Venue's story marker to reflect that it has Pint Drops, so that I can route my Crawl Route through pubs with character.
15. As a filterer, I want to filter the map to Venues that have a Passed-Down Note, so that I can plan a heritage-led night.
16. As a reader, I want a Venue with no Pint Drops yet to show an inviting empty state, so that I am prompted to be the first to contribute.
17. As any user, I want to report a Pint Drop that is abusive, false, or off-topic, so that the map stays trustworthy.
18. As any user, I want a reported Pint Drop hidden pending review, so that harmful content is not shown while it is assessed.
19. As a moderator, I want reported Pint Drops queued for review, so that I can hide or restore them.
20. As a visitor, I want obviously invalid input (a £40 pint, an empty note, an oversized image) rejected with a clear message, so that the data stays clean.
21. As a visitor on mobile, I want to add a Pint Drop from my phone camera, so that I can post from the pub.
22. As an editor, I want to seed curated Passed-Down Notes and Writer Picks, so that the map has depth on day one.
23. As a visitor, I want a curated Writer Pick to read distinctly from a user Anecdote, so that editorial voice and personal memory are not confused.
24. As a privacy-conscious user, I want to know a photo I upload is public and may show people, so that I can decide what to share.
25. As an operator, I want each contribution attributed to a Venue by its stable id, so that Pint Drops survive dataset re-imports.
26. As an operator, I want the write path rate-limited server-side, so that a single actor cannot flood the map.
27. As a reader, I want a Venue's most-recent verified Pint Price shown alongside the baseline dataset price, so that I can see how fresh the number is.
28. As a crawl planner, I want a built Crawl Route to show any Passed-Down Notes on its stops, so that the walk carries stories, not just prices.

## Implementation Decisions

- **One write-path seam.** All Pint Drop writes go through a single server route handler (e.g. `POST /api/pint-drops`) backed by Supabase. No component calls Supabase directly. This is the sole new seam; it is the highest point at which contributions can be tested and moderated. (See ADR 0002.)
- **One read merge point.** Contributed data merges into the existing per-Venue `curation` object that the map (`pubsToGeoJSON`) and side panel already consume. The existing `story` / `writer` pin properties and heritage/water filters render Pint-Drop data with no new client render path.
- **The Pint Drop unifies "log a price" and "post a photo/memory."** It is one object with optional parts: `{ pint_photo?, venue_photo?, price?, drink?, passed_down_note?, era?, handle }`. A drop with only a price is a price log; a drop with only a note is a memory; both are Visit Reports.
- **Provenance is a typed enum** on every heritage/price claim: `sourced | contributor | anecdote`. Editorial seeds are `sourced` (carry a source link); user Pint Drops are `contributor`; free-text Passed-Down Notes are `anecdote`. The UI always renders the provenance badge.
- **Schema (`visit_reports` table).** Columns at contract level: `id`, `venue_id` (stable Venue id from the dataset grouping key, not row index), `handle`, `drink`, `price_gbp`, `pint_photo_key`, `venue_photo_key` (Supabase Storage object keys, never URLs), `passed_down_note`, `era`, `provenance`, `status` (`visible | hidden | pending`), `created_at`. Photos live in Supabase Storage; the table stores object keys.
- **Identity.** v1 uses a device-remembered Contributor Handle (free text, server-sanitised); no auth, no profiles. Full accounts and a follow graph are out of scope. Note this resolves the original PRD's "no auth" non-goal by choosing the lightest identity that still attributes content.
- **Moderation / trust boundary.** The route handler validates every field server-side (price range, note length, image type/size), strips/escapes text (no inline user HTML), rate-limits per handle/IP, and supports `status = hidden` on report. A reported drop flips to `hidden` immediately, pending review.
- **RLS (permissive-but-guarded).** Public read of `status = 'visible'` rows; inserts allowed only through the server route (service role), never from the client anon key. This is stricter than the original PRD's fully-open insert policy because the data is now user photos and text.
- **Price freshness.** The Venue detail shows the most recent `contributor` Pint Price next to the baseline dataset price, so users see recency without the two sources overwriting each other.
- **Seeding.** The existing `lib/curation` Writer Picks / heritage notes are the day-one `sourced` content; the same render treats them as provenance-tagged Pint-Drop-shaped data so the map is never empty.

## Testing Decisions

- **Test external behaviour, not internals.** Assert what a contributor and a reader observe — a submitted valid Pint Drop becomes visible and changes the Venue's cheapest price; an invalid one is rejected with a message; a reported one disappears from public read — not the shape of internal functions.
- **The seam is the unit of test.** Because there is exactly one write path, the primary tests target the `POST /api/pint-drops` handler: valid submission persists and returns visible; out-of-range price / empty note / oversized or non-image upload are rejected; report flips status to hidden; rate limit triggers after N rapid submissions from one handle.
- **Read-merge test.** Given seeded `visit_reports`, `groupVenuePrices` + the curation merge expose the drop on the correct Venue by stable id, and `pubsToGeoJSON` sets the `story` flag — proving map glyphs light up from real data.
- **Prior art.** Follow the existing pure-function tests around `lib/venues.ts` (grouping, filtering, scoring) for the read-merge logic; add handler-level tests for the new route (the first server-side tests in this repo — call it out as a new seam for the reviewer).
- **Provenance never flattens.** A test asserts that a `sourced` claim and an `anecdote` claim on the same Venue both render with their distinct badge and are never merged into one undifferentiated note.

## Out of Scope

- Full user accounts, login, profiles, and a follow/friend graph (Letterboxd-style social loop is Phase 2).
- Likes, comments, notifications, activity feeds.
- Automated content moderation / ML classification (manual report → hide → review only in v1).
- Real-time updates via websockets (a submit refreshes the submitter's view; other clients pick it up on next load).
- Editing or deleting a submitted Pint Drop by its author (v1 is append-only plus moderation hide).
- Image transformations/watermarking beyond size/type validation.
- Backfilling heritage/era across the whole dataset (that is the separate spatial/heritage enrichment track; this PRD consumes those flags where present but does not produce them).

## Further Notes

- **Confirm the seam.** Per `to-prd`, the intended single seam is `POST /api/pint-drops` (write) + the `curation` merge (read). Confirm this matches your expectation before Codex builds; if a Supabase Edge Function is preferred over a Next.js route handler, that is the one place to change.
- **Why now:** this is the moment the deferred Supabase backend is justified — scoped to one table, one bucket, one route — rather than a speculative rewrite.
- **The loop it completes:** plan a Crawl Route (acquisition) → walk it → drop your pints and a memory (contribution) → others discover via the map (retention). The optimiser gave PubMaxing a reason to arrive; Pint Drops give it a reason to come back.
- **Dependencies:** Supabase project + Storage bucket + service-role key in `.env.local` (server-side only, never committed).
