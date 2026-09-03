"use client";

// A photo somebody sent you, in the thread.
//
// WHY THIS IS NOT AN `<img src>` POINTED AT THE ROUTE. A DM photo is the one
// owned image in this tree that is NOT public: the bytes are gated by the same
// courtesy participant check the thread read makes, and that check reads a
// bearer token an `<img>` cannot send. So the bytes come through `authedActionFetch`
// like every other gated read on this surface, and the tile renders the object
// URL. ONE gate, and no short-lived signed URL minted that would outlive the
// check that authorised it.
//
// The tile is capped by HEIGHT rather than width, because a thread is read by
// scrolling and a portrait photograph filling the line would push the words
// after it a screen away. The cap itself is the viewport's rather than the
// reader's font (app/messages/messages.css says why). Tap opens the full frame
// in a dialog, so the thread is still behind it and Escape is the way out on
// every platform.
//
// The figure is rendered in EVERY state that has a box, carrying the photo's
// own aspect, so the space reserved before the bytes land is the space the
// photograph takes when they do.

import { useCallback, useEffect, useRef, useState } from "react";

import { authedActionFetch } from "@/lib/authedFetch";
import {
  MESSAGE_PHOTO_ASPECT_PROPERTY,
  MESSAGE_PHOTO_UNREADABLE_LINE,
  messagePhotoAltText,
  messagePhotoAspect,
} from "@/lib/messageAttachments";
import { discardBody } from "@/lib/responseBody";

type MessagePhotoProps = {
  url: string;
  width: number;
  height: number;
  senderHandle: string;
  handle: string;
};

export default function MessagePhoto({
  url,
  width,
  height,
  senderHandle,
  handle,
}: MessagePhotoProps): React.JSX.Element {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    const controller = new AbortController();
    const address = handle ? `${url}?handle=${encodeURIComponent(handle)}` : url;

    void (async () => {
      try {
        const res = await authedActionFetch(address, { signal: controller.signal });
        if (!res.ok) {
          // Between learning the status and reading the body, let the body go.
          discardBody(res);
          if (active) setFailed(true);
          return;
        }
        const blob = await res.blob();
        if (!active) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, handle]);

  // `showModal` rather than the `open` attribute: only a modal dialog gets the
  // backdrop, the focus trap and Escape for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    try {
      if (open && !dialog.open) dialog.showModal();
      if (!open && dialog.open) dialog.close();
    } catch {
      queueMicrotask(() => {
        setOpen(false);
        setDialogError("Could not open photo. Try again.");
      });
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const onDialogClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      if (event.target === event.currentTarget) close();
    },
    [close],
  );

  if (failed) {
    return <p className="messagePhotoFailed">{MESSAGE_PHOTO_UNREADABLE_LINE}</p>;
  }

  // The tile's own aspect, handed to the stylesheet once. The figure's width,
  // the reserved box and the loaded photograph all read this one number, so
  // there is no second copy to disagree with the first.
  const tile = {
    [MESSAGE_PHOTO_ASPECT_PROPERTY]: messagePhotoAspect(width, height),
  } as React.CSSProperties;

  if (!objectUrl) {
    // The box is reserved at the photo's own aspect, so the thread does not
    // jump under a reader's thumb when the bytes land.
    return (
      <figure className="messagePhotoFigure" style={tile}>
        <p className="messagePhotoPending">Loading photo</p>
      </figure>
    );
  }

  const alt = messagePhotoAltText(senderHandle);

  return (
    <figure className="messagePhotoFigure" style={tile}>
      <button
        type="button"
        className="messagePhotoButton"
        onClick={() => {
          setDialogError("");
          setOpen(true);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- gated bytes read as an object URL; no loader can fetch them */}
        <img
          className="messagePhoto"
          src={objectUrl}
          width={width}
          height={height}
          alt={alt}
          decoding="async"
        />
      </button>
      {dialogError ? <p role="status">{dialogError}</p> : null}
      <dialog
        ref={dialogRef}
        className="messagePhotoViewer"
        onClose={close}
        onClick={onDialogClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- same object URL, full frame */}
        <img className="messagePhotoViewerImage" src={objectUrl} alt={alt} />
        <button type="button" className="messagePhotoViewerClose" onClick={close}>
          Close
        </button>
      </dialog>
    </figure>
  );
}
