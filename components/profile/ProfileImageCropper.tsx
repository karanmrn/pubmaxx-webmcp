"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  centredCropTransform,
  clampCropTransform,
  CROP_OUTPUT_QUALITY,
  CROP_OUTPUT_TYPE,
  CROP_CONFIRM_LABEL,
  cropFailedMessageFor,
  cropFrameLabelFor,
  cropScaleAtPosition,
  cropSourceRect,
  cropZoomPosition,
  isLikelyHeic,
  scaleAboutPoint,
  unreadableImageMessageFor,
  type CropBox,
  type CropTarget,
  type CropTransform,
} from "@/lib/profileImagePicker";

import "@/components/profile/profileImageCropper.css";

// The step between choosing a photo and uploading it. It exists because the
// slots have fixed shapes: a face is a square and a backdrop is a wide band, so
// without a crop the server decides which half of a portrait to keep and a
// person only finds out once it is on their card.
//
// It is canvas-based and carries no new dependency. Everything an off-the-shelf
// cropper would add is here in one file: a covering transform, a drag, a pinch,
// a zoom control and one drawImage. A cropper package would put tens of
// kilobytes of JavaScript into a route that is measured against a budget
// (docs/PERFORMANCE_BUDGETS.md) to do the same arithmetic, and the arithmetic
// itself lives in lib/profileImagePicker.ts where it is tested without a
// browser.
//
// The photo is shown in an <img> rather than painted every frame, so a drag is
// a compositor transform. The canvas runs ONCE, on confirm, and its output is a
// plain JPEG File handed to the existing upload path unchanged. That is also
// what converts an iPhone's HEIC: whatever the browser could decode, it
// re-encodes. A browser that cannot decode it says so rather than uploading
// bytes the server will refuse.

type ProfileImageCropperProps = {
  /**
   * What this crop is FOR: its shape, its output box, its noun and the name of
   * the file it writes. A profile slot builds one with
   * `profileImageCropTarget`; a pub photo wall brings its own. The cropper
   * itself knows about neither.
   */
  target: CropTarget;
  file: File;
  busy?: boolean;
  busyLabel?: string;
  onCancel: () => void;
  onCropped: (file: File) => void;
  onBusyChange?: (busy: boolean) => void;
};

const KEYBOARD_NUDGE_PX = 16;
const KEYBOARD_NUDGE_FAST_PX = 48;
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const ZOOM_STEPS = 100;

type Pointer = { x: number; y: number };

