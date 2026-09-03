-- 1:1 messaging between handles (PRD E4 — the "talk to each other" layer).
-- Apply AFTER 0018. House style mirrors 0006_social_layer.sql / 0010_notifications.sql:
--   • `create table if not exists` / `add column if not exists` — idempotent, re-runnable.
--   • CHECK constraints added inside a DO block guarded by a pg_constraint lookup.
--   • RLS enabled on every table.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- COURTESY-CURTAIN, NOT CRYPTOGRAPHIC PRIVACY — READ THIS FIRST.
-- ─────────────────────────────────────────────────────────────────────────────
-- Identity here is a SELF-ASSERTED handle (no Google OAuth yet — same trust
-- boundary as the rest of the social layer; profiles.user_id stays the reserved
-- future auth link, see 0006/0009). A "private" message is therefore only as
-- private as the honesty of whoever claims a handle: anyone who asserts handle X
-- can read X's threads through the server route. This is a courtesy curtain, not
-- a cryptographic guarantee. Keep message content LOW-SENSITIVITY by design; the
-- `flagged_at` / `report` seam exists so abuse can be surfaced to the admin queue.
--
-- RLS POSTURE — DELIBERATELY STRICTER THAN THE SOCIAL TABLES.
-- ─────────────────────────────────────────────────────────────────────────────
-- Unlike notifications / social_layer, messages get NO public-read policy and NO
-- anon policy AT ALL — deny-all, exactly like rate_limits (0003). RLS is enabled
-- with zero policies, so anon/authenticated clients can neither read nor write.
-- EVERY read is mediated by the server route (service role), which enforces the
-- courtesy participant check (only handle_a / handle_b may read a conversation)
-- in application code. Putting a public-read policy here would leak every DM to
-- the anon key — that is WRONG for this table. When Google OAuth lands, add
-- user_id columns (reserved-null now, like profiles) + tighten to auth.uid()
-- membership so the curtain becomes a real wall.

create extension if not exists "pgcrypto";

-- ── conversations ────────────────────────────────────────────────────────────
-- One row per unordered PAIR of handles. handle_a / handle_b are stored in
-- NORMALISED LEXICOGRAPHIC ORDER (handle_a < handle_b) so a pair maps to exactly
-- one row regardless of who opened it; the unique (handle_a, handle_b) enforces
-- that. `last_message_at` is denormalised for a cheap newest-first inbox sort and
-- is bumped on every send. A conversation with a handle to itself is rejected by
-- the check (handle_a <> handle_b) — you can't DM yourself.
--
-- Auth reservation: user_id_a / user_id_b are the future FK columns to
-- auth.users, left NULL today (same pattern as profiles.user_id). When auth
-- lands they harden membership from a self-asserted handle to a real identity.
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  handle_a        text not null,
  handle_b        text not null,
  user_id_a       uuid,
  user_id_b       uuid,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (handle_a, handle_b)
);

alter table public.conversations
  add column if not exists user_id_a       uuid,
  add column if not exists user_id_b       uuid,
  add column if not exists last_message_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_pair_order_chk') then
    alter table public.conversations
      add constraint conversations_pair_order_chk
      check (handle_a < handle_b);
  end if;
end $$;

-- Inbox reads look a conversation up by EITHER participant handle, newest-first.
create index if not exists conversations_handle_a_idx
  on public.conversations (handle_a, last_message_at desc);
create index if not exists conversations_handle_b_idx
  on public.conversations (handle_b, last_message_at desc);

alter table public.conversations enable row level security;
-- DENY-ALL (see header): RLS on, NO policies. Only the service-role server route
-- reads/writes, after the courtesy participant check. Never add a public-read
-- policy to this table.

-- ── messages ─────────────────────────────────────────────────────────────────
-- One row per message. `body` is capped ~1000 chars (validated again in
-- lib/messages.ts before write). `read_at` NULL = unread by the recipient.
-- `flagged_at` / `flagged_by` are the abuse-report seam (reuse the moderation
-- posture): a reporter handle flags a message for the admin queue; the message is
-- NOT deleted — it is marked so a human can review. sender_handle is the
-- self-asserted author (no auth); sender_user_id is the reserved future FK.
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_handle   text not null,
  sender_user_id  uuid,
  body            text not null,
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  flagged_at      timestamptz,
  flagged_by      text
);

alter table public.messages
  add column if not exists sender_user_id uuid,
  add column if not exists read_at        timestamptz,
  add column if not exists flagged_at     timestamptz,
  add column if not exists flagged_by     text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_body_len_chk') then
    alter table public.messages
      add constraint messages_body_len_chk
      check (char_length(body) between 1 and 1000);
  end if;
end $$;

-- The hot read: a conversation's messages oldest-first (thread order).
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc);

alter table public.messages enable row level security;
-- DENY-ALL (see header): RLS on, NO policies. The server route mediates every
-- read with the courtesy participant check. Never add a public-read policy.
