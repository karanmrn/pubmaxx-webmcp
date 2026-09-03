import "server-only";

import { hashActor } from "@/lib/supabase";

/**
 * Per-venue pseudonym for one verified PUBMAXX User ID.
 *
 * The key proves independence for Pint Price corroboration without exposing the
 * account id or making the public feed linkable across venues. An anonymous
 * submission has no verified actor and therefore remains provisional.
 */
export function pintDropAuthorityKey(
  venueId: string,
  verifiedActor: string | null | undefined,
): string | undefined {
  const venue = venueId.trim();
  const actor = verifiedActor?.trim();
  if (!venue || !actor) return undefined;
  return hashActor(`pint-drop-authority:${venue}:${actor}`);
}
