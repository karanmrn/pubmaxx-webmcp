// What a profile photo picker is allowed to offer, and the geometry of the
// crop step that follows it. Pure and browser-safe on purpose: no DOM, no
// canvas, no node builtins, so the arithmetic that decides which pixels leave
// the phone is unit-testable without a browser.
//
// TWO rules live here, and the first one is why this file exists.
//
// 1. A picker asks for a photo, it never asks for a camera. `capture` on a file
//    input tells iOS to open the camera and to leave the photo library out of
//    the sheet entirely, so an iPhone owner is offered no way to reach a photo
//    they already took. The avatar input carried `capture="environment"` and
//    the founder could therefore never choose an existing picture. There is no
//    seam for it here: nothing exports a capture attribute, and
//    `__tests__/profilePhotoPicker.test.ts` fails the tree if one comes back.
//
// 2. The accept list has to name what an iPhone actually holds. iOS stores
//    photos as HEIC, and Safari matches the accept list against the library's
//    own types before any conversion happens, so a list of jpeg/png/webp reads
//    to it as "none of these pictures qualify". The list below names HEIC and
//    HEIF as well, which is safe because the crop step re-encodes every chosen
//    photo to JPEG before it reaches the upload route. The server allow-list in
//    lib/profileImageMedia.server.ts stays exactly three types.

import {
  profileImageOutputBox,
  profileImageSlotSpec,
  type ProfileImageSlot,
} from "@/lib/profileImageSlots";

/**
 * The `accept` every profile photo input carries. JPEG, PNG and WebP are what
 * the server stores; HEIC and HEIF are what an iPhone hands over, and the crop
 * step converts them. No wildcard, so a person is not offered a PDF, and no
 * `capture` anywhere near it.
 */
export const PROFILE_IMAGE_PICKER_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif";

/** What the crop step writes: the only thing the upload routes ever receive. */
export const CROP_OUTPUT_TYPE = "image/jpeg";
export const CROP_OUTPUT_QUALITY = 0.9;

/** How far past "just covers the frame" a person may zoom in. */
export const MAX_CROP_ZOOM = 6;

export type CropBox = { readonly width: number; readonly height: number };
export type CropTransform = {
  /** Natural pixels to frame pixels. */
  readonly scale: number;
  /** Frame coordinate of the image's top-left corner. */
  readonly offsetX: number;
  readonly offsetY: number;
};
export type CropSourceRect = {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
};

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSIONS = /\.(heic|heif)$/i;

/**
 * Whether the chosen file is the format an iPhone hands over by default. Used
 * only to pick the honest sentence when a browser cannot decode it: the crop
 * step tries every file the same way and never refuses one on its name.
 */
export function isLikelyHeic(file: { type?: string; name?: string }): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (HEIC_TYPES.has(type)) return true;
  return HEIC_EXTENSIONS.test(file.name ?? "");
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function usable(box: CropBox): boolean {
  return positive(box.width) && positive(box.height);
}

/**
 * The smallest scale at which the photo still covers the whole frame. Below it
 * a crop would print bare background, so it is the floor for every gesture.
 */
export function minimumCropScale(frame: CropBox, natural: CropBox): number {
  if (!usable(frame) || !usable(natural)) return 1;
  return Math.max(frame.width / natural.width, frame.height / natural.height);
}

export function maximumCropScale(frame: CropBox, natural: CropBox): number {
  return minimumCropScale(frame, natural) * MAX_CROP_ZOOM;
}

export function clampCropScale(
  scale: number,
  frame: CropBox,
  natural: CropBox,
): number {
  const min = minimumCropScale(frame, natural);
  const max = maximumCropScale(frame, natural);
  if (!Number.isFinite(scale)) return min;
  return Math.min(Math.max(scale, min), max);
}

/**
 * Pull a transform back inside the frame: never zoomed out past cover, never
 * dragged far enough to show an edge.
 */
export function clampCropTransform(
  transform: CropTransform,
  frame: CropBox,
  natural: CropBox,
): CropTransform {
  const scale = clampCropScale(transform.scale, frame, natural);
  if (!usable(frame) || !usable(natural)) {
    return { scale, offsetX: 0, offsetY: 0 };
  }
  const drawnWidth = natural.width * scale;
  const drawnHeight = natural.height * scale;
  const minX = frame.width - drawnWidth;
  const minY = frame.height - drawnHeight;
  const offsetX = Number.isFinite(transform.offsetX) ? transform.offsetX : 0;
  const offsetY = Number.isFinite(transform.offsetY) ? transform.offsetY : 0;
  return {
    scale,
    // minX is <= 0 whenever the photo covers the frame, so this reads as
    // "between the far edge and the near edge" rather than a min/max swap.
    offsetX: Math.min(Math.max(offsetX, minX), 0),
    offsetY: Math.min(Math.max(offsetY, minY), 0),
  };
}

/** The photo centred in the frame at the smallest scale that covers it. */
export function centredCropTransform(frame: CropBox, natural: CropBox): CropTransform {
  const scale = minimumCropScale(frame, natural);
  if (!usable(frame) || !usable(natural)) return { scale, offsetX: 0, offsetY: 0 };
  return {
    scale,
    offsetX: (frame.width - natural.width * scale) / 2,
    offsetY: (frame.height - natural.height * scale) / 2,
  };
}

/**
 * The rectangle of the ORIGINAL photo the frame is showing, in natural pixels.
 * This is what the canvas draws from, so the crop a person sees is the crop
 * that uploads.
 */
