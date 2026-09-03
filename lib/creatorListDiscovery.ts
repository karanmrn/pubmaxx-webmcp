export type CreatorListProfile = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

export type CreatorListPreviewVenue = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
};

export type CreatorListDiscoveryItem = {
  ownerHandle: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  listType: string;
  listUrl: string;
  mapUrl: string;
  planUrl: string;
  savedCount: number;
  updatedAt: string;
  previewVenues: CreatorListPreviewVenue[];
};

export type CreatorListDiscoveryResult = {
  status: "ready" | "degraded";
  lists: CreatorListDiscoveryItem[];
  nextCursor: string | null;
};
