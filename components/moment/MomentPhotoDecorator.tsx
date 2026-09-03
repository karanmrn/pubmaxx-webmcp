"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MOMENT_PHOTO_FILTERS,
  claimMomentDrawPointer,
  encodeMomentPhoto,
  mayAppendMomentDrawPreview,
  normaliseMomentDrawPoint,
  releaseMomentDrawPointer,
  type MomentDrawPoint,
  type MomentPhotoFilterId,
} from "@/lib/momentPhotoEditor";

type MomentPhotoDecoratorProps = {
  file: File;
  onBack: () => void;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
  onError: (reason?: "open" | "save") => void;
  onSavingChange: (saving: boolean) => void;
};

type Stroke = MomentDrawPoint[];

const OUTPUT_TYPE = "image/jpeg";
const OUTPUT_QUALITY = 0.9;

export default function MomentPhotoDecorator({
  file,
  onBack,
  onCancel,
  onSave,
  onError,
  onSavingChange,
}: MomentPhotoDecoratorProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const drawingPointerRef = useRef<number | null>(null);
  const [filterId, setFilterId] = useState<MomentPhotoFilterId>("original");
  const [caption, setCaption] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const filter = MOMENT_PHOTO_FILTERS.find((item) => item.id === filterId)
      ?? MOMENT_PHOTO_FILTERS[0];

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.filter = filter.canvas;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#fff7e8";
    context.lineWidth = Math.max(4, canvas.width * 0.006);
    context.shadowColor = "rgb(0 0 0 / 55%)";
    context.shadowBlur = Math.max(2, canvas.width * 0.004);

    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x * canvas.width, stroke[0]!.y * canvas.height);
      for (const point of stroke.slice(1)) {
        context.lineTo(point.x * canvas.width, point.y * canvas.height);
      }
      context.stroke();
    }

    const text = caption.trim();
    if (text) {
      const size = Math.max(32, Math.round(canvas.width * 0.055));
      context.font = `700 ${size}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillStyle = "#fff7e8";
      context.strokeStyle = "rgb(0 0 0 / 72%)";
      context.lineWidth = Math.max(3, size * 0.1);
      const x = canvas.width / 2;
      const y = canvas.height - Math.round(canvas.height * 0.06);
      context.strokeText(text, x, y, canvas.width * 0.88);
      context.fillText(text, x, y, canvas.width * 0.88);
    }
    context.shadowBlur = 0;
  }, [caption, filterId, ready, strokes]);

  useEffect(() => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    imageRef.current = image;
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      setReady(true);
    };
    image.onerror = () => onError("open");
    image.src = url;
    return () => {
      image.onload = null;
      image.onerror = null;
      imageRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file, onError]);

  useEffect(() => {
    paint();
  }, [paint]);

  function pointFor(event: React.PointerEvent<HTMLCanvasElement>): MomentDrawPoint {
    return normaliseMomentDrawPoint(event, event.currentTarget.getBoundingClientRect());
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>): boolean {
    if (!drawing || !ready || saving) return false;
    if (!mayAppendMomentDrawPreview(drawingPointerRef.current, event.pointerId)) return false;
    const pointerId = claimMomentDrawPointer(drawingPointerRef.current, event.pointerId);
    if (pointerId !== event.pointerId) return false;
    drawingPointerRef.current = pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic proof events have no browser-owned pointer to capture.
    }
    drawingRef.current = [pointFor(event)];
    return true;
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawingRef.current;
    if (!drawing || !stroke || drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    stroke.push(pointFor(event));
    setStrokes((current) => [...current.slice(0, -1), [...stroke]]);
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = drawingRef.current;
    if (!stroke || drawingPointerRef.current !== event.pointerId) return;
    const finishedStroke = [...stroke];
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingPointerRef.current = releaseMomentDrawPointer(
      drawingPointerRef.current,
      event.pointerId,
    );
    drawingRef.current = null;
    setStrokes((current) => {
      const withoutPreview = current.slice(0, -1);
      return finishedStroke.length > 1 ? [...withoutPreview, finishedStroke] : withoutPreview;
    });
  }

  function beginOrPreviewStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!startStroke(event) || !drawingRef.current) return;
    setStrokes((current) => [...current, [...drawingRef.current!]]);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas || !ready || saving) return;
    let blob: Blob | null = null;
    setSaving(true);
    onSavingChange(true);
    try {
      paint();
      blob = await encodeMomentPhoto(canvas, OUTPUT_TYPE, OUTPUT_QUALITY);
    } catch {
      onError("save");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
    if (blob) onSave(blob);
  }

  return (
    <div className="momentDecorator">
      <canvas
        ref={canvasRef}
        className={drawing ? "momentDecoratorPreview momentDecoratorPreviewDraw" : "momentDecoratorPreview"}
        role="img"
        aria-label="Edited photo preview"
        onPointerDown={beginOrPreviewStroke}
        onPointerMove={continueStroke}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />

      <fieldset className="momentDecoratorFilters">
        <legend>Filter</legend>
        <div>
          {MOMENT_PHOTO_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              disabled={saving}
              aria-pressed={filterId === filter.id}
              onClick={() => setFilterId(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="momentDecoratorText">
        <span>Text</span>
        <input
          disabled={saving}
          value={caption}
          maxLength={60}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>

      <div className="momentDecoratorDraw">
        <button type="button" disabled={saving} aria-pressed={drawing} onClick={() => setDrawing((current) => !current)}>
          Draw
        </button>
        <button type="button" disabled={!strokes.length || saving} onClick={() => setStrokes([])}>
          Clear drawing
        </button>
      </div>

      <div className="momentDecoratorActions">
        <button type="button" disabled={!ready || saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Use photo"}
        </button>
        <button type="button" disabled={saving} onClick={onBack}>Back to crop</button>
        <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
