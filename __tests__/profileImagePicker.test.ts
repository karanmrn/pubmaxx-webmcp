// The photo picker policy and the crop arithmetic behind it.
//
// The defect this pins: the avatar input carried `capture="environment"`, which
// tells iOS to open the camera and to leave the photo library out of the sheet
// entirely. An iPhone owner was offered no way to reach a picture they already
// had. The accept list made the second half of it: iOS holds photos as HEIC and
// matches the accept list against the library's own types before converting
// anything, so a jpeg/png/webp list reads to it as "none of these qualify".
//
// The geometry below is the other half of the fix. It decides which pixels of a
// person's photo leave their phone, so it lives in a pure module and is checked
// here without a browser.

import { describe, expect, it } from "vitest";

import {
  centredCropTransform,
  clampCropScale,
  clampCropTransform,
  CROP_OUTPUT_QUALITY,
  CROP_OUTPUT_TYPE,
  CROP_CONFIRM_LABEL,
  cropFailedMessage,
  cropFrameLabel,
  cropOutputBox,
  cropScaleAtPosition,
  cropSourceRect,
  cropZoomPosition,
  croppedFileName,
  isLikelyHeic,
  MAX_CROP_ZOOM,
  maximumCropScale,
  minimumCropScale,
  PROFILE_IMAGE_PICKER_ACCEPT,
  scaleAboutPoint,
  unreadableImageMessage,
} from "@/lib/profileImagePicker";
import {
  profileImageOutputBox,
  PROFILE_IMAGE_SLOTS,
  profileImageSlotSpec,
} from "@/lib/profileImageSlots";

const AVATAR_FRAME = { width: 300, height: 300 };
const COVER_FRAME = { width: 390, height: 130 };

describe("what a profile photo picker offers", () => {
  it("names every type an iPhone can hand over, including HEIC", () => {
    const types = PROFILE_IMAGE_PICKER_ACCEPT.split(",");
    expect(types).toContain("image/jpeg");
    expect(types).toContain("image/png");
    expect(types).toContain("image/webp");
    expect(types).toContain("image/heic");
    expect(types).toContain("image/heif");
  });

  it("asks for photos rather than any file, so a picker offers no PDF", () => {
    expect(PROFILE_IMAGE_PICKER_ACCEPT).not.toContain("*");
    for (const type of PROFILE_IMAGE_PICKER_ACCEPT.split(",")) {
      expect(type.startsWith("image/")).toBe(true);
    }
  });

  it("exports nothing that could put a camera-only attribute on an input", () => {
    // The word may appear in this module's own reasoning, but no VALUE here may
    // ever be spread onto an input as `capture`.
    const source = PROFILE_IMAGE_PICKER_ACCEPT;
    expect(source).not.toMatch(/capture/i);
  });
});

describe("a HEIC photo is recognised by type or by name", () => {
  it("reads the iPhone types", () => {
    expect(isLikelyHeic({ type: "image/heic" })).toBe(true);
    expect(isLikelyHeic({ type: "image/heif" })).toBe(true);
    expect(isLikelyHeic({ type: "IMAGE/HEIC" })).toBe(true);
  });

  it("falls back to the file name when the browser declares nothing", () => {
    expect(isLikelyHeic({ type: "", name: "IMG_4021.HEIC" })).toBe(true);
    expect(isLikelyHeic({ type: "", name: "IMG_4021.heif" })).toBe(true);
  });

  it("leaves an ordinary photo alone", () => {
    expect(isLikelyHeic({ type: "image/jpeg", name: "face.jpg" })).toBe(false);
    expect(isLikelyHeic({})).toBe(false);
    // A name that merely mentions the word is not a HEIC file.
    expect(isLikelyHeic({ type: "image/png", name: "heic-notes.png" })).toBe(false);
  });
});