export default function ProfileImageCropper({
  target,
  file,
  busy = false,
  busyLabel = "Uploading…",
  onCancel,
  onCropped,
  onBusyChange,
}: ProfileImageCropperProps) {
  const frameElementRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const transformRef = useRef<CropTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const frameBoxRef = useRef<CropBox>({ width: 0, height: 0 });
  const naturalRef = useRef<CropBox>({ width: 0, height: 0 });
  const pointersRef = useRef(new Map<number, Pointer>());
  const gestureRef = useRef<{
    pointers: Map<number, Pointer>;
    transform: CropTransform;
  } | null>(null);

  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // The object URL is handed straight to the element rather than held in state:
  // it is a browser handle with a lifetime, not something a render depends on,
  // and `URL.createObjectURL` does not exist on the server. The parent keys this
  // component on the chosen file, so a second pick arrives as a fresh mount.
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const url = URL.createObjectURL(file);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const paint = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    const { scale, offsetX, offsetY } = transformRef.current;
    image.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
  }, []);

  const commit = useCallback(
    (next: CropTransform) => {
      const frame = frameBoxRef.current;
      const natural = naturalRef.current;
      transformRef.current = clampCropTransform(next, frame, natural);
      paint();
      setZoom(cropZoomPosition(transformRef.current.scale, frame, natural));
    },
    [paint],
  );

  const reframe = useCallback(() => {
    const element = frameElementRef.current;
    const natural = naturalRef.current;
    if (!element || natural.width < 1) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    frameBoxRef.current = { width: rect.width, height: rect.height };
    commit(clampCropTransform(transformRef.current, frameBoxRef.current, natural));
  }, [commit]);

  useEffect(() => {
    const element = frameElementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => reframe());
    observer.observe(element);
    return () => observer.disconnect();
  }, [reframe]);

  // A wheel over the frame zooms rather than scrolling the page past it, which
  // needs a non-passive listener React's onWheel does not give.
  useEffect(() => {
    const element = frameElementRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const natural = naturalRef.current;
      if (natural.width < 1 || busy || rendering) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const current = transformRef.current;
      commit(
        scaleAboutPoint(
          current,
          current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PIXEL),
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          frameBoxRef.current,
          natural,
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [busy, commit, rendering]);

  function handleLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    const natural: CropBox = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    if (natural.width < 1 || natural.height < 1) {
      setError(unreadableImageMessageFor(target.nounLower, isLikelyHeic(file)));
      return;
    }
    naturalRef.current = natural;
    const element = frameElementRef.current;
    const rect = element?.getBoundingClientRect();
    frameBoxRef.current = {
      width: rect && rect.width > 0 ? rect.width : natural.width,
      height: rect && rect.height > 0 ? rect.height : natural.height,
    };
    transformRef.current = centredCropTransform(frameBoxRef.current, natural);
    setReady(true);
    setError(null);
    paint();
    setZoom(0);
  }

  function handleImageError() {
    setError(unreadableImageMessageFor(target.nounLower, isLikelyHeic(file)));
  }

  function localPoint(event: { clientX: number; clientY: number }): Pointer {
    const rect = frameElementRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  function rebase() {
    gestureRef.current = {
      pointers: new Map(pointersRef.current),
      transform: transformRef.current,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!ready || busy || rendering) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, localPoint(event));
    rebase();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!ready || busy || rendering) return;
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, localPoint(event));

    const start = gestureRef.current;
    if (!start) return;
    const ids = [...pointersRef.current.keys()].filter((id) => start.pointers.has(id));
    if (ids.length === 0) return;

    if (ids.length === 1) {
      const id = ids[0];
      const from = start.pointers.get(id)!;
      const to = pointersRef.current.get(id)!;
      commit({
        scale: start.transform.scale,
        offsetX: start.transform.offsetX + (to.x - from.x),
        offsetY: start.transform.offsetY + (to.y - from.y),
      });
      return;
    }

    const [a, b] = ids;
    const fromA = start.pointers.get(a)!;
    const fromB = start.pointers.get(b)!;
    const toA = pointersRef.current.get(a)!;
    const toB = pointersRef.current.get(b)!;
    const startSpread = Math.hypot(fromB.x - fromA.x, fromB.y - fromA.y);
    if (startSpread < 1) return;
    const spread = Math.hypot(toB.x - toA.x, toB.y - toA.y);
    const startMid = { x: (fromA.x + fromB.x) / 2, y: (fromA.y + fromB.y) / 2 };
    const mid = { x: (toA.x + toB.x) / 2, y: (toA.y + toB.y) / 2 };
    // Anchor on the pixel the fingers started over, then carry the whole
    // gesture's pan on top, so a pinch that also slides does both.
    const zoomed = scaleAboutPoint(
      start.transform,
      start.transform.scale * (spread / startSpread),
      startMid,
      frameBoxRef.current,
      naturalRef.current,
    );
    commit({
      scale: zoomed.scale,
      offsetX: zoomed.offsetX + (mid.x - startMid.x),
      offsetY: zoomed.offsetY + (mid.y - startMid.y),
    });
  }

  function releasePointer(event: React.PointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rebase();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!ready || busy || rendering) return;
    const step = event.shiftKey ? KEYBOARD_NUDGE_FAST_PX : KEYBOARD_NUDGE_PX;
    const current = transformRef.current;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[event.key];
    if (!delta) return;
    event.preventDefault();
    commit({
      scale: current.scale,
      offsetX: current.offsetX + delta[0],
      offsetY: current.offsetY + delta[1],
    });
  }

  function handleZoom(event: React.ChangeEvent<HTMLInputElement>) {
    if (busy || rendering) return;
    const position = Number(event.target.value) / ZOOM_STEPS;
    const frame = frameBoxRef.current;
    const natural = naturalRef.current;
    commit(
      scaleAboutPoint(
        transformRef.current,
        cropScaleAtPosition(position, frame, natural),
        { x: frame.width / 2, y: frame.height / 2 },
        frame,
        natural,
      ),
    );
  }

  async function handleConfirm() {
    const image = imageRef.current;
    if (!image || !ready || rendering || busy) return;
    let croppedFile: File | null = null;
    setError(null);
    setRendering(true);
    onBusyChange?.(true);
    try {
      const box = target.outputBox;
      const rect = cropSourceRect(
        transformRef.current,
        frameBoxRef.current,
        naturalRef.current,
      );
      const canvas = document.createElement("canvas");
      canvas.width = box.width;
      canvas.height = box.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        0,
        0,
        box.width,
        box.height,
      );
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, CROP_OUTPUT_TYPE, CROP_OUTPUT_QUALITY);
      });
      if (!blob) throw new Error("no blob");
      croppedFile = new File([blob], target.fileName, {
        type: CROP_OUTPUT_TYPE,
        lastModified: file.lastModified,
      });
    } catch {
      setError(cropFailedMessageFor(target.nounLower));
    } finally {
      setRendering(false);
      onBusyChange?.(false);
    }
    if (croppedFile) onCropped(croppedFile);
  }

  const confirmLabel = rendering || busy ? busyLabel : CROP_CONFIRM_LABEL;
  // A file this browser could not open has nothing to position. Showing an
  // empty frame with a dead button reads as a broken control; the sentence and
  // the way back are the whole surface.
  const unreadable = error !== null && !ready;

  if (unreadable) {
    return (
      <div className={`profileCropStep profileCropStep-${target.id} profileCropStepFailed`}>
        <span className="profileEditorHint profileEditorStatusErr" role="status">
          {error}
        </span>
        <div className="profileCropActions">
          <button type="button" className="profileCropCancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`profileCropStep profileCropStep-${target.id}`}>
      <div
        ref={frameElementRef}
        className="profileCropFrame"
        style={{ aspectRatio: `${target.aspectRatio}` }}
        role="group"
        tabIndex={0}
        aria-label={cropFrameLabelFor(target.nounLower)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onKeyDown={handleKeyDown}
      >
        {/* Plain <img> (not next/image): an object URL for a file the person
            just chose, at whatever size their camera made it. There is no
            loader for a blob: URL and nothing to optimise. The src is attached
            by the effect above. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          className="profileCropImage"
          alt=""
          draggable={false}
          onLoad={handleLoad}
          onError={handleImageError}
        />
        <div className="profileCropMask" aria-hidden="true" />
      </div>
      <div className="profileCropZoom">
        <label htmlFor={`pe-${target.id}-zoom`}>Zoom</label>
        <input
          id={`pe-${target.id}-zoom`}
          type="range"
          min={0}
          max={ZOOM_STEPS}
          step={1}
          value={Math.round(zoom * ZOOM_STEPS)}
          disabled={!ready || busy || rendering}
          onChange={handleZoom}
        />
      </div>
      <div className="profileCropActions">
        <button
          type="button"
          className="profileCropConfirm"
          disabled={!ready || rendering || busy}
          onClick={() => void handleConfirm()}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="profileCropCancel"
          disabled={rendering || busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <span className="profileEditorHint profileEditorStatusErr" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
