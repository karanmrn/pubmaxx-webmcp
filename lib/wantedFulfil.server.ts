import "server-only";

// Quiet Wanted fulfilment when a drinker lands at a saved place.
// Called from presence / check-in (venue-tagged) and optional plan arrival.
// Never throws into the caller path — fulfilment is best-effort beside the
// primary write.

import { profileStore } from "@/lib/profileStore";
import { normalizeHandle } from "@/lib/profiles";
import { log } from "@/lib/log";
import { wantedStore } from "@/lib/wantedStore";
import type { WantedDTO } from "@/lib/wanted";

export async function ownerActorForHandle(handle: string): Promise<string | null> {
  const key = normalizeHandle(handle);
  if (!key) return null;
  try {
    const row = await profileStore().getByHandle(key);
    return row?.id ? `profile:${row.id}` : null;
  } catch {
    return null;
  }
}

/**
 * Fulfil open Wanteds for this owner at venueId. Returns fulfilled rows.
 * Fail-soft: store errors log and return [].
 */
export async function fulfilWantedsAtVenue(
  ownerActor: string,
  venueId: string,
): Promise<WantedDTO[]> {
  if (!ownerActor || !venueId) return [];
  try {
    return await wantedStore().fulfilForVenue(ownerActor, venueId);
  } catch (err) {
    log("error", "wanteds.fulfil_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Resolve handle → actor, then fulfil. Used by presence / check-in routes. */
export async function fulfilWantedsForHandleAtVenue(
  handle: string,
  venueId: string,
): Promise<WantedDTO[]> {
  const actor = await ownerActorForHandle(handle);
  if (!actor) return [];
  return fulfilWantedsAtVenue(actor, venueId);
}
