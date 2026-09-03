create index if not exists plan_actions_actor_member_idx
  on public.plan_actions(actor_member_id)
  where actor_member_id is not null;

create index if not exists plan_completions_final_pint_drop_idx
  on public.plan_completions(final_pint_drop_id)
  where final_pint_drop_id is not null;

create index if not exists pub_pal_memories_pal_created_idx
  on public.pub_pal_memories(pal_id, created_at desc);
