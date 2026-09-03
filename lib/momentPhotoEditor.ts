import type { MomentMediaDraft } from "@/lib/momentDraft";

export const MOMENT_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Matches the private Moment upload boundary.
export const MOMENT_MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type EditedMomentPhotoResult = {
  blob: Blob;
};

export const MOMENT_PHOTO_FILTERS = [
  { id: "original", label: "Original", canvas: "none" },
  { id: "warm", label: "Warm", canvas: "saturate(1.12) contrast(1.04) sepia(0.12)" },
  { id: "mono", label: "Mono", canvas: "grayscale(1) contrast(1.08)" },
  { id: "night", label: "Night", canvas: "contrast(1.08) saturate(0.9) brightness(0.86)" },
] as const;

export type MomentPhotoFilterId = (typeof MOMENT_PHOTO_FILTERS)[number]["id"];
export type MomentDrawPoint = { x: number; y: number };

type MomentPhotoCanvas = {
  toBlob: (
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ) => void;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export function normaliseMomentDrawPoint(
  point: { clientX: number; clientY: number },
  frame: { left: number; top: number; width: number; height: number },
): MomentDrawPoint {
  if (frame.width <= 0 || frame.height <= 0) return { x: 0, y: 0 };
  return {
    x: clampUnit((point.clientX - frame.left) / frame.width),
    y: clampUnit((point.clientY - frame.top) / frame.height),
  };
}

export function claimMomentDrawPointer(
  activePointerId: number | null,
  candidatePointerId: number,
): number {
  return activePointerId ?? candidatePointerId;
}

export function mayAppendMomentDrawPreview(
  activePointerId: number | null,
  candidatePointerId: number,
): boolean {
  return activePointerId === null || activePointerId === candidatePointerId;
}

export function releaseMomentDrawPointer(
  activePointerId: number | null,
  candidatePointerId: number,
): number | null {
  return activePointerId === candidatePointerId ? null : activePointerId;
}

export function encodeMomentPhoto(
  canvas: MomentPhotoCanvas,
  type = "image/jpeg",
  quality = 0.9,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Photo could not be saved."));
      }, type, quality);
    } catch {
      reject(new Error("Photo could not be saved."));
    }
  });
}

type MomentPhotoEditResult = {
  media: MomentMediaDraft;
  error: string | null;
};

function editedExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function editedName(name: string, mimeType: string): string {
  const stem = name.replace(/\.[^/.]+$/, "") || "moment-photo";
  return `${stem}-edited.${editedExtension(mimeType)}`;
}

export function replaceMomentMediaWithEditedBlob(
  current: MomentMediaDraft,
  result: EditedMomentPhotoResult,
): MomentPhotoEditResult {
  const mimeType = result.blob.type.toLowerCase();
  if (!MOMENT_PHOTO_TYPES.has(mimeType)) {
    return { media: current, error: "Edited photo must be JPEG, PNG, or WebP." };
  }
  if (result.blob.size > MOMENT_MAX_PHOTO_BYTES) {
    return { media: current, error: "Edited photo must be 10MB or smaller." };
  }

  const file = new File([result.blob], editedName(current.name, mimeType), {
    type: mimeType,
    lastModified: Date.now(),
  });
  return {
    media: {
      ...current,
      name: file.name,
      mimeType,
      size: file.size,
      blob: file,
      objectUrl: URL.createObjectURL(file),
      width: null,
      height: null,
      focalX: 0.5,
      focalY: 0.5,
    },
    error: null,
  };
}
