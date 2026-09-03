import { normalizeHandle } from "@/lib/profiles";
import {
  isProfileTombstoned,
  profileStore,
  type ProfileRecord,
} from "@/lib/profileStore";

export type AvatarUrlMap = ReadonlyMap<string, string>;

// avatarInitialFromHandle now lives in lib/profiles.ts so a client avatar can
// import it without dragging the profile store (and node:crypto) into the
// browser bundle. Re-exported here for the server callers already using it.
export { avatarInitialFromHandle } from "@/lib/profiles";

/** Only a claimed, live profile may wear an uploaded avatar in public surfaces. */
export function profileMayWearAvatar(
  profile: Pick<ProfileRecord, "userId" | "tombstonedAt"> | null | undefined,
): boolean {
  if (!profile?.userId?.trim()) return false;
  return !isProfileTombstoned(profile);
}

/** Batch handle → served URL map in one store query. Unlinked handles are omitted. */
export async function resolveAvatarUrlsForHandles(
  handles: readonly string[],
): Promise<AvatarUrlMap> {
  const keys = [...new Set(handles.map((handle) => normalizeHandle(handle)).filter(Boolean))];
  if (keys.length === 0) return new Map();
  return profileStore().getApprovedAvatarUrlsByHandles(keys);
}

export function attachAvatarUrls<T extends { handle: string }>(
  items: readonly T[],
  urls: AvatarUrlMap,
): Array<T & { avatarUrl?: string }> {
  return items.map((item) => {
    const key = normalizeHandle(item.handle);
    const avatarUrl = key ? urls.get(key) : undefined;
    return avatarUrl ? { ...item, avatarUrl } : { ...item };
  });
}

export async function enrichItemsWithAvatarUrls<T extends { handle: string }>(
  items: readonly T[],
): Promise<Array<T & { avatarUrl?: string }>> {
  if (items.length === 0) return [];
  const urls = await resolveAvatarUrlsForHandles(items.map((item) => item.handle));
  return attachAvatarUrls(items, urls);
}