export function cropSourceRect(
  transform: CropTransform,
  frame: CropBox,
  natural: CropBox,
): CropSourceRect {
  if (!usable(frame) || !usable(natural)) {
    return { sx: 0, sy: 0, sw: Math.max(natural.width, 1), sh: Math.max(natural.height, 1) };
  }
  const { scale, offsetX, offsetY } = clampCropTransform(transform, frame, natural);
  const sw = Math.min(frame.width / scale, natural.width);
  const sh = Math.min(frame.height / scale, natural.height);
  const sx = Math.min(Math.max(-offsetX / scale, 0), natural.width - sw);
  const sy = Math.min(Math.max(-offsetY / scale, 0), natural.height - sh);
  return { sx, sy, sw, sh };
}

/**
 * Zoom about a fixed point: the pixel under a pinch midpoint, a wheel cursor or
 * the frame centre stays under it while the scale changes.
 */
export function scaleAboutPoint(
  transform: CropTransform,
  nextScale: number,
  anchor: { x: number; y: number },
  frame: CropBox,
  natural: CropBox,
): CropTransform {
  const scale = clampCropScale(nextScale, frame, natural);
  const ratio = transform.scale > 0 ? scale / transform.scale : 1;
  return clampCropTransform(
    {
      scale,
      offsetX: anchor.x - (anchor.x - transform.offsetX) * ratio,
      offsetY: anchor.y - (anchor.y - transform.offsetY) * ratio,
    },
    frame,
    natural,
  );
}

/** Slider position (0 to 1) for a scale, and back again. */
export function cropZoomPosition(
  scale: number,
  frame: CropBox,
  natural: CropBox,
): number {
  const min = minimumCropScale(frame, natural);
  const max = maximumCropScale(frame, natural);
  if (max <= min) return 0;
  return Math.min(Math.max((clampCropScale(scale, frame, natural) - min) / (max - min), 0), 1);
}

export function cropScaleAtPosition(
  position: number,
  frame: CropBox,
  natural: CropBox,
): number {
  const min = minimumCropScale(frame, natural);
  const max = maximumCropScale(frame, natural);
  const clamped = Number.isFinite(position) ? Math.min(Math.max(position, 0), 1) : 0;
  return min + (max - min) * clamped;
}

/** The file name the crop step gives its JPEG. */
export function croppedFileName(slot: ProfileImageSlot): string {
  return `${slot}.jpg`;
}

/**
 * The box the crop renders into. Named here so the cropper and its tests read
 * the slot table rather than a second copy of the numbers.
 */
export function cropOutputBox(slot: ProfileImageSlot): CropBox {
  return profileImageOutputBox(slot);
}

/**
 * Everything the crop step needs to know about what it is cropping FOR. The
 * geometry above is the same arithmetic wherever a photo is framed, so the one
 * cropper takes this rather than a profile slot: a pub photo wall is another
 * row in the table, not a second cropper. `id` is a stable slug used for
 * element ids and class hooks, so two croppers on one page never collide.
 */
export type CropTarget = {
  readonly id: string;
  readonly aspectRatio: number;
  readonly outputBox: CropBox;
  readonly nounLower: string;
  readonly fileName: string;
};

export function profileImageCropTarget(slot: ProfileImageSlot): CropTarget {
  return {
    id: slot,
    aspectRatio: profileImageSlotSpec(slot).aspectRatio,
    outputBox: cropOutputBox(slot),
    nounLower: profileImageSlotSpec(slot).nounLower,
    fileName: croppedFileName(slot),
  };
}

// ── Copy ────────────────────────────────────────────────────────────────────
// Friction copy, so each line says what happened and hands the reader the next
// move. A browser that cannot decode HEIC is the one case worth naming outright,
// because the way out is in the Photos app rather than in this form.

/**
 * The frame's accessible name. There is no VISIBLE title above it: the slot's
 * own label already says "Profile photo" or "Cover photo", and a second line
 * saying "Position your photo" under it is a subtitle repeating its label. What
 * a sighted person needs is the frame, the zoom and the two buttons; what a
 * screen-reader user needs is this sentence, which also names the keyboard.
 */
export function cropFrameLabel(slot: ProfileImageSlot): string {
  return cropFrameLabelFor(profileImageSlotSpec(slot).nounLower);
}

/** The same sentence, for a crop target that is not a profile slot. */
export function cropFrameLabelFor(nounLower: string): string {
  return `Reposition your ${nounLower}. Drag it, or nudge it with the arrow keys.`;
}

/**
 * One label for both slots. The frame directly above it is already the slot's
 * own shape, so naming the slot again only made the button wide enough to push
 * Cancel onto its own line at 390px.
 */
export const CROP_CONFIRM_LABEL = "Use photo";

export function unreadableImageMessage(
  slot: ProfileImageSlot,
  likelyHeic: boolean,
): string {
  return unreadableImageMessageFor(profileImageSlotSpec(slot).nounLower, likelyHeic);
}

export function unreadableImageMessageFor(
  nounLower: string,
  likelyHeic: boolean,
): string {
  if (likelyHeic) {
    return `This browser cannot open that ${nounLower}. Open it in Photos, share it as a JPEG, then choose it again.`;
  }
  return `Could not open that ${nounLower}. Choose another one.`;
}

export function cropFailedMessage(slot: ProfileImageSlot): string {
  return cropFailedMessageFor(profileImageSlotSpec(slot).nounLower);
}

export function cropFailedMessageFor(nounLower: string): string {
  return `Could not prepare that ${nounLower}. Try again.`;
}
