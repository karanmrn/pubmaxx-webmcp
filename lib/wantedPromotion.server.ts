import "server-only";

import { memorySavedPubsStore } from "@/lib/savedPubsStore";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { memoryWantedStore } from "@/lib/wantedStore";

export type WantedPromotionResult =
  | {
      status: "saved" | "already_saved";
      promotedListType: string;
      promotedAt: string;
    }
  | {
      status: "not_found" | "not_promotable" | "already_promoted" | "unavailable";
    };

type WantedPromotionInput = {
  ownerActor: string;
  profileId: string;
  handle: string;
  wantedId: string;
  venueId: string;
  listType: string;
};

type PromotionRpcRow = {
  outcome?: unknown;
  promoted_list_type?: unknown;
  promoted_at?: unknown;
};

function promotionSuccess(row: PromotionRpcRow): WantedPromotionResult | null {
  if (row.outcome !== "saved" && row.outcome !== "already_saved") return null;
  if (typeof row.promoted_list_type !== "string" || typeof row.promoted_at !== "string") {
    return null;
  }
  return {
    status: row.outcome,
    promotedListType: row.promoted_list_type,
    promotedAt: row.promoted_at,
  };
}

async function promoteInMemory(input: WantedPromotionInput): Promise<WantedPromotionResult> {
  const wanted = await memoryWantedStore.getById(input.ownerActor, input.wantedId);
  if (!wanted) return { status: "not_found" };
  if (wanted.status !== "open" || wanted.venueKind !== "curated") {
    return { status: "not_promotable" };
  }
  if (wanted.promotedListType && wanted.promotedListType !== input.listType) {
    return { status: "already_promoted" };
  }
  const promoted = await memoryWantedStore.recordPromotion(
    input.ownerActor,
    input.wantedId,
    input.listType,
  );
  if (!promoted?.promotedListType || !promoted.promotedAt) {
    return { status: "already_promoted" };
  }
  const saved = await memorySavedPubsStore.ensureSaved({
    profileId: input.profileId,
    handle: input.handle,
    venueId: input.venueId,
    listType: input.listType,
  });
  if (saved.outcome === "unavailable") return { status: "unavailable" };
  return {
    status: saved.outcome,
    promotedListType: promoted.promotedListType,
    promotedAt: promoted.promotedAt,
  };
}

export async function promoteWantedToSavedList(
  input: WantedPromotionInput,
): Promise<WantedPromotionResult> {
  if (!isSupabaseConfigured()) return promoteInMemory(input);
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "promote_wanted_to_saved_list",
      {
        p_owner_actor: input.ownerActor,
        p_profile_id: input.profileId,
        p_wanted_id: input.wantedId,
        p_venue_id: input.venueId,
        p_list_type: input.listType,
      },
    );
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] as PromotionRpcRow | undefined : undefined;
    if (!row || typeof row.outcome !== "string") return { status: "unavailable" };
    const success = promotionSuccess(row);
    if (success) return success;
    if (
      row.outcome === "not_found"
      || row.outcome === "not_promotable"
      || row.outcome === "already_promoted"
    ) {
      return { status: row.outcome };
    }
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
