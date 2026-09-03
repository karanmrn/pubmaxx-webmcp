-- Pint Drop vibe tags. A small, capped set of allowlisted mood tags
-- (cheap, chaotic, quiet pint, old local, date night, coding pint, last train,
-- riverside, hidden gem, first legal pint) attached to a drop as supporting
-- metadata — they never satisfy the price-or-note signal requirement.
--
-- Persisted as a text[] to match lib/pintDropsStore.ts toRow/fromRow, which map
-- `vibe_tags <-> vibeTags` like every other column. ADD COLUMN IF NOT EXISTS so
-- a table created by an earlier migration upgrades in place; old rows read as an
-- empty array. The allowlist and the 4-tag cap are enforced in application code
-- (validatePintDrop on write, cleanVibeTags on read) — server-authoritative,
-- so no DB-level CHECK is needed here.

alter table public.visit_reports
  add column if not exists vibe_tags text[] not null default '{}';
