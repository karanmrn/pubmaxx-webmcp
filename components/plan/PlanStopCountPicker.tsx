"use client";

import { PLAN_STOP_COUNTS, normalizePlanStopCount, type PlanStopCount } from "@/lib/planStopCount";

export default function PlanStopCountPicker({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: PlanStopCount) => void;
}) {
  const selected = normalizePlanStopCount(value);
  return (
    <div className="planStopCount" role="group" aria-label="Number of pub stops">
      <span className="planStopCount__label">Stops</span>
      <div className="planStopCount__choices">
        {PLAN_STOP_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={selected === count}
            onClick={() => onChange(count)}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}
