import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => ({
    status: "found",
    canonicalId: id,
    venue: { id, name: "The Venue", kind: "pub" },
  }),
}));

import { projectSocialVenueName } from "@/lib/socialPostVenue.server";
import type { SocialPostDTO } from "@/lib/socialPosts";

const base = {
  id: "post-a",
  kind: "standard",
  visibility: "public",
  body: "At the Venue",
  area: null,
  venueId: "venue-a",
  venueName: null,
  venueProjected: true,
  hashtags: [],
  commentPolicy: "open",
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 0,
  mutationVersion: 0,
  editedAt: null,
  createdAt: "2026-08-05T12:00:00.000Z",
  updatedAt: "2026-08-05T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: false,
} satisfies SocialPostDTO;

describe("Social Venue name projection", () => {
  it("resolves a real label only after exact Venue authority", async () => {
    await expect(projectSocialVenueName({ ...base, ownedByViewer: true })).resolves.toMatchObject({
      venueId: "venue-a", venueName: "The Venue", ownedByViewer: true,
    });
    await expect(projectSocialVenueName({
      ...base, venueId: null, venueProjected: false,
    })).resolves.toMatchObject({ venueId: null, venueName: null, venueProjected: false });
  });
});
