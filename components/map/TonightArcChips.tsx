"use client";

import { useId, useState } from "react";

import {
  toggleVenueKind,
  type CuratedVenueKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";

import "./tonightArcChips.css";

const CHIPS: ReadonlyArray<{
  kind: CuratedVenueKind | "club";
  label: string;
  unavailableReason?: string;
}> = [
  { kind: "pub", label: "Pints" },
  { kind: "bar", label: "Bars" },
  { kind: "club", label: "Clubs", unavailableReason: "are not mapped yet" },
  { kind: "food", label: "Food" },
  { kind: "restaurant", label: "Restaurants" },
];

export default function TonightArcChips({
  visibility,
  experienceLens = "all",
  variant = "map",
  onChange,
}: {
  visibility: VenueKindVisibility;
  experienceLens?: MapExperienceLens;
  /**
   * Where the toggles are read.
   *
   * "map" floats them over the desktop map under the control bar. "sheet" is
   * the phone home: the Filters sheet, beside "Show me". A phone gets ONE of
   * the two, never both (design judgement 2026-08-01, finding 2.3) — a second
   * copy in the chrome was the third stacked bar that buried the map.
   */
  variant?: "map" | "sheet";
  onChange: (next: VenueKindVisibility) => void;
}) {
  const unavailableReasonId = useId();
  const [revealedUnavailableKind, setRevealedUnavailableKind] = useState<
    CuratedVenueKind | "club" | null
  >(null);
  const chips =
    experienceLens === "food"
      ? CHIPS.filter(
          (chip) => chip.kind === "food" || chip.kind === "restaurant",
        )
      : CHIPS.filter((chip) => experienceLens === "all" || chip.kind !== "club");
  const revealedUnavailableChip = chips.find(
    (chip) => chip.kind === revealedUnavailableKind,
  );
  return (
    <div
      className={
        variant === "sheet" ? "tonightArcChips tonightArcChipsSheet" : "tonightArcChips"
      }
      role="group"
      /* Reader words, not the component's name. "Tonight arc" is what this file
         is called; it printed on the map and in the accessibility tree, which
         docs/VOICE.md rule 2 bans. The chips name the venue types themselves,
         so the group needs no title above them, only this accessible name.
         Two lanes named this group at once. This one wins because it is the
         shorter of the two and the group is already known to be on the map;
         __tests__/voiceComplianceAudit.test.ts was amended to expect it. */
      aria-label="Venue types"
    >
      <div className="tonightArcRow">
        {chips.map((chip) => {
          const on = chip.kind === "club" ? false : visibility[chip.kind];
          const unavailable = chip.unavailableReason !== undefined;
          const unavailableRevealed =
            unavailable && revealedUnavailableKind === chip.kind;
          return (
            <button
              key={chip.kind}
              type="button"
              className={`tonightArcChip${on ? " isOn" : ""}${unavailable ? " isUnavailable" : ""}`}
              aria-pressed={on}
              aria-disabled={unavailable || undefined}
              aria-expanded={unavailable ? unavailableRevealed : undefined}
              aria-controls={unavailable ? unavailableReasonId : undefined}
              aria-label={
                unavailable
                  ? `${chip.label} ${chip.unavailableReason}`
                  : undefined
              }
              title={unavailable ? `${chip.label} ${chip.unavailableReason}` : undefined}
              onClick={() => {
                if (unavailable) {
                  setRevealedUnavailableKind(
                    unavailableRevealed ? null : chip.kind,
                  );
                  return;
                }
                setRevealedUnavailableKind(null);
                if (chip.kind !== "club") {
                  onChange(toggleVenueKind(visibility, chip.kind));
                }
              }}
            >
              {/* The tick, not a colour, marks selection (aria-pressed already
                  names it for readers, so the glyph stays decorative). */}
              {on ? (
                <span className="tonightArcChipTick" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              <span className="tonightArcChipLabel">
                {experienceLens === "no-alcohol" && chip.kind === "pub"
                  ? "Pubs"
                  : chip.label}
              </span>
            </button>
          );
        })}
      </div>
      {revealedUnavailableChip?.unavailableReason ? (
        <span
          className="tonightArcUnavailableReason"
          id={unavailableReasonId}
          role="tooltip"
        >
          {revealedUnavailableChip.label}{" "}
          {revealedUnavailableChip.unavailableReason}
        </span>
      ) : null}
    </div>
  );
}
