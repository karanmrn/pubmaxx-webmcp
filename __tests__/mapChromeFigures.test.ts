// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComposerPriceStep } from "@/components/map/composer/ComposerPriceStep";
import { formatPriceChipGbp, QUICK_ADD_PRICES_GBP } from "@/lib/spill";

// D7 — two pieces of small dirt the taste gate found in map chrome, kept apart
// here because both are about what a control PRINTS.
//
//   1. The quick-add price chips carried "£6.9": the 69 gag standing beside real
//      logged figures, which docs/VOICE.md bans outright, and printed with one
//      decimal where a price has two.
//   2. The map carried two controls both reading "London" — the camera-fit pill
//      and the toolbar's city dropdown. The name belongs to the control that can
//      change it.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

let container: HTMLDivElement;
let root: Root | null = null;

function PriceStepHarness() {
  const [dropForm, setDropForm] = useState({
    price: "",
    drink: "",
    note: "",
    era: "",
    withWho: "",
  });
  return createElement(ComposerPriceStep, {
    dropForm,
    setDropForm,
    priceQuickAdds: [...QUICK_ADD_PRICES_GBP],
    lastKnownPrice: null,
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("quick-add price presets", () => {
  it("offers only round price points, so no figure is a joke", () => {
    for (const price of QUICK_ADD_PRICES_GBP) {
      expect(
        Math.round(price * 100) % 50,
        `£${price} is not a round price point`,
      ).toBe(0);
    }
  });

  it("prints every preset with both pence", () => {
    for (const price of QUICK_ADD_PRICES_GBP) {
      expect(formatPriceChipGbp(price)).toMatch(/^\d+\.\d{2}$/);
    }
    expect(formatPriceChipGbp(4)).toBe("4.00");
    expect(formatPriceChipGbp(4.5)).toBe("4.50");
  });

  it("updates the price field when a rendered chip is clicked", async () => {
    const expectedPrice = formatPriceChipGbp(QUICK_ADD_PRICES_GBP[0]);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(PriceStepHarness));
    });

    const chip = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes(`£${expectedPrice}`),
    );
    expect(chip).toBeTruthy();

    await act(async () => {
      (chip as HTMLButtonElement).click();
    });

    expect((container.querySelector('input[placeholder="£"]') as HTMLInputElement).value).toBe(
      expectedPrice,
    );
  });
});

describe("map chrome names a city once", () => {
  it("keeps the city name on the switcher, not on the camera-fit control", () => {
    const canvas = read("components/PubMapCanvas.tsx");
    const button =
      canvas.match(/className="mapFitLondonBtn"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain("Show all");
    // A bare `{cityDisplayName}` is the PRINTED name; `${cityDisplayName}`
    // inside the accessible name is the one that may stay.
    expect(button).not.toMatch(/(?<!\$)\{cityDisplayName\}/);
    // The accessible name still says which city, and leads with the visible
    // words so a voice command matching the label still reaches the control.
    expect(button).toMatch(/aria-label=\{`Show all of \$\{cityDisplayName\}`\}/);
  });
});
