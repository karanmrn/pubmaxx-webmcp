import { Footprints, Route as RouteIcon, TrainFront, X } from "lucide-react";

// Presentational "N stops mapped" chip with edit / last-train / hide actions.
// Global CSS (mappedRouteChip) is already imported by PubMap. Extracted
// verbatim from PubMap (F1); the routeMappedActive guard stays in PubMap.
export function MappedRouteChip({
  stopCount,
  totalKm,
  totalMinutes,
  onEdit,
  onCheckLastTrain,
  onHide,
}: {
  stopCount: number;
  totalKm: number;
  totalMinutes: number;
  onEdit: () => void;
  onCheckLastTrain: () => void;
  onHide: () => void;
}) {
  return (
    <div className="mappedRouteChip" role="status" aria-live="polite">
      <RouteIcon size={16} aria-hidden="true" />
      <div>
        <strong>{stopCount} stops mapped</strong>
        <span>
          <Footprints size={12} aria-hidden="true" />
          {totalKm.toFixed(1)} km, {totalMinutes} min walk
        </span>
      </div>
      <button type="button" onClick={onEdit}>
        Edit
      </button>
      <button
        type="button"
        onClick={onCheckLastTrain}
        aria-label="Check last train at final stop"
        title="Last train"
      >
        <TrainFront size={14} aria-hidden="true" />
      </button>
      <button type="button" onClick={onHide} aria-label="Hide mapped crawl">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
