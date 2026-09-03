import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

// UnsupportedAreaPreview is a client component; node-env vitest renders its
// initial (SSR) markup via renderToStaticMarkup — the same pattern
// citySuggestBanner.test.ts uses. The load-bearing invariants (taste doctrine):
// the live alternative ALWAYS renders BEFORE the demand ask (never a form-wall),
// and the ask is collapsed by default (no email field on first paint, so a user
// is never confronted with a form to get value).

import UnsupportedAreaPreview from "@/components/coverage/UnsupportedAreaPreview";
import { buildAreaDemandRequest } from "@/lib/areaDemand";
import { NIGHT_PATCHES } from "@/lib/nightPatches";

const soho = NIGHT_PATCHES.find((p) => p.id === "soho")!;
const noop = () => {};

function render(props: Parameters<typeof UnsupportedAreaPreview>[0]): string {
  return renderToStaticMarkup(React.createElement(UnsupportedAreaPreview, props));
}

describe("UnsupportedAreaPreview", () => {
  it("renders the live alternative BEFORE the demand ask", () => {
    const html = render({
      nearest: { patch: soho, distanceKm: 6.2 },
      source: "near-empty",
      onPickPatch: noop,
    });
    const alternativeAt = html.indexOf("Show Soho");
    const askAt = html.indexOf("Ask us to cover your area");
    expect(alternativeAt).toBeGreaterThanOrEqual(0);
    expect(askAt).toBeGreaterThanOrEqual(0);
    // Value first: the alternative must appear earlier in the document than the ask.
    expect(alternativeAt).toBeLessThan(askAt);
  });

  it("names the real nearest patch with an honest distance", () => {
    const html = render({
      nearest: { patch: soho, distanceKm: 6.25 },
      source: "near-empty",
      onPickPatch: noop,
    });
    expect(html).toContain("Nearest we cover well is Soho, about 6.3 km away.");
  });

  it("is not a form-wall: no email field before the ask is opened", () => {
    const html = render({
      area: "Peckham",
      source: "area-picker",
      onPickPatch: noop,
    });
    expect(html).not.toContain('type="email"');
    expect(html).toContain("Tell us you want Peckham");
    expect(html).toContain("We haven&#x27;t mapped pubs in Peckham yet.");
  });

  it("offers other supported patches as alternatives without duplicating the headline", () => {
    const html = render({
      nearest: { patch: soho, distanceKm: 6.2 },
      source: "near-empty",
      onPickPatch: noop,
    });
    // A different supported patch is offered as a chip alternative.
    expect(html).toContain(">Shoreditch<");
    // Soho is the headline "Show Soho" and is filtered from the chip list, so it
    // never appears as a bare ">Soho<" chip.
    expect(html).not.toContain(">Soho<");
  });

  it("captures demand WITHOUT an email (the wire payload omits email)", () => {
    // The component posts buildAreaDemandRequest(...); with no email offered the
    // body carries no email key at all — demand is recorded without contact.
    const body = buildAreaDemandRequest({ area: "Peckham", source: "area-picker", email: "" });
    expect("email" in body).toBe(false);
  });
});
