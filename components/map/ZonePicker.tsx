"use client";

// Zone picker — the map's fare-zone lens. Sits alongside the existing filter
// chips (Drinks / Plan) and matches that idiom: a compact control that filters
// the pins. Opens a small selector (All + zones 1–6) and, as a tappable detail,
// the honest "Zone pint index" strip (median pint per zone, low-observation
// gate). Selecting a zone sets filters.zone; the pins re-filter via
// venueMatchesZone (lib/venues → lib/zones).

import { MapPin } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import ZonePintIndexStrip from "@/components/zones/ZonePintIndexStrip";
import { ZONE_IDS, parseZoneParam, type ZonePintIndex } from "@/lib/zones";

import "./zonePicker.css";

type ZonePickerProps = {
  /** filters.zone — "" / "all" means every zone. */
  zone: string;
  onZoneChange: (zone: string) => void;
  index: ZonePintIndex;
  /**
   * "toolbar" (default) renders a button that toggles a popover — for the map
   * chip row. "inline" renders the chips + index directly, for the mobile
   * filters sheet where it sits beside the drink chips. Both variants retain
   * the index basis.
   */
  variant?: "toolbar" | "inline";
};

function ZoneChips({
  active,
  onPick,
}: {
  active: number | null;
  onPick: (zone: string) => void;
}) {
  return (
    <div className="zoneChips" role="group" aria-label="Filter by fare zone">
      <button
        type="button"
        className={active === null ? "zoneChip isOn" : "zoneChip"}
        aria-pressed={active === null}
        onClick={() => onPick("")}
      >
        All
      </button>
      {ZONE_IDS.map((zoneId) => {
        const on = active === zoneId;
        return (
          <button
            key={zoneId}
            type="button"
            className={on ? "zoneChip isOn" : "zoneChip"}
            aria-pressed={on}
            aria-label={`Zone ${zoneId}${on ? " (selected)" : ""}`}
            onClick={() => onPick(String(zoneId))}
          >
            {zoneId}
          </button>
        );
      })}
    </div>
  );
}

export default function ZonePicker({
  zone,
  onZoneChange,
  index,
  variant = "toolbar",
}: ZonePickerProps) {
  const parsed = parseZoneParam(zone);
  const active = parsed === "all" || parsed === null ? null : parsed;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the toolbar popover on outside click / Escape.
  useEffect(() => {
    if (variant !== "toolbar" || !open) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Claim the key so the map-level Escape (close drawer) doesn't also fire.
        event.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, variant]);

  const body = (
    <>
      <ZoneChips active={active} onPick={onZoneChange} />
      <ZonePintIndexStrip
        index={index}
        activeZone={active}
        compact
        onPickZone={(zoneId) => onZoneChange(String(zoneId))}
      />
    </>
  );

  if (variant === "inline") {
    return (
      <div className="zonePicker isInline">
        <p className="zonePickerInlineLabel">Fare zone</p>
        {body}
      </div>
    );
  }

  return (
    <div className="zonePicker" ref={rootRef}>
      <button
        type="button"
        className={open || active !== null ? "zonePickerBtn isActive" : "zonePickerBtn"}
        aria-pressed={active !== null}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <MapPin size={15} aria-hidden="true" />
        <span>{active === null ? "Zone" : `Zone ${active}`}</span>
      </button>
      {open ? (
        <div className="zonePickerPanel" id={panelId} role="group" aria-label="Fare zone lens">
          {body}
        </div>
      ) : null}
    </div>
  );
}
