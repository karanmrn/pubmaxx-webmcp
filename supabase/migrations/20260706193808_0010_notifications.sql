-- Social depth: notifications + activity, user-defined saved lists, and
-- crawl-story authorship. Apply AFTER 0009. Style mirrors 0006_social_layer.sql:
--   • `create table if not exists` / `add column if not exists` — idempotent,
--     re-runnable.
--   • CHECK constraints added inside a DO block guarded by a pg_constraint lookup.
--   • RLS on every table, service-role-only write (no anon/authenticated INSERT
--     policy → those inserts are denied; the server route writes via service role).
--
-- Identity note: like the rest of the social layer, everything here is keyed by
-- the self-asserted `handle` (auth ownership is a separate lane — profiles.user_id
-- stays the reserved future link, see 0006). A notification therefore carries no
-- private content beyond what is already public in the feed (a follow, a reaction,
-- a comment, a crawl save) — treat notification reads as low-sensitivity.

create extension if not exists "pgcrypto";

-- ── notifications ────────────────────────────────────────────────────────────
-- One row per social event addressed to a recipient handle. `kind` is the event
-- type; `subject_ref` is an opaque reference to the subject (a drop id, a slug,
-- the actor's own handle) that the read side renders into a link — kept as free
-- text because the four kinds point at different subject namespaces and none is a
-- hard FK (a drop lives in visit_reports, a crawl in crawl_stories by slug, a
-- follow has no subject beyond the actor). `read_at` NULL = unread.
--
-- Handles are self-asserted (no auth yet), so a notification is only ever
-- addressed by the recipient's public handle and never exposes anything the feed
-- doesn't already show. When auth lands, add a recipient_user_id FK + tighten the
-- read policy to auth.uid() ownership (same reservation as profiles.user_id).
create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_handle text not null,
  actor_handle     text not null,
  kind             text not null,
  subject_ref      text,
  subject_label    text,
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);

alter table public.notifications
  add column if not exists subject_ref   text,
  add column if not exists subject_label text,
  add column if not exists read_at       timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_kind_chk') then
    alter table public.notifications
      add constraint notifications_kind_chk
      check (kind in ('follow', 'reaction', 'comment', 'crawl_save'));
  end if;
end $$;

-- The hot read: a recipient's newest-first inbox + unread count.
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_handle, created_at desc);

alter table public.notifications enable row level security;

-- Public read: a notification carries only already-public social signal (see
-- header), so a permissive read matches the rest of the social layer. There is
-- no anon write policy — only the service-role server route emits notifications.
-- Tighten to recipient ownership when auth lands.
drop policy if exists notifications_public_read on public.notifications;
create policy notifications_public_read
  on public.notifications
  for select
  using (true);

-- ── saved_lists ──────────────────────────────────────────────────────────────
-- User-defined saved-pub lists, beyond the built-in list types. A row registers a
-- custom list NAME owned by a profile; saves still live in public.saved_pubs with
-- `list_type` holding the list name verbatim (free text — 0006 already models it
-- as text, no enum to extend). This registry is what lets a handle create/rename a
-- named list that has no saves yet, and gives the pick-UI a source of truth for a
-- handle's custom lists distinct from the built-in seven.
create table if not exists public.saved_lists (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, name)
);

create index if not exists saved_lists_profile_idx on public.saved_lists (profile_id);

alter table public.saved_lists enable row level security;

-- A named list is public content (mirrors saved_pubs_public_read — a shareable
-- "my lists"). Service-role-only write.
drop policy if exists saved_lists_public_read on public.saved_lists;
create policy saved_lists_public_read
  on public.saved_lists
  for select
  using (true);

-- ── crawl_stories.author_handle ──────────────────────────────────────────────
-- Attribute a durable crawl story to its author's self-asserted handle. Kept as a
-- plain text handle (NOT the profiles FK author_id, which stays reserved for the
-- auth-linked author) so authorship works today with device handles and links to
-- /u/[handle]. Edit/delete are gated on this handle at the API seam; TRUE
-- ownership enforcement lands when auth ownership merges.
alter table public.crawl_stories
  add column if not exists author_handle text;

create index if not exists crawl_stories_author_handle_idx
  on public.crawl_stories (author_handle);
