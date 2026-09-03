# Define the Production Boundary for Pint Drops

Pint Drops started as the community heritage layer behind one server route and one read merge. The local app now has a useful demo fallback: if Supabase is not configured, submitted drops live in memory and disappear when the process restarts.

That fallback is valuable for development, but it is not production behaviour. Production needs a crisp boundary so community prices, photos, and Passed-Down Notes are durable, attributable, and recoverable.

## Decision

- **Stable Venue ids are part of the data contract.** A Pint Drop attaches to a Venue using the stable id derived from the Venue grouping key, not from the Venue's position in an array. Dataset reordering must not orphan contributions.
- **The server route remains the only write path.** Components submit Pint Drops to `/api/pint-drops`; they do not call Supabase directly. The route owns validation, rate limiting, status changes, and storage object creation.
- **Public reads can load all visible drops.** The map needs the community layer before a Venue is selected, so `GET /api/pint-drops` returns visible drops across venues and `GET /api/pint-drops?venueId=...` returns a Venue-specific slice.
- **Contributor data merges into existing Venue presentation.** Recent community Pint Prices and Passed-Down Notes are read into the existing Venue detail and map signal layer instead of creating a parallel content model.
- **Production must be explicitly backed by Supabase.** The in-memory store is only for local development and demos. A production deploy must provide Supabase URL, service-role key, storage bucket, and migrations before accepting public contributions.

## Consequences

- Opus can safely request production credentials and deployment access without changing the app's component architecture.
- Reviewers can test the community path at one boundary: API route in, map/detail merge out.
- Production readiness work is mostly operational now: apply migrations, configure Storage, set host environment variables, confirm moderation ownership, and verify legal/privacy copy.
- If Supabase is configured but unavailable, the API should fail loudly rather than falling back to volatile memory. Silent fallback would lose public contributions and make debugging impossible.
