"use client";

import { GlassWater, Map, Utensils } from "lucide-react";

import type { MapExperienceLens as MapExperienceLensValue } from "@/lib/mapExperienceLens";

import "./mapExperienceLens.css";

/**
 * The three map views, and the one place their names are written.
 *
 * The desktop control that OPENS this panel prints the active view in its own
 * label, because the panel is closed at rest (design judgement 2026-08-01,
 * finding 2.15): a lens nobody can see is a filtered map with no visible
 * cause. Both surfaces read this table so the two names cannot drift.
 */
export const MAP_EXPERIENCE_LENS_OPTIONS = [
  { id: "all", label: "All", Icon: Map },
  { id: "no-alcohol", label: "No alcohol", Icon: GlassWater },
  { id: "food", label: "Food", Icon: Utensils },
] as const;

const OPTIONS = MAP_EXPERIENCE_LENS_OPTIONS;

export default function MapExperienceLens({
  lens,
  allSelected = true,
  summary,
  onChange,
}: {
  lens: MapExperienceLensValue;
  allSelected?: boolean;
  summary: string;
  onChange: (lens: MapExperienceLensValue) => void;
}) {
  return (
    <section className="mapExperienceLens" aria-labelledby="mapExperienceLensTitle">
      <div className="mapExperienceLensHead">
        <span id="mapExperienceLensTitle">Show me</span>
        <small>Prices and places for your night</small>
      </div>
      <div className="mapExperienceLensOptions" role="group" aria-label="Map view">
        {OPTIONS.map(({ id, label, Icon }) => {
          const selected = lens === id && (id !== "all" || allSelected);
          return (
            <button
              key={id}
              type="button"
              className={
                selected
                  ? "mapExperienceLensOption isSelected"
                  : "mapExperienceLensOption"
              }
              aria-pressed={selected}
              onClick={() => onChange(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {summary ? (
        <p className="mapExperienceLensSummary" role="status" aria-live="polite">
          {summary}
        </p>
      ) : null}
    </section>
  );
}
