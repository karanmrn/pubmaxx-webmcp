import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TRAILING_EDGE_FADE_PX,
  shouldFadeTrailingEdge,
} from "@/lib/useTrailingEdgeFade";

/**
 * B1, 2026-08-03. The venue sheet's last tab read as a disabled control.
 *
 * The tab strip carried a STATIC right-edge mask. At 390px the strip overflows
 * by about 5px while the mask eats 28px, so "Last train" stayed half-faded at
 * every scroll position, the end of the scroll included. Half opacity is how
 * this product draws a control a reader may not use, so the tab read as dead.
 *
 * A fade promises hidden content. This pins the two cases where that promise is
 * false, and pins the CSS to the width the hook publishes, because the mask
 * lives in a stylesheet and the predicate lives in TypeScript.
 */

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

const sheetCss = read("components/map/venueSheet.css");

describe("B1 - the venue tab strip fades only what is really hidden", () => {
  it("never fades at the end of the scroll", () => {
    // A wide strip: 200px hidden, so the fade is honest until the reader
    // reaches the end.
    expect(shouldFadeTrailingEdge({ scrollLeft: 0, scrollWidth: 560, clientWidth: 360 })).toBe(true);
    expect(shouldFadeTrailingEdge({ scrollLeft: 120, scrollWidth: 560, clientWidth: 360 })).toBe(true);
    expect(shouldFadeTrailingEdge({ scrollLeft: 200, scrollWidth: 560, clientWidth: 360 })).toBe(false);
  });

  it("tolerates a sub-pixel end of scroll", () => {
    // Fractional layout means scrollLeft rarely lands exactly on the overflow.
    expect(shouldFadeTrailingEdge({ scrollLeft: 199.4, scrollWidth: 560, clientWidth: 360 })).toBe(false);
  });

  it("never fades when the whole overflow is narrower than the fade", () => {
    // The 390px case that shipped the defect: 5px of overflow under a 28px
    // mask can only ever dim a tab the reader can already see.
    const phone = { scrollWidth: 355, clientWidth: 350 };
    expect(shouldFadeTrailingEdge({ scrollLeft: 0, ...phone })).toBe(false);
    expect(shouldFadeTrailingEdge({ scrollLeft: 5, ...phone })).toBe(false);
  });

  it("never fades a strip that does not scroll at all", () => {
    // The desktop inspector wraps its tabs instead of scrolling them.
    expect(shouldFadeTrailingEdge({ scrollLeft: 0, scrollWidth: 420, clientWidth: 420 })).toBe(false);
  });

  it("keeps the shipped mask behind the attribute the hook sets", () => {
    const gated = sheetCss.match(
      /\.venueTabs\[data-trailing-fade="on"\]\s*\{([^}]*)\}/u,
    );
    expect(gated, "the gated fade rule").not.toBeNull();
    expect(gated![1]).toMatch(/mask-image:/);
    expect(gated![1]).toMatch(/-webkit-mask-image:/);

    // No ungated `.venueTabs` rule may paint a mask, or the gate is decorative:
    // a later unconditional rule would win and the defect would be back.
    for (const [, selector, body] of sheetCss.matchAll(
      /^(\s*\.venueTabs[^{,]*)\{([^}]*)\}/gmu,
    )) {
      if (selector.includes("data-trailing-fade")) continue;
      expect(body, `${selector.trim()} must not paint a mask`).not.toMatch(/mask-image:/);
    }
  });

  it("keeps the CSS fade width and the hook's threshold in step", () => {
    // The hook withholds the mask when the overflow is under this many pixels,
    // so a CSS fade wider than the constant would dim visible content again.
    const widths = [...sheetCss.matchAll(/mask-image:\s*linear-gradient\(90deg, #000 calc\(100% - (\d+)px\)/gu)].map(
      (match) => Number(match[1]),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width).toBe(TRAILING_EDGE_FADE_PX);
  });
});