describe("the crop covers the frame at every scale", () => {
  it("takes its floor from the tighter edge", () => {
    // A wide photo in a square frame is constrained by its height.
    expect(minimumCropScale(AVATAR_FRAME, { width: 4000, height: 3000 })).toBeCloseTo(0.1);
    // A tall photo in a wide frame is constrained by its width.
    expect(minimumCropScale(COVER_FRAME, { width: 3000, height: 4000 })).toBeCloseTo(0.13);
  });

  it("lets a person zoom in but never back out past cover", () => {
    const natural = { width: 4000, height: 3000 };
    const min = minimumCropScale(AVATAR_FRAME, natural);
    expect(maximumCropScale(AVATAR_FRAME, natural)).toBeCloseTo(min * MAX_CROP_ZOOM);
    expect(clampCropScale(min / 10, AVATAR_FRAME, natural)).toBeCloseTo(min);
    expect(clampCropScale(min * 1000, AVATAR_FRAME, natural)).toBeCloseTo(min * MAX_CROP_ZOOM);
    expect(clampCropScale(Number.NaN, AVATAR_FRAME, natural)).toBeCloseTo(min);
  });

  it("refuses to let a drag pull an edge into the frame", () => {
    const natural = { width: 4000, height: 3000 };
    const dragged = clampCropTransform(
      { scale: minimumCropScale(AVATAR_FRAME, natural), offsetX: 9_000, offsetY: -9_000 },
      AVATAR_FRAME,
      natural,
    );
    expect(dragged.offsetX).toBe(0);
    expect(dragged.offsetY).toBeCloseTo(AVATAR_FRAME.height - natural.height * dragged.scale);
    expect(dragged.offsetX).toBeLessThanOrEqual(0);
    expect(dragged.offsetX + natural.width * dragged.scale).toBeGreaterThanOrEqual(
      AVATAR_FRAME.width,
    );
  });

  it("opens centred on the photo", () => {
    const natural = { width: 4000, height: 3000 };
    const opened = centredCropTransform(AVATAR_FRAME, natural);
    const rect = cropSourceRect(opened, AVATAR_FRAME, natural);
    expect(rect.sw).toBeCloseTo(3000);
    expect(rect.sh).toBeCloseTo(3000);
    expect(rect.sx).toBeCloseTo(500);
    expect(rect.sy).toBeCloseTo(0);
  });

  it("survives a photo that has not measured yet", () => {
    const zero = { width: 0, height: 0 };
    expect(() => centredCropTransform(AVATAR_FRAME, zero)).not.toThrow();
    expect(cropSourceRect({ scale: 1, offsetX: 0, offsetY: 0 }, AVATAR_FRAME, zero).sw).toBe(1);
  });
});

describe("the rectangle that uploads is the rectangle on screen", () => {
  it("reads back the frame's own shape in natural pixels", () => {
    const natural = { width: 2000, height: 3000 };
    const transform = centredCropTransform(COVER_FRAME, natural);
    const rect = cropSourceRect(transform, COVER_FRAME, natural);
    expect(rect.sw / rect.sh).toBeCloseTo(COVER_FRAME.width / COVER_FRAME.height, 5);
  });

  it("shrinks the source as a person zooms in", () => {
    const natural = { width: 2000, height: 2000 };
    const opened = centredCropTransform(AVATAR_FRAME, natural);
    const zoomed = scaleAboutPoint(
      opened,
      opened.scale * 2,
      { x: AVATAR_FRAME.width / 2, y: AVATAR_FRAME.height / 2 },
      AVATAR_FRAME,
      natural,
    );
    const before = cropSourceRect(opened, AVATAR_FRAME, natural);
    const after = cropSourceRect(zoomed, AVATAR_FRAME, natural);
    expect(after.sw).toBeCloseTo(before.sw / 2);
    expect(after.sh).toBeCloseTo(before.sh / 2);
  });

  it("keeps the pixel under a pinch where the fingers left it", () => {
    const natural = { width: 2000, height: 2000 };
    const opened = centredCropTransform(AVATAR_FRAME, natural);
    const anchor = { x: 80, y: 220 };
    const naturalUnderAnchor = {
      x: (anchor.x - opened.offsetX) / opened.scale,
      y: (anchor.y - opened.offsetY) / opened.scale,
    };
    const zoomed = scaleAboutPoint(opened, opened.scale * 3, anchor, AVATAR_FRAME, natural);
    expect(zoomed.offsetX + naturalUnderAnchor.x * zoomed.scale).toBeCloseTo(anchor.x, 4);
    expect(zoomed.offsetY + naturalUnderAnchor.y * zoomed.scale).toBeCloseTo(anchor.y, 4);
  });

  it("never reads outside the photo, however hard it is dragged", () => {
    const natural = { width: 1200, height: 900 };
    for (const offsetX of [-99_999, -50, 0, 99_999]) {
      for (const offsetY of [-99_999, -50, 0, 99_999]) {
        const rect = cropSourceRect(
          { scale: minimumCropScale(COVER_FRAME, natural) * 2, offsetX, offsetY },
          COVER_FRAME,
          natural,
        );
        expect(rect.sx).toBeGreaterThanOrEqual(0);
        expect(rect.sy).toBeGreaterThanOrEqual(0);
        expect(rect.sx + rect.sw).toBeLessThanOrEqual(natural.width + 1e-6);
        expect(rect.sy + rect.sh).toBeLessThanOrEqual(natural.height + 1e-6);
      }
    }
  });
});

