import { describe, expect, it } from "vitest";

import {
  parseSocialCreateSubmission,
  parseSocialEditSubmission,
} from "@/lib/socialPostSubmission";

describe("Social post submission boundary", () => {
  it("accepts one server-owned photo with required alt text and normalised tag proposals", () => {
    expect(parseSocialCreateSubmission({
      kind: "standard",
      visibility: "friends",
      body: "",
      commentPolicy: "friends",
      photoAltText: "  Alice outside the Venue  ",
      tagHandles: ["@Bob", "bob", "@CAROL"],
    }, true)).toEqual({
      ok: true,
      post: {
        kind: "standard",
        visibility: "friends",
        body: "",
        area: null,
        venueId: null,
        hashtags: [],
        commentPolicy: "friends",
      },
      photoAltText: "Alice outside the Venue",
      tagHandles: ["bob", "carol"],
    });
  });

  it("rejects tags without a photo, missing alt text, and client media keys", () => {
    expect(parseSocialCreateSubmission({
      kind: "standard",
      visibility: "friends",
      body: "Words",
      commentPolicy: "friends",
      tagHandles: ["bob"],
    }, false)).toMatchObject({ ok: false, code: "INVALID_TAGS" });
    expect(parseSocialCreateSubmission({
      kind: "standard",
      visibility: "friends",
      body: "Words",
      commentPolicy: "friends",
    }, true)).toMatchObject({ ok: false, code: "PHOTO_ALT_REQUIRED" });
    expect(parseSocialCreateSubmission({
      kind: "standard",
      visibility: "friends",
      body: "Words",
      commentPolicy: "friends",
      mediaId: "11111111-1111-4111-8111-111111111111",
      objectKey: "social/forged/image.jpg",
    }, false)).toMatchObject({ ok: false, code: "INVALID_POST" });
  });

  it("requires feature-request text even when a photo is attached", () => {
    expect(parseSocialCreateSubmission({
      kind: "feature_request",
      visibility: "public",
      body: "",
      commentPolicy: "open",
      photoAltText: "Sketch of the feature",
    }, true)).toMatchObject({ ok: false, code: "FEATURE_REQUEST_BODY_REQUIRED" });
  });

  it("parses edit CAS and explicit photo removal without accepting a media reference", () => {
    expect(parseSocialEditSubmission({
      expectedMutationVersion: 7,
      visibility: "public",
      removePhoto: true,
    }, false)).toEqual({
      ok: true,
      expectedMutationVersion: 7,
      changes: { visibility: "public" },
      moderationSensitive: true,
      removePhoto: true,
      photoAltText: null,
      tagHandles: [],
    });
    expect(parseSocialEditSubmission({
      expectedMutationVersion: 7,
      photo: { mediaId: "11111111-1111-4111-8111-111111111111" },
    }, false)).toMatchObject({ ok: false, code: "INVALID_POST" });
    expect(parseSocialEditSubmission({
      expectedMutationVersion: 7,
      body: "Words",
      tagHandles: ["bob"],
    }, false)).toMatchObject({ ok: false, code: "INVALID_TAGS" });
    expect(parseSocialEditSubmission({
      expectedMutationVersion: 7,
      photoAltText: "  Corrected description  ",
    }, false)).toEqual({
      ok: true,
      expectedMutationVersion: 7,
      changes: {},
      moderationSensitive: true,
      removePhoto: false,
      photoAltText: "Corrected description",
      tagHandles: [],
    });
  });
});
