"use client";

// The face and the name on an account card, from the account's own public
// profile. ONE reader, because the nav card and the account switcher both name
// people and a second copy of this read is a second answer.
//
// It is the ordinary public profile GET, so it discloses nothing a visitor could
// not already read, and a failure is silence rather than a wrong name.

import { handleOnly } from "@/lib/handleDisplay";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

export type PublicProfileCard = { displayName?: string; avatarUrl?: string };

/** The public card for a handle, or null when the read did not answer. */
export async function loadPublicProfileCard(
  handle: string,
  signal?: AbortSignal,
): Promise<PublicProfileCard | null> {
  let card: PublicProfileCard | null = null;
  let answered = false;
  const outcome = await loadSurfaceJson<{
    profile?: { displayName?: string; avatarUrl?: string } | null;
  }>(
    `/api/profiles/${encodeURIComponent(handleOnly(handle))}`,
    {
      signal,
      validate: (body) => Boolean(body && typeof body === "object" && "profile" in body),
    },
    (body) => {
      answered = true;
      card = {
        ...(body.profile?.displayName ? { displayName: body.profile.displayName } : {}),
        ...(body.profile?.avatarUrl ? { avatarUrl: body.profile.avatarUrl } : {}),
      };
    },
  );
  return outcome === "failed" && !answered ? null : card;
}
