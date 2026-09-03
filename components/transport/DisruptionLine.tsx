"use client";

// Material TfL disruption line (ticket 3.7) — the one compact line that renders
// in the get-home / get-there area WHEN a night-shaping disruption touches the
// patch the drinker is in tonight, and renders NOTHING otherwise. Shared by the
// Tonight get-home strip and the /today get-there card so both surfaces speak
// with one voice and one provenance.
//
// It never becomes a spinner or an empty state: the whole layer is silent unless
// there is something material to say. React 19 rules mirror the get-home strip:
// the fetch fires in an effect keyed on the rounded point, state settles only in
// the async resolution/catch, and an AbortController cancels on unmount / move.
// Privacy: the point is rounded (coarsenViewerPoint, ~110m) before it leaves the device,
// exactly as the last-train fetch already does.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { PatchDisruption } from "@/lib/tflDisruption";

import "./disruptionLine.css";

type Props = { lat: number; lng: number };

type DisruptionResponse = { disruption?: PatchDisruption | null };

export default function DisruptionLine({ lat, lng }: Props) {
  const [disruption, setDisruption] = useState<PatchDisruption | null>(null);
  const { lat: rlat, lng: rlng } = coarsenViewerPoint({ lat, lng });

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<DisruptionResponse>(
      `/api/tfl-disruption?lat=${rlat}&lng=${rlng}`,
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "disruption" in body),
      },
      (body) => setDisruption(body.disruption ?? null),
    );
    return () => controller.abort();
  }, [rlat, rlng]);

  if (!disruption) return null;

  return (
    <p className="transportDisruption" data-testid="tfl-disruption">
      <AlertTriangle size={14} aria-hidden="true" className="transportDisruptionIcon" />
      <span className="transportDisruptionCopy">
        {disruption.line}.{" "}
        <span className="transportDisruptionProv">via TfL</span>
      </span>
    </p>
  );
}
