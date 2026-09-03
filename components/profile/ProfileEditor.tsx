"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import ProfileCoverPhotosEditor from "@/components/profile/ProfileCoverPhotosEditor";
import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { AuthActionSessionError, authedActionFetch } from "@/lib/authedFetch";
import { categoryLabel, MAP_LENS_DRINK_CATEGORIES } from "@/lib/drinks";
import {
  PROFILE_IMAGE_PICKER_ACCEPT,
  profileImageCropTarget,
} from "@/lib/profileImagePicker";
import type { ProfileImageSlot } from "@/lib/profileImageSlots";
import { profileCoverUrls } from "@/lib/profileCovers";
import type { PublicProfile } from "@/lib/profiles";

// Inline "edit my profile" form for the owner of a handle. The page mounts this
// only when the viewer's own handle matches the route handle - so this stays
// dumb about who is allowed to edit; the page owns that gate. It PATCHes the
// editable fields to /api/profiles/[handle], mirrors the SERVER's caps for
// instant feedback (the server is still the trust boundary - see the route),
// and reports the saved row back up so the page can update the header
// optimistically. Image changes use POST/DELETE on the slot's own route.
//
// The fields are GROUPED the way a person thinks about themselves: how the card
// looks, who they are, and what they are like on a night out. A single flat
// column of eight inputs reads as a settings page, which this is not.
//
// Choosing a photo is TWO BEATS: pick, then position. The picker is a plain
// file input carrying lib/profileImagePicker's accept and NO capture attribute
// (see that file for why an iPhone was offered no photo library at all), and
// what it hands back goes to ProfileImageCropper rather than straight up the
// wire. The cropper returns a JPEG cut to the slot's own shape, which is what
// makes an iPhone's HEIC uploadable, and uploadImage below is unchanged: the
// upload routes still receive one JPEG under `photo` and still run the same
// scan on it.
//
// A PHOTO WRITE IS NOT THE END OF AN EDITING SESSION. Uploading and removing
// report the fresh row through `onProfileChanged`, which repaints the card and
// leaves this form exactly where it was; only the Save button reports through
// `onSaved`, which is what closes the editor. They were one callback, so
// choosing an avatar threw a person out of the editor they had opened to
// change five things.
//
// The backdrop is a ROTATION of up to five photos and lives in its own editor
// (`ProfileCoverPhotosEditor`), which owns the whole list. There is no second
// single-cover control here: two live copies of one choice drift the moment
// either writes.

const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 280;
const MAX_HOME_CITY = 60;
const MAX_FAVOURITE_DRINK = 40;
const MAX_INTERESTS = 140;
const MAX_WORKPLACE = 60;

// Suggestions, not a closed set: the field is free text so "Guinness" and
// "whatever is cheapest" both fit. The list is the map's own drink vocabulary,
// which drops `other` because it names no drink.
const DRINK_SUGGESTIONS = MAP_LENS_DRINK_CATEGORIES.map((category) =>
  categoryLabel(category),
);

type SaveState = "idle" | "saving" | "saved" | "error";
type ImageState = "idle" | "uploading" | "removing" | "error";

type ProfileEditorProps = {
  handle: string;
  initial: {
    displayName?: string;
    bio?: string;
    homeCity?: string;
    avatarUrl?: string;
    coverUrl?: string;
    coverUrls?: string[];
    favouriteDrink?: string;
    interests?: string;
    workplace?: string;
  };
  /** The form was saved: the editing session is over. */
  onSaved: (profile: PublicProfile) => void;
  /**
   * The stored row changed under an open editor (a photo went up, a cover
   * moved). The card repaints; the editor stays exactly where it is.
   */
  onProfileChanged: (profile: PublicProfile) => void;
  onClose: () => void;
};

