// JWT-derived viewer identity for friends-gated pint drop reads (issue #29).
// Lives outside lib/authServer.ts so tests can mock callerUserId at the import
// boundary (internal same-module calls are not mockable in Vitest).

import { callerUserId } from "@/lib/authServer";
import { followStore } from "@/lib/followStore";
import { normalizeViewerHandle, type ViewerContext } from "@/lib/pintDrops";
import { profileStore } from "@/lib/profileStore";

export type ResolvedViewer = {
  handle: string | null;
  authenticated: boolean;
};

/**
 * Resolve the caller's verified profile handle from a request JWT, or null when
 * anonymous / unlinked / auth is unconfigured. Never trusts a handle from the
 * query/body — only a validated token + profiles.user_id lookup.
 */
export async function resolveViewerFromRequest(request: Request): Promise<ResolvedViewer> {
  const userId = await callerUserId(request);
  if (!userId) {
    return { handle: null, authenticated: false };
  }
  try {
    const profile = await profileStore().getByUserId(userId);
    return { handle: profile?.handle ?? null, authenticated: true };
  } catch {
    return { handle: null, authenticated: true };
  }
}

/** Dev/test only: allow self-asserted ?viewer= when JWT does not resolve. */
function allowQueryViewerFallback(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/**
 * Build a friends-gating ViewerContext from a verified JWT (preferred) with an
 * optional dev/test ?viewer= fallback. In production, ?viewer= alone never
 * unlocks the friends lane — only a JWT that resolves to a profile handle can.
 */
export async function resolveViewerContextFromRequest(
  request: Request,
  queryViewer?: string | null,
): Promise<ViewerContext | undefined> {
  const resolved = await resolveViewerFromRequest(request);
  let handle = resolved.handle ? normalizeViewerHandle(resolved.handle) : "";

  if (!handle && allowQueryViewerFallback() && queryViewer) {
    handle = normalizeViewerHandle(queryViewer);
  }

  if (!handle) return undefined;

  try {
    const [following, mutuals] = await Promise.all([
      followStore().listFollowing(handle),
      followStore().listMutuals(handle),
    ]);
    return {
      handle,
      followingHandles: new Set(following.map(normalizeViewerHandle).filter(Boolean)),
      mutualHandles: new Set(mutuals.map(normalizeViewerHandle).filter(Boolean)),
    };
  } catch {
    return { handle };
  }
}
