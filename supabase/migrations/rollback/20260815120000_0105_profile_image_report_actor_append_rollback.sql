-- Rollback 0105. Dropping the function returns the store to its read-modify-write
-- fallback, which is still correct for a single reporter and only loses the
-- atomic append under concurrency. No data is written or removed here.

drop function if exists public.append_profile_image_report_actor(text, text, text, text);
