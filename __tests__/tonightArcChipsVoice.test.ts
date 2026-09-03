import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightArcChips from "@/components/map/TonightArcChips";
import { defaultVenueKindVisibility } from "@/lib/venueKindFilters";

// A component name is not reader words. "TONIGHT ARC" printed over the desktop
// map and stood as a section heading in the phone Filters sheet, in the
// accessibility tree as well as on screen. docs/VOICE.md rule 2 bans exactly
// that. The chips name the venue types themselves, so the group needs no title.

function render(variant: "map" | "sheet"): string {
  return renderToStaticMarkup(
    createElement(TonightArcChips, {
      visibility: defaultVenueKindVisibility(),
      variant,
      onChange: vi.fn(),
    }),
  );
}

describe("Venue-type chips — no component name reaches the reader", () => {
  for (const variant of ["map", "sheet"] as const) {
    it(`prints no internal name in the ${variant} variant`, () => {
      const html = render(variant);
      expect(html.toLowerCase()).not.toContain("tonight arc");
      // The accessible name is read out loud, so it is copy too.
      expect(html).toContain('aria-label="Venue types"');
      // The chips are still there, and they still say what they filter.
      expect(html).toContain("Pints");
      expect(html).toContain("Restaurants");
    });
  }
});
