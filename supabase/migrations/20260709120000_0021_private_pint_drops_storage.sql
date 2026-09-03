-- Phase 4 storage hardening: private pint-drops bucket + signed URLs.
--
-- SQL cannot flip Storage bucket visibility — run this OUT OF BAND in the Supabase
-- dashboard or Management API after deploying the signed-URL code path:
--
--   1. Storage → pint-drops → Settings → disable "Public bucket".
--   2. Confirm no anon/authenticated READ policy grants public object access.
--   3. Service-role uploads/deletes (uploadPhoto/deletePhotos) continue to work.
--
-- The server now emits short-lived signed URLs (lib/pintDropsStore.ts
-- resolveStorageUrl) and deletes objects on hide/moderation takedown so a
-- previously shared link stops resolving once the row is hidden.

-- No schema change required; this migration is a deploy checklist anchor.
select 1;
