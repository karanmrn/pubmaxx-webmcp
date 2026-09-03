alter table public.pub_pals
  add column if not exists proposal_preferences jsonb not null
  default '{"memories": false, "routes": true}'::jsonb;

alter table public.pub_pal_memories
  add column if not exists updated_at timestamptz;

update public.pub_pal_memories
set updated_at = created_at
where updated_at is null;

alter table public.pub_pal_memories
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.pub_pals
  drop constraint if exists pub_pals_proposal_preferences_shape;

alter table public.pub_pals
  add constraint pub_pals_proposal_preferences_shape check (
    jsonb_typeof(proposal_preferences) = 'object'
    and jsonb_typeof(proposal_preferences -> 'memories') = 'boolean'
    and jsonb_typeof(proposal_preferences -> 'routes') = 'boolean'
  );
