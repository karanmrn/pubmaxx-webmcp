-- Make public.check_ins.area_slug optional.
--
-- The "out tonight" beacon is a check-in with no note and visibility
-- 'friends' — a plain presence signal, not a new table (two tables both
-- answering "is X out" would be two sources of truth). A beacon check-in may
-- carry no area at all, so the column can no longer be NOT NULL.
--
-- Numbered 0083, not 0082: Cursor PR #817 (unmerged, coffee taxonomy) already
-- claims migration number 0082.
--
-- SQL only — the captain applies migrations.

alter table public.check_ins
  alter column area_slug drop not null;
