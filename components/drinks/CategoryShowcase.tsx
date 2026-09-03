"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiHTMLAttributes, ReactElement } from "react";

// CategoryShowcase — the flagship of the E5 colour system. Two modes off one
// component:
//   · legend mode (default) — a compact swatch grid demonstrating the whole
//     drink palette at a glance (a menu header / footer flourish);
//   · explore mode (`hrefFor` provided) — a REAL "Explore by drink" grid of
//     tappable category cards (colour + glyph + label), each a deep-link into a
//     filtered view.
// When `onCategoryActivate` is also provided (Discover brand chips), cards
// select the category first so brand chips can appear; the category-only map
// link lives in the parent brand panel.
// Consumes only OWNED assets: DrinkGlyph (our IP SVGs) + the `--cat-*` tokens,
// on a `.textured-panel` paper/linen surface. Correct in light, dark AND Legacy
// Mode with no per-theme code — everything flips via the cascade. The glyph +
// label always accompany the colour (never colour alone, WCAG 1.4.1).
//
// D6 — in explore mode the lane also renders 44px prev/next scroll buttons
// (shown ≥1024px via CSS) so desktop pointers can reach clipped cards; mobile
// keeps native touch scrolling untouched (buttons are display:none there).
import {
  CATEGORY_META,
  DRINK_CATEGORIES,
  MAP_LENS_DRINK_CATEGORIES,
} from "@/lib/drinks";
import type { DrinkCategory } from "@/lib/drinks";
import { DrinkGlyph } from "./DrinkGlyph";
import "./categoryShowcase.css";

export type CategoryShowcaseExtraItem = ReactElement<LiHTMLAttributes<HTMLLIElement>, "li">;

export interface CategoryShowcaseProps {
  /** Optional heading; omit to render just the swatch grid. */
  title?: string;
  /** Glyph pixel size. Defaults to 28 (legend) / 34 (explore). */
  glyphSize?: number;
  className?: string;
  /**
   * When provided, each category renders as a tappable card linking to this
   * href — turning the legend into a real "Explore by drink" grid. Omit for the
   * static legend. Ignored for navigation when `onCategoryActivate` is set
   * (parent shows brand chips + the category-only map link). Only called for
   * categories the map can actually lens.
   */
  hrefFor?: (category: DrinkCategory) => string;
  /** Optional sub-label under each category (explore mode), e.g. "Find a pub". */
  cardHint?: string;
  /** Optional extra <li> cards rendered in the same grid, e.g. Low/No alcohol. */
  extraItems?: CategoryShowcaseExtraItem | CategoryShowcaseExtraItem[];
  /** Whether extra cards appear before or after the canonical drink categories. */
  extraItemsPosition?: "start" | "end";
  /** When set, category cards select first (brand-chip flow) instead of navigating. */
  onCategoryActivate?: (category: DrinkCategory) => void;
  /** Currently selected category for the brand-chip flow. */
  activeCategory?: DrinkCategory | null;
}

export function CategoryShowcase({
  title = "Every drink, every colour",
  glyphSize,
  className,
  hrefFor,
  cardHint,
  extraItems,
  extraItemsPosition = "end",
  onCategoryActivate,
  activeCategory = null,
}: CategoryShowcaseProps) {
  const explore = Boolean(hrefFor) || Boolean(onCategoryActivate);
  // Legend mode is the whole palette; explore mode is a set of promises to
  // open a filtered view, so it can only offer categories that view honours.
  // A card leading to an unfiltered map reads as a broken destination rather
  // than one that was never on offer.
  const cardCategories = explore
    ? MAP_LENS_DRINK_CATEGORIES
    : DRINK_CATEGORIES;
  const size = glyphSize ?? (explore ? 34 : 28);

  // D6 — desktop scroll affordances. The explore lane clips cards mid-tile at
  // wide viewports with no pointer affordance, so we track whether each end of
  // the rail has anywhere left to go and disable the matching arrow at the
  // extremes. Buttons only paint ≥1024px (CSS); this state is inert on mobile.
  const gridRef = useRef<HTMLUListElement | null>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateScrollState = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    setCanScrollPrev(grid.scrollLeft > 1);
    setCanScrollNext(grid.scrollLeft < maxScroll - 1);
  }, []);

  useEffect(() => {
    if (!explore) return;
    const grid = gridRef.current;
    if (!grid) return;
    updateScrollState();
    grid.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateScrollState);
    resizeObserver?.observe(grid);
    return () => {
      grid.removeEventListener("scroll", updateScrollState);
      resizeObserver?.disconnect();
    };
  }, [explore, updateScrollState]);

  const scrollRail = useCallback((direction: -1 | 1) => {
    const grid = gridRef.current;
    if (!grid) return;
    // ~80% of the visible lane per press keeps a card of shared context.
    const amount = Math.max(Math.round(grid.clientWidth * 0.8), 200);
    // Functional motion, not decorative: reduced-motion users still get the
    // scroll, just as an instant jump instead of a smooth glide.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    grid.scrollBy({
      left: direction * amount,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  const grid = (
    <ul className="catShowcase__grid" ref={gridRef}>
      {extraItemsPosition === "start" ? extraItems : null}
      {cardCategories.map((category) => {
        const label = CATEGORY_META[category].label;
        const isActive = activeCategory === category;
        const inner = (
          <>
            <span
              className="catShowcase__swatch"
              style={{ color: `var(--cat-${category})` }}
            >
              <DrinkGlyph category={category} size={size} inheritColor />
            </span>
            <span className="catShowcase__labelWrap">
              <span className="catShowcase__label">{label}</span>
              {explore && cardHint ? (
                <span className="catShowcase__hint">{cardHint}</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li
            key={category}
            className={`catShowcase__item${isActive ? " catShowcase__item--active" : ""}`}
            // The category token drives the card's tint/border in explore mode
            // (CSS reads --cat via currentColor on the swatch; here we also
            // expose it to the card frame).
            style={
              explore
                ? ({ ["--cat" as string]: `var(--cat-${category})` } as React.CSSProperties)
                : undefined
            }
          >
            {onCategoryActivate ? (
              <button
                type="button"
                className="catShowcase__link"
                aria-label={`Choose ${label}`}
                aria-pressed={isActive}
                onClick={() => onCategoryActivate(category)}
              >
                {inner}
              </button>
            ) : explore && hrefFor ? (
              <Link
                className="catShowcase__link pressable"
                href={hrefFor(category)}
                aria-label={`Explore ${label}`}
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
      {extraItemsPosition === "end" ? extraItems : null}
    </ul>
  );

  return (
    <section
      className={`catShowcase textured-panel${explore ? " catShowcase--explore" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={explore ? "Explore drinks by category" : "Drink category colours"}
    >
      {title ? <h3 className="catShowcase__title">{title}</h3> : null}
      {explore ? (
        <div className="catShowcase__rail">
          <button
            type="button"
            className="catShowcase__arrow catShowcase__arrow--prev"
            aria-label="Scroll drink categories left"
            onClick={() => scrollRail(-1)}
            disabled={!canScrollPrev}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {grid}
          <button
            type="button"
            className="catShowcase__arrow catShowcase__arrow--next"
            aria-label="Scroll drink categories right"
            onClick={() => scrollRail(1)}
            disabled={!canScrollNext}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        grid
      )}
    </section>
  );
}
