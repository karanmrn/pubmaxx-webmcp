"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import ProfileImageCropper from "@/components/profile/ProfileImageCropper";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import {
  AuthActionSessionError,
  authedActionFetch,
} from "@/lib/authedFetch";
import {
  PROFILE_COVER_ADD_LABEL,
  PROFILE_COVER_MOVE_DOWN_LABEL,
  PROFILE_COVER_MOVE_UP_LABEL,
  PROFILE_COVER_PHOTO_CAP,
  PROFILE_COVER_REMOVE_ALL_LABEL,
  PROFILE_COVER_REMOVE_LABEL,
  PROFILE_COVER_SECTION_LABEL,
  profileCoverCapLine,
  profileCoverRemoveConfirmLine,
  profileCoverRemoveLane,
  profileCoverRemoveUnavailableLine,
  profileCoverRotationNote,
  profileCoverStatusLine,
  profileCoverThumbnailLabel,
  profileCoverUrls,
  type ProfileCoverPhotoDTO,
  type ProfileCoverReadState,
  type ProfileCoverReadStatus,
} from "@/lib/profileCovers";
import {
  PROFILE_IMAGE_PICKER_ACCEPT,
  profileImageCropTarget,
} from "@/lib/profileImagePicker";
import { profileImageOutputBox } from "@/lib/profileImageSlots";
import type { PublicProfile } from "@/lib/profiles";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

// The owner's cover ROTATION, inside the profile editor.
//
// It is ONE control for one choice: the single "Choose cover" button used to
// own the backdrop and this list now does, because two live copies of the same
// choice drift the moment either one writes.
//
// Every photo takes the SAME two beats the single cover took - pick, then
// position - and the same pipeline behind them, because it posts one JPEG under
// `photo` to a route that stages, scans and promotes exactly as before. What is
// new is the list: add up to five, move one up or down, remove one.
//
// Ordering is buttons rather than a drag: a drag needs a library, a keyboard
// story and a touch story, and Move up / Move down already has all three.
//
// Nothing here closes the editor. An upload reports the fresh profile UP so the
// header repaints, and the person carries on editing the other four things they
// came to change.

const CROP_TARGET = profileImageCropTarget("cover");
const BOX = profileImageOutputBox("cover");

type Busy = "idle" | "adding" | "editing";

type ProfileCoverPhotosEditorProps = {
  handle: string;
  /** URLs the parent already holds from the public profile, including mirror-only covers. */
  heldCoverUrls: readonly string[];
  /** Reported up on every successful write, so the card repaints in place. */
  onProfileChanged: (profile: PublicProfile) => void;
};

