-- 0023: Deny anon/authenticated SELECT on sensitive social tables (P1).
--
-- WHY: Several tables shipped with permissive `*_public_read` SELECT policies
-- (`using (true)` or status-gated). The browser publishable (anon) key can
-- therefore scrape full row sets via PostgREST — handles, notification payloads,
-- saved-pub lists, list follows — without going through `/api/*` DTOs.
--
-- FIX: DROP those public-read policies and leave NO replacement SELECT policies
-- for anon/authenticated. With RLS enabled and no permissive policy, those roles
-- are denied. The service role bypasses RLS; all app reads already go through
-- `requireSupabaseAdmin` on the server.
--
-- REALTIME: Supabase Realtime INSERT delivery is RLS-scoped for the anon key.
-- Deny-all SELECT on `visit_reports` may block live INSERT events on that
-- channel; the browser client already falls back to polling (`lib/realtime.ts`).
-- Do not re-add public SELECT policies to "fix" realtime.

-- ── visit_reports ────────────────────────────────────────────────────────────
drop policy if exists visit_reports_public_read on public.visit_reports;
-- Intentionally no SELECT policy: service-role API only (requireSupabaseAdmin).

-- ── notifications ────────────────────────────────────────────────────────────
drop policy if exists notifications_public_read on public.notifications;
-- Intentionally no SELECT policy: service-role API only (requireSupabaseAdmin).

-- ── saved_pubs ───────────────────────────────────────────────────────────────
drop policy if exists saved_pubs_public_read on public.saved_pubs;
-- Intentionally no SELECT policy: service-role API only (requireSupabaseAdmin).

-- ── saved_lists (0010; may be absent on older previews) ──────────────────────
drop policy if exists saved_lists_public_read on public.saved_lists;
-- Intentionally no SELECT policy: service-role API only (requireSupabaseAdmin).

-- ── saved_list_follows (0018; may be absent on older previews) ───────────────
drop policy if exists saved_list_follows_public_read on public.saved_list_follows;
-- Intentionally no SELECT policy: service-role API only (requireSupabaseAdmin).
