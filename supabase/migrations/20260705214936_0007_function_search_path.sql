-- Pin search_path on the two SECURITY-relevant helpers so a caller can't shadow
-- referenced objects via a mutable search_path (Supabase perf/security advisor
-- 0011_function_search_path_mutable).
--
-- APPLIED to production early via the Supabase MCP/SQL editor (ledger version
-- 20260705214936, name 0007_function_search_path) BEFORE this repo adopted
-- timestamp-prefixed migration filenames. This file is the repo-of-record so the
-- GitHub preview-branch integration finds a local file for every remote ledger
-- version. Both statements are re-runnable (plain ALTER FUNCTION ... SET), so a
-- fresh preview branch applies them without error.
--
-- Depends on: 0003_rate_limits.sql (check_rate_limit) and
-- 0004_report_pint_drop.sql (report_pint_drop) — both ordered earlier.
alter function public.check_rate_limit(text, int, int) set search_path = public, pg_temp;
alter function public.report_pint_drop(uuid, text, int) set search_path = public, pg_temp;