/** Identity of a chosen file, so a second pick arrives as a fresh crop step. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function initialOf(name: string, handle: string): string {
  const source = name.trim() || handle.trim();
  return (source.charAt(0) || "?").toUpperCase();
}

function profileFrom(body: unknown): PublicProfile | null {
  return body && typeof body === "object"
    ? (body as { profile?: PublicProfile | null }).profile ?? null
    : null;
}

export default function ProfileEditor({
  handle,
  initial,
  onSaved,
  onProfileChanged,
  onClose,
}: ProfileEditorProps) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [homeCity, setHomeCity] = useState(initial.homeCity ?? "");
  const [favouriteDrink, setFavouriteDrink] = useState(initial.favouriteDrink ?? "");
  const [interests, setInterests] = useState(initial.interests ?? "");
  const [workplace, setWorkplace] = useState(initial.workplace ?? "");
  const [avatarPreview, setAvatarPreview] = useState(initial.avatarUrl ?? "");
  // DERIVED, never held. The text fields above are snapshot-once on purpose -
  // resyncing one would clobber what the owner is typing - but the held covers
  // are a READ of the profile, not something anybody edits here, and the page
  // above already owns that row: an image write reports up through
  // `onProfileChanged`, the page stores it, and it arrives back as this prop.
  // Held as state it froze at mount, so an owner who reached `?edit=1` before
  // the profile read landed got `[]` for the life of the session and the
  // single-cover Remove control never appeared for them.
  const heldCoverUrls = profileCoverUrls({
    coverUrl: initial.coverUrl,
    coverUrls: initial.coverUrls,
  });
  const [imageError, setImageError] = useState<Record<ProfileImageSlot, string | null>>({
    avatar: null,
    cover: null,
  });
  const [imageState, setImageState] = useState<Record<ProfileImageSlot, ImageState>>({
    avatar: "idle",
    cover: "idle",
  });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // The chosen-but-not-yet-positioned photo for each slot. While one is held,
  // that slot shows the crop step instead of its preview and buttons.
  const [pending, setPending] = useState<Record<ProfileImageSlot, File | null>>({
    avatar: null,
    cover: null,
  });
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const imageBusy = (Object.values(imageState) as ImageState[]).some(
    (value) => value === "uploading" || value === "removing",
  );
  const formBusy = state === "saving" || imageBusy;

  function markImage(slot: ProfileImageSlot, next: ImageState, message: string | null) {
    setImageState((prev) => ({ ...prev, [slot]: next }));
    setImageError((prev) => ({ ...prev, [slot]: message }));
  }

  function choose(slot: ProfileImageSlot, file: File | null) {
    setPending((prev) => ({ ...prev, [slot]: file }));
    if (file) markImage(slot, "idle", null);
  }

  function uploadCropped(slot: ProfileImageSlot, file: File) {
    choose(slot, null);
    void uploadImage(slot, file);
  }

  async function uploadImage(slot: ProfileImageSlot, file: File) {
    markImage(slot, "uploading", null);
    try {
      const form = new FormData();
      form.append("photo", file);
      const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(handle)}/${slot}`, {
        method: "POST",
        body: form,
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        markImage(
          slot,
          "error",
          errorMessageFrom(body, "Could not upload that image. Try again."),
        );
        return;
      }
      const profile = profileFrom(body);
      if (profile) {
        // The card repaints and the editor stays open: a photo is one of the
        // things being edited, not the end of the edit.
        onProfileChanged(profile);
        if (slot === "avatar") setAvatarPreview(profile.avatarUrl ?? "");
      }
      markImage(slot, "idle", null);
    } catch (error) {
      markImage(
        slot,
        "error",
        error instanceof AuthActionSessionError
          ? error.message
          : "Network error. Try again.",
      );
    }
  }

  async function removeImage(slot: ProfileImageSlot) {
    markImage(slot, "removing", null);
    try {
      const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(handle)}/${slot}`, {
        method: "DELETE",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        markImage(
          slot,
          "error",
          errorMessageFrom(body, "Could not remove that image. Try again."),
        );
        return;
      }
      const profile = profileFrom(body);
      if (profile) onProfileChanged(profile);
      if (slot === "avatar") setAvatarPreview("");
      markImage(slot, "idle", null);
    } catch (error) {
      markImage(
        slot,
        "error",
        error instanceof AuthActionSessionError
          ? error.message
          : "Network error. Try again.",
      );
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy) return;

    setState("saving");
    setError(null);

    try {
      const res = await authedActionFetch(`/api/profiles/${encodeURIComponent(handle)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          bio,
          homeCity,
          favouriteDrink,
          interests,
          workplace,
        }),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setState("error");
        setError(errorMessageFrom(body, "Couldn't save. Try again."));
        return;
      }

      const profile = profileFrom(body);
      if (profile) onSaved(profile);
      setState("saved");
    } catch (error) {
      setState("error");
      setError(
        error instanceof AuthActionSessionError
          ? error.message
          : "Network error. Try again.",
      );
    }
  }

  function imageStatus(slot: ProfileImageSlot): string | null {
    return imageError[slot];
  }

  return (
    <form className="profileEditor" onSubmit={handleSubmit} aria-label="Edit your profile">
      <fieldset className="profileEditorGroup profileEditorGroupLook" disabled={formBusy}>
        <legend>Your look</legend>

        <ProfileCoverPhotosEditor
          handle={handle}
          heldCoverUrls={heldCoverUrls}
          onProfileChanged={onProfileChanged}
        />

        <div className="profileEditorField profileEditorAvatarField">
          <span className="profileEditorAvatarLabel" id="pe-avatar-label">
            Profile photo
          </span>
          <input
            ref={avatarInputRef}
            id="pe-avatar-file"
            type="file"
            accept={PROFILE_IMAGE_PICKER_ACCEPT}
            className="profileEditorAvatarFile"
            aria-labelledby="pe-avatar-label"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              choose("avatar", file);
            }}
          />
          {pending.avatar ? (
            <ProfileImageCropper
              key={fileKey(pending.avatar)}
              target={profileImageCropTarget("avatar")}
              file={pending.avatar}
              busy={imageState.avatar === "uploading"}
              onCancel={() => choose("avatar", null)}
              onCropped={(file) => uploadCropped("avatar", file)}
            />
          ) : (
            <div className="profileEditorAvatarRow">
              {avatarPreview ? (
                <Image
                  className="profileEditorAvatarPreview"
                  src={avatarPreview}
                  alt=""
                  width={72}
                  height={72}
                  unoptimized
                />
              ) : (
                <div className="profileEditorAvatarPreview profileEditorAvatarFallback" aria-hidden="true">
                  {initialOf(displayName, handle)}
                </div>
              )}
              <div className="profileEditorAvatarActions">
                <button
                  type="button"
                  className="profileEditorAvatarUpload"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {imageState.avatar === "uploading" ? "Uploading…" : "Choose photo"}
                </button>
                {avatarPreview ? (
                  <button
                    type="button"
                    className="profileEditorAvatarRemove"
                    onClick={() => void removeImage("avatar")}
                  >
                    {imageState.avatar === "removing" ? "Removing…" : "Remove photo"}
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {imageStatus("avatar") ? (
            <span className="profileEditorHint profileEditorStatusErr" role="status">
              {imageStatus("avatar")}
            </span>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="profileEditorGroup" disabled={formBusy}>
        <legend>You</legend>

        <div className="profileEditorField">
          <label htmlFor="pe-displayName">Display name</label>
          <input
            id="pe-displayName"
            type="text"
            value={displayName}
            maxLength={MAX_DISPLAY_NAME}
            autoComplete="off"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {displayName.length}/{MAX_DISPLAY_NAME}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-bio">Bio</label>
          <textarea
            id="pe-bio"
            rows={3}
            value={bio}
            maxLength={MAX_BIO}
            onChange={(e) => setBio(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {bio.length}/{MAX_BIO}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-homeCity">Home city</label>
          <input
            id="pe-homeCity"
            type="text"
            value={homeCity}
            maxLength={MAX_HOME_CITY}
            autoComplete="off"
            onChange={(e) => setHomeCity(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {homeCity.length}/{MAX_HOME_CITY}
          </span>
        </div>
      </fieldset>

      <fieldset className="profileEditorGroup" disabled={formBusy}>
        <legend>Your night</legend>

        <div className="profileEditorField">
          <label htmlFor="pe-favouriteDrink">Favourite drink</label>
          <input
            id="pe-favouriteDrink"
            type="text"
            list="pe-drink-suggestions"
            value={favouriteDrink}
            maxLength={MAX_FAVOURITE_DRINK}
            autoComplete="off"
            onChange={(e) => setFavouriteDrink(e.target.value)}
          />
          <datalist id="pe-drink-suggestions">
            {DRINK_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <span className="profileEditorCount" aria-hidden="true">
            {favouriteDrink.length}/{MAX_FAVOURITE_DRINK}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-interests">What you&apos;re into</label>
          <textarea
            id="pe-interests"
            rows={2}
            value={interests}
            maxLength={MAX_INTERESTS}
            onChange={(e) => setInterests(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {interests.length}/{MAX_INTERESTS}
          </span>
        </div>

        <div className="profileEditorField">
          <label htmlFor="pe-workplace">Where you work</label>
          <input
            id="pe-workplace"
            type="text"
            value={workplace}
            maxLength={MAX_WORKPLACE}
            autoComplete="organization"
            onChange={(e) => setWorkplace(e.target.value)}
          />
          <span className="profileEditorCount" aria-hidden="true">
            {workplace.length}/{MAX_WORKPLACE}
          </span>
        </div>
      </fieldset>

      <div className="profileEditorActions">
        <button type="submit" className="profileEditorSave" disabled={formBusy}>
          {state === "saving" ? "Saving…" : "Save profile"}
        </button>
        <button
          type="button"
          className="profileEditorCancel"
          onClick={onClose}
          disabled={formBusy}
        >
          Cancel
        </button>
        {state === "saved" ? (
          <span className="profileEditorStatus profileEditorStatusOk" role="status">
            Saved.
          </span>
        ) : null}
        {state === "error" && error ? (
          <span className="profileEditorStatus profileEditorStatusErr" role="status">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
