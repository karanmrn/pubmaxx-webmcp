-- Collaborative Night Memory foundations.
--
-- This is additive to crawl_stories. The legacy table remains the public,
-- route-shaped crawl permalink model; these tables add account-owned private
-- Memories, atomic Moments, contributor consent, and confirmation-gated Story
-- publication. The application accesses them through authenticated server
-- routes with the service role. Browser roles receive no direct table grants.

create table if not exists public.night_memories (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  plan_completion_id uuid references public.plan_completions(id) on delete set null,
  visibility text not null default 'private' check (visibility = 'private'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists night_memories_owner_updated_idx
  on public.night_memories (owner_id, updated_at desc);
create unique index if not exists night_memories_owner_completion_unique
  on public.night_memories (owner_id, plan_completion_id)
  where plan_completion_id is not null;

create table if not exists public.night_moments (
  id uuid primary key,
  memory_id uuid not null references public.night_memories(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('photo', 'pint_drop', 'event', 'venue', 'quote', 'person', 'side_quest')),
  caption text not null default '' check (char_length(caption) <= 500),
  pint_drop_id uuid references public.visit_reports(id) on delete set null,
  venue_id text,
  media_object_key text,
  occurred_at timestamptz,
  visibility text not null default 'private' check (visibility = 'private'),
  created_at timestamptz not null default now(),
  constraint night_moments_pint_drop_reference_chk
    check (kind <> 'pint_drop' or pint_drop_id is not null),
  constraint night_moments_content_chk
    check (kind = 'pint_drop' or caption <> '' or venue_id is not null or media_object_key is not null)
);

create index if not exists night_moments_memory_created_idx
  on public.night_moments (memory_id, created_at);
create index if not exists night_moments_owner_idx
  on public.night_moments (owner_id);

create table if not exists public.night_stories (
  id uuid primary key,
  memory_id uuid not null references public.night_memories(id) on delete cascade,
  host_editor_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 500),
  status text not null default 'draft' check (status in ('draft', 'published')),
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  legacy_crawl_story_id uuid references public.crawl_stories(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint night_stories_publication_state_chk check (
    (status = 'draft' and visibility = 'private' and published_at is null)
    or (status = 'published' and visibility in ('unlisted', 'public') and published_at is not null)
  )
);

create index if not exists night_stories_memory_idx on public.night_stories (memory_id);
create index if not exists night_stories_public_idx
  on public.night_stories (published_at desc)
  where status = 'published' and visibility = 'public';

create table if not exists public.night_story_contributors (
  story_id uuid not null references public.night_stories(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'editor', 'contributor')),
  status text not null default 'invited' check (status in ('invited', 'accepted', 'removed')),
  joined_at timestamptz,
  primary key (story_id, profile_id),
  constraint night_story_contributor_joined_chk check (
    (status = 'accepted' and joined_at is not null) or status <> 'accepted'
  )
);

create unique index if not exists night_story_single_host_idx
  on public.night_story_contributors (story_id)
  where role = 'host' and status <> 'removed';
create index if not exists night_story_contributor_profile_idx
  on public.night_story_contributors (profile_id, status);

create table if not exists public.night_moment_consents (
  story_id uuid not null references public.night_stories(id) on delete cascade,
  moment_id uuid not null references public.night_moments(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'withdrawn')),
  decided_at timestamptz,
  primary key (story_id, moment_id),
  constraint night_moment_consent_decision_chk check (
    (status = 'pending' and decided_at is null) or (status <> 'pending' and decided_at is not null)
  )
);

create index if not exists night_moment_consents_owner_idx
  on public.night_moment_consents (owner_id, status);

-- Only Moments in this join table are part of the published Story. Withdrawing
-- consent deletes the join row; the private source Moment remains intact.
create table if not exists public.night_story_moments (
  story_id uuid not null references public.night_stories(id) on delete cascade,
  moment_id uuid not null references public.night_moments(id) on delete cascade,
  position integer not null check (position between 0 and 99),
  primary key (story_id, moment_id),
  unique (story_id, position)
);

create table if not exists public.night_story_publish_proposals (
  id uuid primary key,
  story_id uuid not null references public.night_stories(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  moment_ids uuid[] not null check (cardinality(moment_ids) between 1 and 100),
  visibility text not null check (visibility in ('unlisted', 'public')),
  token_hash text not null check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists night_story_publish_proposals_story_idx
  on public.night_story_publish_proposals (story_id, expires_at desc);

-- Confirm publication in one transaction. Consent is checked again while the
-- proposal row is locked, so a concurrent withdrawal wins before any Story or
-- join-table state becomes public.
create or replace function public.confirm_night_story_publication(
  p_proposal_id uuid,
  p_story_id uuid,
  p_requested_by uuid,
  p_token_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.night_story_publish_proposals%rowtype;
  selected_id uuid;
  selected_position integer := 0;
begin
  select * into candidate
  from public.night_story_publish_proposals
  where id = p_proposal_id
    and story_id = p_story_id
    and requested_by = p_requested_by
    and token_hash = p_token_hash
    and confirmed_at is null
    and expires_at > now()
  for update;

  if not found then return false; end if;

  if not exists (
    select 1 from public.night_story_contributors
    where story_id = p_story_id
      and profile_id = p_requested_by
      and status = 'accepted'
      and role in ('host', 'editor')
  ) then return false; end if;

  if exists (
    select 1
    from unnest(candidate.moment_ids) as requested(moment_id)
    left join public.night_moments moment on moment.id = requested.moment_id
    left join public.night_stories story on story.id = p_story_id
    left join public.night_moment_consents consent
      on consent.story_id = p_story_id
      and consent.moment_id = requested.moment_id
      and consent.owner_id = moment.owner_id
    where moment.id is null
      or moment.memory_id <> story.memory_id
      or (moment.owner_id <> p_requested_by and coalesce(consent.status, '') <> 'approved')
  ) then return false; end if;

  update public.night_stories
  set status = 'published', visibility = candidate.visibility,
      published_at = now(), updated_at = now()
  where id = p_story_id;

  delete from public.night_story_moments where story_id = p_story_id;
  foreach selected_id in array candidate.moment_ids loop
    insert into public.night_story_moments (story_id, moment_id, position)
    values (p_story_id, selected_id, selected_position);
    selected_position := selected_position + 1;
  end loop;

  update public.night_story_publish_proposals
  set confirmed_at = now()
  where id = p_proposal_id;
  return true;
end;
$$;

revoke all on function public.confirm_night_story_publication(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_night_story_publication(uuid, uuid, uuid, text)
  to service_role;

alter table public.night_memories enable row level security;
alter table public.night_moments enable row level security;
alter table public.night_stories enable row level security;
alter table public.night_story_contributors enable row level security;
alter table public.night_moment_consents enable row level security;
alter table public.night_story_moments enable row level security;
alter table public.night_story_publish_proposals enable row level security;

revoke all on
  public.night_memories,
  public.night_moments,
  public.night_stories,
  public.night_story_contributors,
  public.night_moment_consents,
  public.night_story_moments,
  public.night_story_publish_proposals
from anon, authenticated;
