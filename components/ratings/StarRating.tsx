"use client";

// StarRating (PRD E3): the one star row, in two modes.
//
//   • DISPLAY — a read-only 5-star row with true half-star rendering (a
//     clipped filled overlay on an outline row), role="img" with the value in
//     the accessible name. `value: null` renders nothing filled — an unrated
//     item is honestly blank, never zero stars.
//   • INTERACTIVE — a keyboard-accessible picker: role="slider",
//     aria-valuenow/-min/-max/-text; ← ↓ / → ↑ adjust by half a star,
//     Home/End jump to 1/5, Enter or Space commits, Escape reverts. Pointer:
//     click anywhere on the row — the position snaps to the nearest half star
//     and commits immediately.
//
// Colour rides ONE CSS custom property, `--rating-accent`, defaulting to the
// app's brass accent — a category surface (wine burgundy, whisky amber, …)
// re-tints stars by setting the var, never by new CSS.

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import {
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  isRatingValue,
  type RatingValue,
} from "@/lib/ratings";

import "./starRating.css";

const STAR_COUNT = 5;

function clampToStep(value: number): RatingValue {
  const snapped =
    Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, value)) / RATING_STEP) *
    RATING_STEP;
  return (isRatingValue(snapped) ? snapped : RATING_MAX) as RatingValue;
}

// The five glyph cells: an outline row with a width-clipped filled row on top.
function Stars({ value, accent }: { value: number | null; accent?: string }) {
  const percent = value === null ? 0 : (value / STAR_COUNT) * 100;
  const style = accent
    ? ({ "--rating-accent": accent } as CSSProperties)
    : undefined;
  return (
    <span className="starRatingGlyphs" style={style} aria-hidden="true">
      <span className="starRatingRow starRatingRow--empty">★★★★★</span>
      <span className="starRatingRow starRatingRow--fill" style={{ width: `${percent}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

export type StarRatingProps = {
  /** The value to show: an aggregate or the viewer's own vote. Null = unrated
   *  (blank stars — never rendered as zero). */
  value: number | null;
  /** Accessible name for the row, e.g. "The Grapes community rating". */
  label: string;
  /** Interactive picker mode; requires onRate. */
  interactive?: boolean;
  /** Called with the committed value (Enter/Space, or a click). */
  onRate?: (value: RatingValue) => void;
  /** Optional accent override (a category colour); defaults to brass via CSS. */
  accent?: string;
  /** Compact sizing for dense rows (the drink menu). */
  size?: "sm" | "md";
  className?: string;
};

export default function StarRating({
  value,
  label,
  interactive = false,
  onRate,
  accent,
  size = "md",
  className,
}: StarRatingProps) {
  // The keyboard-adjusted, not-yet-committed value (interactive mode only).
  const [draft, setDraft] = useState<RatingValue | null>(null);

  const classes = ["starRating", `starRating--${size}`, className]
    .filter(Boolean)
    .join(" ");

  if (!interactive || !onRate) {
    return (
      <span
        className={classes}
        role="img"
        aria-label={
          value === null ? `${label}: not rated yet` : `${label}: ${value} out of 5 stars`
        }
      >
        <Stars value={value} accent={accent} />
      </span>
    );
  }

  const shown = draft ?? (value !== null ? clampToStep(value) : null);

  const commit = (next: RatingValue) => {
    setDraft(null);
    onRate(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const current = shown ?? 3;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        setDraft(clampToStep(current + RATING_STEP));
        break;
      case "ArrowLeft":
      case "ArrowDown":
        setDraft(clampToStep(current - RATING_STEP));
        break;
      case "Home":
        setDraft(RATING_MIN as RatingValue);
        break;
      case "End":
        setDraft(RATING_MAX as RatingValue);
        break;
      case "Enter":
      case " ":
        if (draft !== null) commit(draft);
        break;
      case "Escape":
        setDraft(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const fraction = (event.clientX - box.left) / box.width;
    commit(clampToStep(fraction * STAR_COUNT));
  };

  return (
    <span
      className={`${classes} starRating--interactive`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={RATING_MIN}
      aria-valuemax={RATING_MAX}
      aria-valuenow={shown ?? RATING_MIN}
      aria-valuetext={
        shown === null
          ? "Not rated yet. Use arrow keys to pick, Enter to save"
          : `${shown} out of 5 stars${draft !== null ? ". Press Enter to save" : ""}`
      }
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <Stars value={shown} accent={accent} />
    </span>
  );
}
