"use client";

// Adding a photo to a wall, in two beats and one action.
//
// BEAT ONE IS A PICKER, NEVER A CAMERA. `capture` on a file input is not a hint
// to iOS, it is an instruction to open the camera and leave Photo Library out
// of the sheet, so this input carries none and takes its accept list from the
// one shared constant that names HEIC and HEIF (an iPhone matches a library
// photo's own type before converting anything).
// `__tests__/profilePhotoPicker.test.ts` sweeps this file for both.
//
// BEAT TWO IS THE CROP, and it is also what makes an iPhone's HEIC uploadable:
// the cropper re-encodes whatever the browser could decode to JPEG. So widening
// this picker never widens the server's three stored types.
//
// The tag and the caption ride alongside, and the crosspost box says where the
// photo goes rather than how good that is. Its answer comes back from the
// server, because whether a feed took it is the server's to know.

import { useRef, useState } from "react";

import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { authedActionFetch } from "@/lib/authedFetch";
import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { SUBMITTABLE_DRINK_CATEGORIES } from "@/lib/communityPrice";
import { categoryLabel, type DrinkCategory } from "@/lib/drinks";
import { PROFILE_IMAGE_PICKER_ACCEPT } from "@/lib/profileImagePicker";
import {
  VENUE_PHOTO_CAPTION_MAX,
  VENUE_PHOTO_CROSSPOST_LABEL,
  VENUE_PHOTO_CROP_TARGET,
  venuePhotoCrosspostNote,
  type VenuePhotoCrosspost,
  type VenuePhotoDTO,
} from "@/lib/venuePhotos";

import "./venuePhotoWall.css";

type VenuePhotoComposerProps = {
  venueId: string;
  venueName: string;
  onCancel: () => void;
  onPosted: (photo: VenuePhotoDTO, note: string | null) => void;
};

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function VenuePhotoComposer({
  venueId,
  venueName,
  onCancel,
  onPosted,
}: VenuePhotoComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [drinkCategory, setDrinkCategory] = useState<DrinkCategory | null>(null);
  const [caption, setCaption] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append(
        "post",
        JSON.stringify({ venueId, drinkCategory, caption, shareToFeed }),
      );
      form.append("photo", file);
      const response = await authedActionFetch("/api/venue-photos", {
        method: "POST",
        body: form,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          offlineOrMessage(errorMessageFrom(body, "Could not add that photo. Try again."))
        );
        return;
      }
      const payload = body as { photo?: VenuePhotoDTO; crosspost?: VenuePhotoCrosspost };
      if (!payload.photo) {
        setError("Could not add that photo. Try again.");
        return;
      }
      onPosted(payload.photo, venuePhotoCrosspostNote(payload.crosspost?.state ?? "off"));
    } catch {
      setError(
        offlineOrMessage("Could not add that photo. Try again.")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="venuePhotoComposer">
      <input
        ref={inputRef}
        id="venue-photo-file"
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        className="venuePhotoComposerFile"
        aria-label={`Choose a photo of ${venueName}`}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          setChosen(file);
          setError(null);
        }}
      />

      {chosen ? (
        <ProfileImageCropper
          key={fileKey(chosen)}
          target={VENUE_PHOTO_CROP_TARGET}
          file={chosen}
          busy={busy}
          onCancel={() => setChosen(null)}
          onCropped={(file) => void upload(file)}
        />
      ) : (
        <button
          type="button"
          className="venuePhotoWallButton"
          onClick={() => inputRef.current?.click()}
        >
          Choose a photo
        </button>
      )}

      <fieldset className="venuePhotoComposerField">
        <legend className="venuePhotoComposerLegend">Drink</legend>
        <div className="venuePhotoComposerTags">
          {SUBMITTABLE_DRINK_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className="venuePhotoComposerTag"
              aria-pressed={drinkCategory === category}
              onClick={() =>
                setDrinkCategory((current) => (current === category ? null : category))
              }
            >
              {categoryLabel(category)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="venuePhotoComposerField">
        <label htmlFor="venue-photo-caption">Caption</label>
        <textarea
          id="venue-photo-caption"
          className="venuePhotoComposerCaption"
          maxLength={VENUE_PHOTO_CAPTION_MAX}
          rows={2}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
      </div>

      <label className="venuePhotoComposerShare">
        <input
          type="checkbox"
          checked={shareToFeed}
          onChange={(event) => setShareToFeed(event.target.checked)}
        />
        {VENUE_PHOTO_CROSSPOST_LABEL}
      </label>

      {error ? (
        <p className="venuePhotoWallStatus venuePhotoWallStatusErr" role="status">
          {error}
        </p>
      ) : null}

      <div className="venuePhotoComposerActions">
        <button
          type="button"
          className="venuePhotoWallButton"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