/** Identity of a chosen file, so a second pick arrives as a fresh crop step. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function ProfileCoverPhotosEditor({
  handle,
  heldCoverUrls,
  onProfileChanged,
}: ProfileCoverPhotosEditorProps) {
  const [covers, setCovers] = useState<ProfileCoverPhotoDTO[]>([]);
  const [status, setStatus] = useState<ProfileCoverReadState>("loading");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const base = `/api/profiles/${encodeURIComponent(handle)}/covers`;
  const legacyCoverUrl = `/api/profiles/${encodeURIComponent(handle)}/cover`;

  // The mirror-only card and the remove lane are the SAME question, asked once
  // (lib/profileCovers.ts). A read that has not ANSWERED - still in flight, or
  // failed - leaves `covers` empty while rows really exist, so neither may guess
  // the rotation is gone and route a remove at the single-cover DELETE.
  const removeLane = profileCoverRemoveLane({
    status,
    rotationCount: covers.length,
    mirrorCount: heldCoverUrls.length,
  });
  const hasCover = covers.length > 0 || heldCoverUrls.length > 0;
  const mirrorOnly = removeLane === "mirror";
  // A control that refuses is worse than one not yet offered: until the read
  // answers, nobody can say which lane a remove belongs in. A read that FAILED
  // keeps the control, because there the refusal is the explanation.
  const removeOffered = status !== "loading" && hasCover;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      const outcome = await loadSurfaceJson<{
        status?: ProfileCoverReadStatus;
        covers?: ProfileCoverPhotoDTO[];
      }>(
        base,
        {
          signal: controller.signal,
          fetchImpl: authedActionFetch,
          validate: (body) => Array.isArray(body?.covers),
        },
        (body) => {
          if (!active) return;
          setStatus(body.status === "degraded" ? "degraded" : "ready");
          setCovers(body.covers ?? []);
        },
      );
      if (outcome === "failed" && active && !controller.signal.aborted) {
        setStatus("degraded");
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [base]);

  /** Every write answers the whole profile AND, when the route carries it, the whole rotation. */
  function applyReply(body: unknown): void {
    if (!body || typeof body !== "object") return;
    const reply = body as { profile?: PublicProfile | null; covers?: ProfileCoverPhotoDTO[] };
    if (Array.isArray(reply.covers)) {
      setCovers(reply.covers);
    } else if (reply.profile && profileCoverUrls(reply.profile).length === 0) {
      setCovers([]);
    }
    setStatus("ready");
    if (reply.profile) onProfileChanged(reply.profile);
  }

  async function send(
    url: string,
    init: RequestInit,
    fallbackError: string,
    state: Busy,
  ): Promise<void> {
    setBusy(state);
    setError(null);
    try {
      const response = await authedActionFetch(url, init);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
          setError(errorMessageFrom(body, fallbackError));
        return;
      }
      applyReply(body);
    } catch (error) {
      setError(
        error instanceof AuthActionSessionError
          ? error.message
          : "Network error. Try again.",
      );
    } finally {
      setBusy("idle");
    }
  }

  async function upload(file: File): Promise<void> {
    const form = new FormData();
    form.append("photo", file);
    await send(
      base,
      { method: "POST", body: form },
      "Could not add that cover. Try again.",
      "adding",
    );
  }

  async function remove(coverId: string): Promise<void> {
    await send(
      `${base}/${encodeURIComponent(coverId)}`,
      { method: "DELETE" },
      "Could not remove that cover. Try again.",
      "editing",
    );
  }

  async function removeAllCovers(): Promise<void> {
    if (removeLane === "unavailable") {
      setError(profileCoverRemoveUnavailableLine());
      return;
    }
    if (removeLane === "none") return;
    if (typeof window !== "undefined" && !window.confirm(profileCoverRemoveConfirmLine())) {
      return;
    }
    setBusy("editing");
    setError(null);
    try {
      if (removeLane === "rotation") {
        const ids = covers.map((cover) => cover.id);
        for (const id of ids) {
          const response = await authedActionFetch(`${base}/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            setError(errorMessageFrom(body, "Could not remove your cover. Try again."));
            return;
          }
          applyReply(body);
        }
        return;
      }
      const response = await authedActionFetch(legacyCoverUrl, { method: "DELETE" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessageFrom(body, "Could not remove your cover. Try again."));
        return;
      }
      applyReply(body);
    } catch (error) {
      setError(
        error instanceof AuthActionSessionError
          ? error.message
          : "Network error. Try again.",
      );
    } finally {
      setBusy("idle");
    }
  }

  async function move(coverId: string, direction: "up" | "down"): Promise<void> {
    await send(
      `${base}/${encodeURIComponent(coverId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ move: direction }),
      },
      "Could not reorder your covers. Try again.",
      "editing",
    );
  }

  const statusLine = profileCoverStatusLine(status);
  const full = covers.length >= PROFILE_COVER_PHOTO_CAP;
  const working = busy !== "idle";
  const rotationNote = profileCoverRotationNote(covers.length);

  return (
    <div className="profileEditorField profileEditorCoverField">
      <span className="profileEditorAvatarLabel" id="pe-covers-label">
        {PROFILE_COVER_SECTION_LABEL}
      </span>

      {statusLine && (status === "degraded" || (covers.length === 0 && !pending && !hasCover)) ? (
        <p className="profileEditorHint profileEditorCoverEmpty" role="status">
          {statusLine}
        </p>
      ) : null}

      {mirrorOnly ? (
        <div className="profileEditorCoverItem profileEditorCoverMirrorOnly">
          <div className="profileEditorCoverStage">
            <Image
              className="profileEditorCoverPreview"
              src={heldCoverUrls[0]!}
              alt={profileCoverThumbnailLabel(1)}
              width={BOX.width}
              height={BOX.height}
              unoptimized
            />
          </div>
          <span className="profileEditorCoverPosition">{profileCoverThumbnailLabel(1)}</span>
        </div>
      ) : null}

      {covers.length > 0 ? (
        <ol className="profileEditorCoverList">
          {covers.map((cover, index) => (
            <li key={cover.id} className="profileEditorCoverItem">
              <div className="profileEditorCoverStage">
                <Image
                  className="profileEditorCoverPreview"
                  src={cover.url}
                  alt={profileCoverThumbnailLabel(index + 1)}
                  width={BOX.width}
                  height={BOX.height}
                  unoptimized
                />
              </div>
              <div className="profileEditorCoverItemActions">
                <span className="profileEditorCoverPosition">
                  {profileCoverThumbnailLabel(index + 1)}
                </span>
                <button
                  type="button"
                  className="profileEditorAvatarUpload"
                  disabled={working || index === 0}
                  onClick={() => void move(cover.id, "up")}
                >
                  {PROFILE_COVER_MOVE_UP_LABEL}
                </button>
                <button
                  type="button"
                  className="profileEditorAvatarUpload"
                  disabled={working || index === covers.length - 1}
                  onClick={() => void move(cover.id, "down")}
                >
                  {PROFILE_COVER_MOVE_DOWN_LABEL}
                </button>
                <button
                  type="button"
                  className="profileEditorAvatarRemove"
                  disabled={working}
                  onClick={() => void remove(cover.id)}
                >
                  {PROFILE_COVER_REMOVE_LABEL}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {rotationNote ? (
        <p className="profileEditorHint profileEditorCoverNote">{rotationNote}</p>
      ) : null}

      <input
        ref={inputRef}
        id="pe-cover-file"
        type="file"
        accept={PROFILE_IMAGE_PICKER_ACCEPT}
        className="profileEditorAvatarFile"
        aria-labelledby="pe-covers-label"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          setPending(file);
          if (file) setError(null);
        }}
      />

      {pending ? (
        <ProfileImageCropper
          key={fileKey(pending)}
          target={CROP_TARGET}
          file={pending}
          busy={busy === "adding"}
          onCancel={() => setPending(null)}
          onCropped={(file) => {
            setPending(null);
            void upload(file);
          }}
        />
      ) : (
        <div className="profileEditorAvatarActions profileEditorCoverActions">
          <button
            type="button"
            className="profileEditorAvatarUpload"
            disabled={working || full}
            onClick={() => inputRef.current?.click()}
          >
            {busy === "adding" ? "Uploading…" : PROFILE_COVER_ADD_LABEL}
          </button>
          {removeOffered ? (
            <button
              type="button"
              className="profileEditorAvatarRemove"
              disabled={working}
              onClick={() => void removeAllCovers()}
            >
              {PROFILE_COVER_REMOVE_ALL_LABEL}
            </button>
          ) : null}
        </div>
      )}

      {full ? (
        <span className="profileEditorHint" role="status">
          {profileCoverCapLine()}
        </span>
      ) : null}

      {error ? (
        <span className="profileEditorHint profileEditorStatusErr" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
