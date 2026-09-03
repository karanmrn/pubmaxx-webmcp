import { ImagePlus, SmilePlus, X } from "lucide-react";

import type { PintDropsState } from "@/components/map/usePintDrops";

type SpillDesktopCaptureProps = {
  pintPhoto: PintDropsState["pintPhoto"];
  venuePhoto: PintDropsState["venuePhoto"];
  pintInputRef: PintDropsState["pintInputRef"];
  venueInputRef: PintDropsState["venueInputRef"];
  pickPhoto: PintDropsState["pickPhoto"];
  removePhoto: PintDropsState["removePhoto"];
};

// Desktop photo pair — the classic inline slots. Skipped on mobile,
// where the camera-first step above already owns the photo.
export function SpillDesktopCapture({
  pintPhoto,
  venuePhoto,
  pintInputRef,
  venueInputRef,
  pickPhoto,
  removePhoto,
}: SpillDesktopCaptureProps) {
  return (
    <div className="photoRow instaPintRow spillDesktopCapture">
      <div className="spillCaptureIntro">
        <span className="spillFieldLabel">Photos</span>
        <span>Shot first, story second</span>
      </div>
      <div className="photoField">
        {pintPhoto ? (
          <div className="photoPreview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pintPhoto.previewUrl}
              alt="Preview of your pint photo"
              width={120}
              height={120}
              decoding="async"
            />
            <button
              type="button"
              className="photoRemove"
              onClick={() => removePhoto("pint")}
              aria-label="Remove pint photo"
            >
              <X size={13} /> Remove
            </button>
          </div>
        ) : (
          <label className="photoPick">
            <ImagePlus size={18} />
            <span>Your pint</span>
            <small>Snap or upload</small>
            <input
              ref={pintInputRef}
              type="file"
              accept="image/*"
              aria-label="Your pint: Snap or upload"
              onChange={(event) =>
                pickPhoto("pint", event.target.files?.[0], event.target)
              }
            />
          </label>
        )}
      </div>
      <div className="photoField">
        {venuePhoto ? (
          <div className="photoPreview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={venuePhoto.previewUrl}
              alt="Preview of your cheeky selfie at the bar"
              width={120}
              height={120}
              decoding="async"
            />
            <button
              type="button"
              className="photoRemove"
              onClick={() => removePhoto("venue")}
              aria-label="Remove selfie"
            >
              <X size={13} /> Remove
            </button>
          </div>
        ) : (
          <label className="photoPick">
            <SmilePlus size={18} />
            <span>You at the bar</span>
            <small>Cheeky selfie</small>
            <input
              ref={venueInputRef}
              type="file"
              accept="image/*"
              aria-label="You at the bar: Cheeky selfie"
              onChange={(event) =>
                pickPhoto("venue", event.target.files?.[0], event.target)
              }
            />
          </label>
        )}
      </div>
    </div>
  );
}
