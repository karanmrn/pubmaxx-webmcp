import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  prepareSocialPhoto,
  SocialPhotoError,
  uploadPreparedSocialPhoto,
  purgeClaimedSocialPhotoRows,
  signSocialPhotoObject,
} from "@/lib/socialPostMedia.server";

async function imageFile(
  format: "jpeg" | "png" | "webp" = "png",
  width = 1_600,
  height = 800,
): Promise<File> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: "#7d2838" },
  });
  const bytes = await pipeline[format]().toBuffer();
  return new File([bytes], `night.${format === "jpeg" ? "jpg" : format}`, {
    type: `image/${format}`,
  });
}

describe("Social post private photo processing", () => {
  it("normalises one photo to bounded metadata-free JPEG and hashes final bytes", async () => {
    const prepared = await prepareSocialPhoto(await imageFile());
    const metadata = await sharp(prepared.bytes).metadata();

    expect(prepared).toMatchObject({
      contentType: "image/jpeg",
      width: 1_200,
      height: 600,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(prepared.byteSize).toBe(prepared.bytes.byteLength);
  });

  it("rejects mismatched magic bytes and excessive decoded pixels", async () => {
    const png = await imageFile("png", 40, 40);
    const mismatch = new File([await png.arrayBuffer()], "fake.jpg", {
      type: "image/jpeg",
    });
    await expect(prepareSocialPhoto(mismatch)).rejects.toMatchObject({
      code: "INVALID_TYPE",
    });

    await expect(prepareSocialPhoto(await imageFile("jpeg", 5_000, 5_000)))
      .rejects.toMatchObject({ code: "INVALID_DIMENSIONS" });
  });

  it("creates an identifier-free private media path on the server", async () => {
    const uploads: Array<{ path: string; contentType: string; bytes: Buffer }> = [];
    const result = await uploadPreparedSocialPhoto(
      "11111111-1111-4111-8111-111111111111",
      await prepareSocialPhoto(await imageFile("webp", 320, 240)),
      {
        upload: async (path, bytes, contentType) => {
          uploads.push({ path, bytes, contentType });
        },
        remove: async () => undefined,
        sign: async () => null,
      },
    );

    expect(result.mediaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.objectKey).toBe(
      `social/${result.mediaId}/${result.generation}/image.jpg`,
    );
    expect(result.objectKey).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      path: result.objectKey,
      contentType: "image/jpeg",
    });
    expect(uploads[0]?.bytes.equals(result.bytes)).toBe(true);
  });

  it("keeps the stable owner identifier out of moderation signed URLs", async () => {
    const owner = "11111111-1111-4111-8111-111111111111";
    const uploaded = await uploadPreparedSocialPhoto(owner, await prepareSocialPhoto(await imageFile("jpeg", 100, 100)), {
      upload: async () => undefined, remove: async () => undefined,
      sign: async (path) => `https://storage.test/${path}`,
    });
    const signed = await signSocialPhotoObject(uploaded.objectKey, {
      upload: async () => undefined, remove: async () => undefined,
      sign: async (path) => `https://storage.test/${path}`,
    });
    expect(signed).not.toContain(owner);
  });

  it("uses typed safe failures", () => {
    expect(new SocialPhotoError("INVALID_TYPE", "Bad photo")).toMatchObject({
      code: "INVALID_TYPE",
      message: "Bad photo",
    });
  });

  it("retries catalog deletion safely after object deletion succeeds", async () => {
    const removed: string[][] = [];
    let attempts = 0;
    const rows = [{
      mediaId: "media-a",
      generation: "generation-a",
      objectKey: "social/media-a/generation-a/image.jpg",
      cleanupToken: "token-a",
    }];
    const run = () => purgeClaimedSocialPhotoRows(rows, async (key) => { removed.push([key]); }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("database unavailable");
      return true;
    });
    await expect(run()).rejects.toThrow("database unavailable");
    await expect(run()).resolves.toBe(1);
    expect(removed).toEqual([
      ["social/media-a/generation-a/image.jpg"],
      ["social/media-a/generation-a/image.jpg"],
    ]);
  });

  it("continues a claimed cleanup batch after one item fails", async () => {
    const claims = ["a", "b"].map((suffix) => ({
      mediaId: `media-${suffix}`,
      generation: `generation-${suffix}`,
      objectKey: `social/media-${suffix}/generation-${suffix}/image.jpg`,
      cleanupToken: `token-${suffix}`,
    }));
    const finalized: string[] = [];
    await expect(purgeClaimedSocialPhotoRows(
      claims,
      async () => undefined,
      async (claim) => {
        finalized.push(claim.mediaId);
        if (claim.mediaId === "media-a") throw new Error("first finalizer unavailable");
        return true;
      },
    )).rejects.toThrow("first finalizer unavailable");
    expect(finalized).toEqual(["media-a", "media-b"]);
  });
});
