-- Supabase default privileges grant service_role more than SELECT on new public
-- relations. Keep this reporting seam read-only even though the service role
-- separately owns the server-side completion write path.

revoke all on public.pnc_qualified_completions from service_role;
grant select on public.pnc_qualified_completions to service_role;
