import "server-only";

import type {
  CreatorListDiscoveryItem,
  CreatorListDiscoveryResult,
  CreatorListProfile,
} from "@/lib/creatorListDiscovery";
import { creatorListMapHref } from "@/lib/creatorListMap";
import {
  isProfileTombstoned,
  profileStore,
  publicOwnedImageUrl,
} from "@/lib/profileStore";
import { PLAN_QUERY_PARAM } from "@/lib/planOccasion";
import { savedListPath } from "@/lib/savedListUrl";
import {
  cleanListType,
  savedPubsStore,
  type SavedPubDTO,
} from "@/lib/savedPubsStore";

export type CreatorListSavedRead =
  | SavedPubDTO[]
  | { status: "unavailable" };

const PREVIEW_VENUE_LIMIT = 3;

export type CreatorListDiscoveryDependencies = {
  listProfiles(input: {
    limit: number;
    afterHandle?: string;
  }): Promise<CreatorListProfile[]>;
  listSavedByHandles(input: {
    handles: readonly string[];
  }): Promise<ReadonlyMap<string, CreatorListSavedRead>>;
};

function savedListReadIsUnavailable(
  value: CreatorListSavedRead | undefined,
): value is { status: "unavailable" } {
  return Boolean(value) && !Array.isArray(value);
}

type CreatorListDiscoveryInput = {
  limit: number;
  afterHandle?: string;
};

function creatorListPlanUrl(handle: string, listType: string): string {
  const params = new URLSearchParams();
  params.set(PLAN_QUERY_PARAM, `Plan ${listType} by @${handle}`);
  return `/plan?${params.toString()}`;
}

function listsForProfile(
  profile: CreatorListProfile,
  saved: SavedPubDTO[],
): CreatorListDiscoveryItem[] {
  const grouped = new Map<string, SavedPubDTO[]>();
  for (const row of saved) {
    const listType = cleanListType(row.listType);
    if (!listType) continue;
    const rows = grouped.get(listType) ?? [];
    rows.push(row);
    grouped.set(listType, rows);
  }

  return Array.from(grouped).flatMap(([listType, rows]) => {
    const mapUrl = creatorListMapHref(rows);
    if (!mapUrl) return [];
    return [{
      ownerHandle: profile.handle,
      ...(profile.displayName ? { ownerDisplayName: profile.displayName } : {}),
      ...(profile.avatarUrl ? { ownerAvatarUrl: profile.avatarUrl } : {}),
      listType,
      listUrl: savedListPath(profile.handle, listType),
      mapUrl,
      planUrl: creatorListPlanUrl(profile.handle, listType),
      savedCount: rows.length,
      updatedAt: rows[0]!.savedAt,
      previewVenues: rows.slice(0, PREVIEW_VENUE_LIMIT).map((row) => ({
        venueId: row.venueId,
        venueName: row.venueName,
        venueMapUrl: row.venueMapUrl,
      })),
    }];
  });
}

export async function discoverCreatorLists(
  input: CreatorListDiscoveryInput,
  dependencies: CreatorListDiscoveryDependencies,
): Promise<CreatorListDiscoveryResult> {
  const profiles = await dependencies.listProfiles({
    limit: input.limit + 1,
    ...(input.afterHandle ? { afterHandle: input.afterHandle } : {}),
  });
  const examined = profiles.slice(0, input.limit);
  const nextCursor = profiles.length > examined.length && examined.length > 0
    ? examined[examined.length - 1]!.handle
    : null;
  const savedByProfile = await dependencies.listSavedByHandles({
    handles: examined.map((profile) => profile.handle),
  });
  let unavailableCount = 0;
  const lists = examined.flatMap((profile) => {
    const saved = savedByProfile.get(profile.handle);
    if (savedListReadIsUnavailable(saved)) {
      unavailableCount += 1;
      return [];
    }
    return listsForProfile(profile, saved ?? []);
  });

  return {
    status: unavailableCount > 0 ? "degraded" : "ready",
    lists,
    nextCursor,
  };
}

export const creatorListDiscoveryDependencies: CreatorListDiscoveryDependencies = {
  async listProfiles(input) {
    const profiles = await profileStore().listClaimedProfiles(input);
    return profiles
      .filter((profile) => Boolean(profile.userId) && !isProfileTombstoned(profile))
      .map((profile) => {
        const avatarUrl = publicOwnedImageUrl(profile, "avatar");
        return {
          handle: profile.handle,
          ...(profile.displayName ? { displayName: profile.displayName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        };
      });
  },
  async listSavedByHandles({ handles }) {
    const reads = await savedPubsStore().readSavedByHandles({ handles });
    return new Map(
      [...reads].map(([handle, read]) => [
        handle,
        read.status === "ready" ? read.rows : { status: "unavailable" },
      ]),
    );
  },
};
