import { describe, expect, it } from "vitest";

import {
  socialPostDTO,
  socialPostModerationClaim,
  validateSocialPostCreate,
  validateSocialPostEdit,
} from "@/lib/socialPosts";

describe("Social post validation", () => {
  it("uses the same canonical photo-only moderation claim as SQL", () => {
    expect(socialPostModerationClaim({ body: "", hashtags: [], photo: { mediaId: "media", altText: "Friends outside" } }))
      .toBe("Photo: Friends outside");
  });
  it("normalises a standard post without accepting ownership or moderation fields", () => {
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "  Last orders in Camden  ",
      area: "camden",
      venueId: "venue-1",
      hashtags: ["#LastOrders", "camden", "lastorders"],
      commentPolicy: "friends",
    })).toEqual({
      ok: true,
      value: {
        kind: "standard",
        visibility: "friends",
        body: "Last orders in Camden",
        area: "camden",
        venueId: "venue-1",
        hashtags: ["lastorders", "camden"],
        commentPolicy: "friends",
        photo: null,
      },
    });

    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "Nope",
      commentPolicy: "open",
      authorProfileId: "forged",
    })).toMatchObject({ ok: false, code: "INVALID_POST" });
  });

  it("requires body when no trusted server photo exists and permits a public canonical Venue", () => {
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "",
      commentPolicy: "open",
    })).toMatchObject({ ok: false });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "At the pub",
      venueId: "venue-1",
      commentPolicy: "open",
    })).toMatchObject({ ok: true, value: { venueId: "venue-1" } });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "Photo",
      photo: { mediaId: "11111111-1111-4111-8111-111111111111", altText: "A pub sign" },
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "INVALID_POST" });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "open",
    }, {
      trustedPhoto: {
        mediaId: "11111111-1111-4111-8111-111111111111",
        altText: "A pub sign",
      },
    })).toMatchObject({
      ok: true,
      value: {
        body: "",
        photo: {
          mediaId: "11111111-1111-4111-8111-111111111111",
          altText: "A pub sign",
        },
      },
    });
  });

  it("requires feature-request text and rejects unknown areas", () => {
    expect(validateSocialPostCreate({
      kind: "feature_request",
      visibility: "public",
      body: "",
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "FEATURE_REQUEST_BODY_REQUIRED" });
    expect(validateSocialPostCreate({
      kind: "standard",
      visibility: "public",
      body: "Hello",
      area: "made-up-area",
      commentPolicy: "open",
    })).toMatchObject({ ok: false, code: "INVALID_AREA" });
  });

  it("requires a client-observed mutation version and marks only moderation-sensitive fields", () => {
    expect(validateSocialPostEdit({ expectedMutationVersion: 3, visibility: "private" })).toEqual({
      ok: true,
      value: { visibility: "private" },
      expectedMutationVersion: 3,
      moderationSensitive: false,
    });
    expect(validateSocialPostEdit({ expectedMutationVersion: 3, body: "Changed words" })).toEqual({
      ok: true,
      value: { body: "Changed words" },
      expectedMutationVersion: 3,
      moderationSensitive: true,
    });
    expect(validateSocialPostEdit({ visibility: "private" })).toMatchObject({
      ok: false,
      code: "INVALID_POST",
    });
    expect(validateSocialPostEdit({ expectedMutationVersion: 3, photo: null })).toMatchObject({
      ok: false,
      code: "INVALID_POST",
    });
  });

  it("projects an exact Venue only when reader authority was proven", () => {
    const post = {
      id: "11111111-1111-4111-8111-111111111111",
      authorProfileId: "profile-a",
      authorHandle: "alice",
      kind: "standard" as const,
      visibility: "public" as const,
      body: "At the Venue",
      area: "camden" as const,
      venueId: "venue-1",
      hashtags: [],
      commentPolicy: "open" as const,
      photo: null,
      status: "visible" as const,
      moderationState: "approved" as const,
      featureRequest: null,
      revision: 0,
      mutationVersion: 0,
      editedAt: null,
      moderatedAt: "2026-08-05T12:00:00.000Z",
      createdAt: "2026-08-05T12:00:00.000Z",
      updatedAt: "2026-08-05T12:00:00.000Z",
    };

    expect(socialPostDTO(post, { exactVenue: false, viewerProfileId: "other-profile" })).toMatchObject({
      venueId: null,
      venueName: null,
      venueProjected: false,
      ownedByViewer: false,
    });
    expect(socialPostDTO(post, { exactVenue: true, viewerProfileId: post.authorProfileId, venueName: "The Venue" })).toMatchObject({
      venueId: "venue-1",
      venueName: "The Venue",
      venueProjected: true,
      ownedByViewer: true,
    });
  });
});
