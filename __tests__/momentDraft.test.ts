import { describe, expect, it } from "vitest";

import {
  createMomentDraft,
  selectMomentMedia,
  type MomentMediaDraft,
} from "@/lib/momentDraft";

function media(id: string, type: MomentMediaDraft["type"]): MomentMediaDraft {
  return {
    id,
    type,
    name: `${id}.${type === "video" ? "mp4" : "jpg"}`,
    mimeType: type === "video" ? "video/mp4" : "image/jpeg",
    size: 100,
    blob: new Blob([id], { type: type === "video" ? "video/mp4" : "image/jpeg" }),
    objectUrl: null,
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    alt: "",
  };
}

describe("Moment drafts", () => {
  it("starts private and carries a stable versioned owner key", () => {
    const draft = createMomentDraft("profile-123", "draft-1", "2026-07-15T12:00:00.000Z");
    expect(draft).toMatchObject({
      version: 1,
      id: "draft-1",
      ownerKey: "profile-123",
      serverMemoryId: null,
      visibility: "private",
      media: [],
    });
  });

  it("allows four photos but never mixes video with photos", () => {
    const photos = [media("1", "image"), media("2", "image"), media("3", "image"), media("4", "image")];
    expect(selectMomentMedia([], photos)).toEqual({ media: photos, error: null });
    expect(selectMomentMedia(photos, [media("5", "image")]).error).toMatch(/four/i);
    expect(selectMomentMedia([], [media("v", "video"), media("1", "image")]).error).toMatch(/video/i);
  });
});
