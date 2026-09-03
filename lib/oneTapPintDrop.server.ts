import "server-only";

import { randomUUID } from "node:crypto";

import { submitCategoryLabel } from "@/lib/communityPrice";
import { moderateCommunityPrice } from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropPhotos } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { reconcilePriceTrustForObservation } from "@/lib/priceTrustImpact.server";

export type OneTapPintDropInput = Readonly<{
  venueId: string;
  handle: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  verifiedAccountId?: string;
}>;

export type OneTapPintDropOutcome =
  | { ok: true; drop: PintDrop }
  | { ok: false; kind: "invalid_photo"; message: string }
  | { ok: false; kind: "storage"; message: string };

async function ensureProfileForHandle(handle: string): Promise<void> {
  try {
    await profileStore().ensure(handle);
  } catch (err) {
    console.warn(
      "[one-tap-pint-drop] could not ensure profile for handle (drop still saved):",
      err instanceof Error ? err.message : err,
    );
  }
}

function buildDrop(input: OneTapPintDropInput): PintDrop {
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    throw new Error("Add a contributor handle.");
  }
  return {
    id: randomUUID(),
    venueId: input.venueId,
    handle,
    drink: submitCategoryLabel(input.drinkCategory),
    priceGbp: input.priceGbp,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    authorityKey: pintDropAuthorityKey(input.venueId, input.verifiedAccountId),
  };
}

export async function revertOneTapCommunityPricePairing(
  priceId: string | undefined,
): Promise<boolean> {
  if (!priceId) return true;
  const note = "one-tap pairing failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (await moderateCommunityPrice(priceId, true, note)) {
        const trust = await reconcilePriceTrustForObservation(priceId);
        return trust.status === "synced";
      }
    } catch (err) {
      log("warn", "one_tap_pint_drop.price_pairing_revert_failed", {
        priceId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log("warn", "one_tap_pint_drop.price_pairing_revert_failed", {
    priceId,
    error: "hide did not land",
  });
  return false;
}

/**
 * The Pint Drop half of a one-tap price submission from the venue sheet. Community
 * price is written first by the caller; this lane lands the paired row in
 * pint_drops through the existing Pint Drop store.
 */
export async function writeOneTapPintDrop(
  input: OneTapPintDropInput,
  photos: PintDropPhotos = { pint: null, venue: null },
): Promise<OneTapPintDropOutcome> {
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }

  try {
    const drop = await pintDropsStore().create(buildDrop(input), photos);
    void ensureProfileForHandle(handle);
    return { ok: true, drop };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Photo must")) {
      return { ok: false, kind: "invalid_photo", message: err.message };
    }
    log("error", "one_tap_pint_drop.create_failed", {
      venueId: input.venueId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }
}
