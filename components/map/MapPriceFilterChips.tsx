"use client";

// The max pint price cap, as chips. It lives inside Layers beside the price
// key: the cap is a reader control, and a reader control does not float over
// the pins (see lib/mapSurfaceChrome.ts).

import { NO_PINT_PRICE_CAP, type Filters } from "@/lib/venues";

const PRICE_OPTIONS: { label: string; maxPrice: number; tone: string }[] = [
  // "Any" has to be the one OFF value, or picking it leaves a cap behind that
  // no control reads back. See NO_PINT_PRICE_CAP.
  { label: "Any", maxPrice: NO_PINT_PRICE_CAP, tone: "any" },
  { label: "≤ £5.50", maxPrice: 5.5, tone: "green" },
  { label: "≤ £7", maxPrice: 7, tone: "amber" },
];

function priceCapIsActive(filters: Filters, maxPrice: number): boolean {
  return maxPrice >= NO_PINT_PRICE_CAP
    ? filters.maxPrice >= NO_PINT_PRICE_CAP
    : Math.abs(filters.maxPrice - maxPrice) < 0.01;
}

export default function MapPriceFilterChips({
  filters,
  onFiltersChange,
  onPicked,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onPicked: () => void;
}) {
  return (
    <div className="mapLayersPriceBlock">
      <p className="mapLayersSectionLabel">Maximum pint price</p>
      <div
        className="mapLayersPriceOptions"
        role="group"
        aria-label="Max pint price"
      >
        {PRICE_OPTIONS.map((option) => {
          const on = priceCapIsActive(filters, option.maxPrice);
          return (
            <button
              key={option.label}
              type="button"
              className={on ? "mapLayersPriceChip isOn" : "mapLayersPriceChip"}
              aria-pressed={on}
              onClick={() => {
                onFiltersChange({ ...filters, maxPrice: option.maxPrice });
                onPicked();
              }}
            >
              <i
                className={`mapLayersPriceDot ${option.tone}`}
                aria-hidden="true"
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
