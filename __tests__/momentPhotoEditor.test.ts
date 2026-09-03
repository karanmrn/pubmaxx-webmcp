import { describe, expect, it } from "vitest";

import {
  MOMENT_MAX_PHOTO_BYTES,
  replaceMomentMediaWithEditedBlob,
  type EditedMomentPhotoResult,
} from "@/lib/momentPhotoEditor";
import * as momentPhotoEditor from "@/lib/momentPhotoEditor";
import type { MomentMediaDraft } from "@/lib/momentDraft";
import { validatePhoto } from "@/lib/pintDropsStore";

function media(overrides: Partial<MomentMediaDraft> = {}): MomentMediaDraft {
  return {
    id: "photo-1",
    type: "image",
    name: "night.jpg",
    mimeType: "image/jpeg",
    size: 10,
    blob: new Blob(["original"], { type: "image/jpeg" }),
    objectUrl: "blob:original",
    width: null,
    height: null,
    focalX: 0.5,
    focalY: 0.5,
    alt: "Friends outside the pub",
    ...overrides,
  };
}

function edited(blob: Blob): EditedMomentPhotoResult {
  return { blob };
}

describe("Moment photo editor output", () => {
  it("replaces selected photo bytes while preserving identity and alt text", () => {
    const original = media();
    const result = replaceMomentMediaWithEditedBlob(original, edited(new Blob(["edited"], { type: "image/jpeg" })));

    expect(result.error).toBeNull();
    expect(result.media.id).toBe(original.id);
    expect(result.media.alt).toBe(original.alt);
    expect(result.media.name).toBe("night-edited.jpg");
    expect(result.media.mimeType).toBe("image/jpeg");
    expect(result.media.size).toBe(6);
    expect(result.media.blob).not.toBe(original.blob);
    expect(result.media.objectUrl).toMatch(/^blob:/);
  });

  it("keeps original when editor output is outside upload constraints", () => {
    const original = media();
    const unsupported = replaceMomentMediaWithEditedBlob(
      original,
      edited(new Blob(["edited"], { type: "image/gif" })),
    );
    expect(unsupported.media).toBe(original);
    expect(unsupported.error).toMatch(/JPEG, PNG, or WebP/i);

    const oversized = replaceMomentMediaWithEditedBlob(
      original,
      edited(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/jpeg" })),
    );
    expect(oversized.media).toBe(original);
    expect(oversized.error).toMatch(/10MB/i);
  });

  it("accepts edited photos through the 10 MB upload boundary", () => {
    const accepted = new Blob([new Uint8Array(MOMENT_MAX_PHOTO_BYTES)], { type: "image/jpeg" });
    const rejected = new Blob([new Uint8Array(MOMENT_MAX_PHOTO_BYTES + 1)], { type: "image/jpeg" });
    const original = media();

    const acceptedResult = replaceMomentMediaWithEditedBlob(original, edited(accepted));
    const rejectedResult = replaceMomentMediaWithEditedBlob(original, edited(rejected));

    expect(acceptedResult.error).toBeNull();
    expect(acceptedResult.media.size).toBe(10 * 1024 * 1024);
    expect(rejectedResult.media).toBe(original);
    expect(rejectedResult.error).toMatch(/10MB/i);
    expect(validatePhoto(accepted.type, accepted.size, MOMENT_MAX_PHOTO_BYTES)).toBeNull();
    expect(validatePhoto(rejected.type, rejected.size, MOMENT_MAX_PHOTO_BYTES)).toMatch(/10MB/i);
  });
});

describe("first-party Moment decoration", () => {
  it("offers a closed filter set with an honest original option", () => {
    const filters = (momentPhotoEditor as typeof momentPhotoEditor & {
      MOMENT_PHOTO_FILTERS?: ReadonlyArray<{ id: string; label: string; canvas: string }>;
    }).MOMENT_PHOTO_FILTERS;

    expect(filters).toEqual([
      { id: "original", label: "Original", canvas: "none" },
      { id: "warm", label: "Warm", canvas: "saturate(1.12) contrast(1.04) sepia(0.12)" },
      { id: "mono", label: "Mono", canvas: "grayscale(1) contrast(1.08)" },
      { id: "night", label: "Night", canvas: "contrast(1.08) saturate(0.9) brightness(0.86)" },
    ]);
  });

  it("normalises drawing points inside the visible canvas", () => {
    const normalise = (momentPhotoEditor as typeof momentPhotoEditor & {
      normaliseMomentDrawPoint?: (
        point: { clientX: number; clientY: number },
        frame: { left: number; top: number; width: number; height: number },
      ) => { x: number; y: number };
    }).normaliseMomentDrawPoint;

    expect(typeof normalise).toBe("function");
    expect(normalise?.(
      { clientX: -20, clientY: 150 },
      { left: 0, top: 0, width: 100, height: 100 },
    )).toEqual({ x: 0, y: 1 });
  });

  it("keeps one drawing pointer authoritative until it ends", () => {
    const claim = (momentPhotoEditor as typeof momentPhotoEditor & {
      claimMomentDrawPointer?: (active: number | null, candidate: number) => number;
    }).claimMomentDrawPointer;
    const release = (momentPhotoEditor as typeof momentPhotoEditor & {
      releaseMomentDrawPointer?: (active: number | null, candidate: number) => number | null;
    }).releaseMomentDrawPointer;
    const mayAppend = (momentPhotoEditor as typeof momentPhotoEditor & {
      mayAppendMomentDrawPreview?: (active: number | null, candidate: number) => boolean;
    }).mayAppendMomentDrawPreview;

    expect(typeof claim).toBe("function");
    expect(typeof release).toBe("function");
    expect(typeof mayAppend).toBe("function");
    expect(claim?.(null, 7)).toBe(7);
    expect(claim?.(7, 8)).toBe(7);
    expect(release?.(7, 8)).toBe(7);
    expect(release?.(7, 7)).toBeNull();
    expect(mayAppend?.(null, 7)).toBe(true);
    expect(mayAppend?.(7, 8)).toBe(false);
  });

  it("rejects a failed canvas export instead of hanging", async () => {
    const encode = (momentPhotoEditor as typeof momentPhotoEditor & {
      encodeMomentPhoto?: (
        canvas: { toBlob: (callback: (blob: Blob | null) => void) => void },
      ) => Promise<Blob>;
    }).encodeMomentPhoto;

    expect(typeof encode).toBe("function");
    await expect(encode?.({ toBlob: (callback) => callback(null) })).rejects.toThrow(
      "Photo could not be saved.",
    );
  });

  it("rejects a synchronous canvas export failure", async () => {
    const encode = (momentPhotoEditor as typeof momentPhotoEditor & {
      encodeMomentPhoto?: (
        canvas: { toBlob: (callback: (blob: Blob | null) => void) => void },
      ) => Promise<Blob>;
    }).encodeMomentPhoto;

    expect(typeof encode).toBe("function");
    await expect(encode?.({
      toBlob: () => {
        throw new Error("canvas unavailable");
      },
    })).rejects.toThrow("Photo could not be saved.");
  });
});
