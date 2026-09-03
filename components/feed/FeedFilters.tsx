"use client";

import { useEffect, useRef, useState } from "react";
import { FEED_FILTERS, type FeedFilter } from "@/lib/feed";

type FeedFiltersProps = {
  active: FeedFilter;
  onChange: (filter: FeedFilter) => void;
};

// Airbnb-clean lane switcher: primary lanes first; demo / niche lanes behind More.
// `friends` is intentionally absent — the Social Loop's "Your lot" tab owns the
// friends lane now (spec #393), so it never returns as a chip here.
const PRIMARY_FILTERS = FEED_FILTERS.filter(
  (f) =>
    f.id === "latest" ||
    f.id === "for-you" ||
    f.id === "tonight" ||
    f.id === "cheap",
);
const MORE_FILTERS = FEED_FILTERS.filter((f) => !PRIMARY_FILTERS.some((p) => p.id === f.id));

export default function FeedFilters({ active, onChange }: FeedFiltersProps) {
  const moreActive = MORE_FILTERS.some((f) => f.id === active);
  const [moreOpen, setMoreOpen] = useState(moreActive);
  // When a More-lane filter is active but the strip is collapsed, keep that
  // chip visible so the active lane isn't hidden behind a lit "More" only.
  const visible = moreOpen
    ? FEED_FILTERS
    : moreActive
      ? [...PRIMARY_FILTERS, ...MORE_FILTERS.filter((f) => f.id === active)]
      : PRIMARY_FILTERS;

  // Mobile edge-fade hint — the last chip ("Cheapest") used to read as simply
  // cut off with no affordance that the strip scrolls further right. (The active
  // chip's own filled state is the only selected-lane cue now; the decorative
  // gliding underline was removed per the owner's 2026-07-23 ruling.)
  const railRef = useRef<HTMLDivElement | null>(null);
  const [hintMore, setHintMore] = useState(false);

  // Recompute on resize/scroll so the edge-fade backs off once the viewer has
  // actually scrolled to the end — never a fade hinting at content that isn't
  // there.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => {
      setHintMore(rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 4);
    };
    update();
    rail.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(rail);
    }
    return () => {
      rail.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [visible.length]);

  return (
    <div
      className={`feedFilters${hintMore ? " hasScrollHint" : ""}`}
      ref={railRef}
      role="group"
      aria-label="Feed lanes"
    >
      {visible.map((filter) => {
        const isActive = filter.id === active;
        return (
          <button
            key={filter.id}
            type="button"
            className={`feedFilterChip${isActive ? " isActive" : ""}`}
            aria-pressed={isActive}
            onClick={() => onChange(filter.id)}
          >
            {filter.label}
            {filter.demo ? (
              <span className="feedFilterDemo" title="Demo lane. Best-effort in this prototype">
                demo
              </span>
            ) : null}
          </button>
        );
      })}
      {!moreOpen ? (
        <button
          type="button"
          className={`feedFilterChip feedFilterMore${moreActive ? " isActive" : ""}`}
          aria-expanded={false}
          onClick={() => setMoreOpen(true)}
        >
          More
        </button>
      ) : (
        <button
          type="button"
          className="feedFilterChip feedFilterMore"
          aria-expanded={true}
          onClick={() => setMoreOpen(false)}
        >
          Less
        </button>
      )}
    </div>
  );
}
