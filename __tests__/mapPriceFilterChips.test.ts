// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapPriceFilterChips from "@/components/map/MapPriceFilterChips";
import { initialFilters } from "@/components/map/ControlRail";
import { NO_PINT_PRICE_CAP, type Filters } from "@/lib/venues";

// The cap chips are a real control, so a click is the only honest proof: it
// must write the cap AND close the Layers popover the way the retired corner
// control closed its own panel. jsdom, because a click is the whole point.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(filters: Filters, onFiltersChange: (next: Filters) => void, onPicked: () => void) {
  act(() => {
    root.render(
      createElement(MapPriceFilterChips, { filters, onFiltersChange, onPicked }),
    );
  });
}

function chip(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no cap chip labelled ${label}`);
  return found as HTMLButtonElement;
}

describe("MapPriceFilterChips", () => {
  it("writes the picked cap and closes Layers behind it", () => {
    const onFiltersChange = vi.fn();
    const onPicked = vi.fn();
    render(initialFilters, onFiltersChange, onPicked);

    act(() => {
      chip("≤ £5.50").click();
    });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange.mock.calls[0][0]).toMatchObject({ maxPrice: 5.5 });
    expect(onPicked).toHaveBeenCalledTimes(1);
  });

  it("keeps every other filter the reader already set", () => {
    const onFiltersChange = vi.fn();
    const held: Filters = {
      ...initialFilters,
      query: "camden",
      requireBeerGarden: true,
      maxPrice: 5.5,
    };
    render(held, onFiltersChange, () => undefined);

    act(() => {
      chip("≤ £7").click();
    });

    expect(onFiltersChange.mock.calls[0][0]).toEqual({ ...held, maxPrice: 7 });
  });

  it("presses exactly the cap that is in force, and reads Any as no cap", () => {
    render(initialFilters, () => undefined, () => undefined);
    expect(initialFilters.maxPrice).toBe(NO_PINT_PRICE_CAP);
    expect(chip("Any").getAttribute("aria-pressed")).toBe("true");
    expect(chip("≤ £5.50").getAttribute("aria-pressed")).toBe("false");
    expect(chip("≤ £7").getAttribute("aria-pressed")).toBe("false");

    render({ ...initialFilters, maxPrice: 7 }, () => undefined, () => undefined);
    expect(chip("Any").getAttribute("aria-pressed")).toBe("false");
    expect(chip("≤ £7").getAttribute("aria-pressed")).toBe("true");
  });
});