describe("the zoom control and the scale agree", () => {
  it("runs from cover to the ceiling and back", () => {
    const natural = { width: 4000, height: 3000 };
    expect(cropScaleAtPosition(0, AVATAR_FRAME, natural)).toBeCloseTo(
      minimumCropScale(AVATAR_FRAME, natural),
    );
    expect(cropScaleAtPosition(1, AVATAR_FRAME, natural)).toBeCloseTo(
      maximumCropScale(AVATAR_FRAME, natural),
    );
    for (const position of [0, 0.25, 0.5, 1]) {
      const scale = cropScaleAtPosition(position, AVATAR_FRAME, natural);
      expect(cropZoomPosition(scale, AVATAR_FRAME, natural)).toBeCloseTo(position, 6);
    }
  });

  it("stays inside its track for a position it was never given", () => {
    const natural = { width: 4000, height: 3000 };
    expect(cropZoomPosition(0, AVATAR_FRAME, natural)).toBe(0);
    expect(cropScaleAtPosition(Number.NaN, AVATAR_FRAME, natural)).toBeCloseTo(
      minimumCropScale(AVATAR_FRAME, natural),
    );
  });
});

describe("what the crop writes", () => {
  it("renders into each slot's own box, taken from the slot table", () => {
    expect(cropOutputBox("avatar")).toEqual({ width: 512, height: 512 });
    expect(cropOutputBox("cover")).toEqual({ width: 1600, height: 533 });
    for (const slot of PROFILE_IMAGE_SLOTS) {
      const box = cropOutputBox(slot);
      const spec = profileImageSlotSpec(slot);
      expect(box).toEqual(profileImageOutputBox(slot));
      expect(box.width).toBe(spec.outputWidth);
      // The output box IS the slot's advertised shape, so the composer's frame
      // and the header's frame cannot disagree about what was cropped.
      expect(box.width / box.height).toBeCloseTo(spec.aspectRatio, 2);
    }
  });

  it("hands the upload route a JPEG, which is what the server stores", () => {
    expect(CROP_OUTPUT_TYPE).toBe("image/jpeg");
    expect(CROP_OUTPUT_QUALITY).toBeGreaterThan(0.8);
    expect(CROP_OUTPUT_QUALITY).toBeLessThanOrEqual(1);
    expect(croppedFileName("avatar")).toBe("avatar.jpg");
    expect(croppedFileName("cover")).toBe("cover.jpg");
  });
});

describe("the copy tells a person what to do next", () => {
  it("says where to go when a browser cannot open a HEIC photo", () => {
    const message = unreadableImageMessage("avatar", true);
    expect(message).toContain("Photos");
    expect(message).toContain("JPEG");
    expect(message).not.toMatch(/error|failed|unsupported/i);
  });

  it("offers another photo when the file is simply unreadable", () => {
    expect(unreadableImageMessage("cover", false)).toBe(
      "Could not open that cover photo. Choose another one.",
    );
  });

  it("keeps every line free of a dash construction and a shout", () => {
    const lines = [
      CROP_CONFIRM_LABEL,
      ...PROFILE_IMAGE_SLOTS.flatMap((slot) => [
        cropFrameLabel(slot),
        cropFailedMessage(slot),
        unreadableImageMessage(slot, true),
        unreadableImageMessage(slot, false),
      ]),
    ];
    for (const line of lines) {
      expect(line).not.toContain("—");
      expect(line).not.toContain(" – ");
      expect(line).not.toContain("!");
      expect(line.trim()).toBe(line);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("says one short thing on the button, whichever slot it is", () => {
    // A per-slot label ("Use cover photo") was wide enough to push Cancel onto
    // a line of its own at 390px, and the frame above already shows the shape.
    expect(CROP_CONFIRM_LABEL).toBe("Use photo");
  });

  it("puts the instruction in the frame's name rather than in a subtitle", () => {
    // The slot's own visible label already says "Profile photo" / "Cover
    // photo", so a visible "Position your photo" under it is a subtitle
    // repeating its label. A keyboard user still gets told the arrows work.
    expect(cropFrameLabel("avatar")).toContain("arrow keys");
    expect(cropFrameLabel("avatar")).toContain("photo");
    expect(cropFrameLabel("cover")).toContain("cover photo");
  });
});
