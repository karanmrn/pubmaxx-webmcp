-- Remove revision-bound authority only. The legacy four-argument overload stays fail closed.
drop function if exists public.moderate_social_post_admin(uuid,uuid,uuid,integer,text);
