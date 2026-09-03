import "server-only";

// Optional durable map-search telemetry. Never stores the raw query string —
// only intent + length + hit counts. Fail-soft when Supabase is off.

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export type MapSearchEventInput = {
  intentPrimary: string;
  queryLength: number;
  nationalHitCount: number;
  nationalStatus: "ready" | "degraded";
};

export async function recordMapSearchEvent(
  input: MapSearchEventInput,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return;
    await admin.from("map_search_events").insert({
      intent_primary: input.intentPrimary.slice(0, 32),
      query_length: Math.max(0, Math.min(200, Math.floor(input.queryLength))),
      national_hit_count: Math.max(
        0,
        Math.min(100, Math.floor(input.nationalHitCount)),
      ),
      national_status: input.nationalStatus,
    });
  } catch (error) {
    console.warn("[map-search-events] insert failed", error);
  }
}
