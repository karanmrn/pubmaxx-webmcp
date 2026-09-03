begin;

-- These tables contain ownership keys, actor hashes, or child rows whose
-- visibility depends on a parent record. Public reads are served by the app
-- APIs, which enforce those boundaries and return deliberately narrow DTOs.
drop policy if exists profiles_public_read on public.profiles;
drop policy if exists pint_drop_reactions_public_read on public.pint_drop_reactions;
drop policy if exists pint_drop_comments_public_read on public.pint_drop_comments;
drop policy if exists crawl_story_stops_public_read on public.crawl_story_stops;

-- RLS remains the primary boundary. Revoke table-level SELECT as defence in
-- depth so a later permissive policy cannot accidentally reopen raw records.
revoke select on table
  public.profiles,
  public.pint_drop_reactions,
  public.pint_drop_comments,
  public.crawl_story_stops
from public, anon, authenticated;

-- Server-side stores use the service role after applying API visibility and
-- redaction rules. Keep that existing application path explicit.
grant select on table
  public.profiles,
  public.pint_drop_reactions,
  public.pint_drop_comments,
  public.crawl_story_stops
to service_role;

commit;
