import "server-only";

import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { isMissingTableSchema } from "@/lib/storeBackend";

export async function readSocialPostCreateRequest(profileId: string, key: string): Promise<{ digest: string; mediaId: string | null } | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await requireSupabaseAdmin().from("social_post_create_requests")
    .select("request_digest,media_id").eq("author_profile_id", profileId).eq("idempotency_key", key).maybeSingle();
  if (error) {
    if (isMissingTableSchema(error, ["social_post_create_requests"])) return null;
    throw error;
  }
  if (!data) return null;
  return { digest: String(data.request_digest), mediaId: typeof data.media_id === "string" ? data.media_id : null };
}
