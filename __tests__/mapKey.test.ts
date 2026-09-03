import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapKey from "@/components/map/MapKey";
import type { MapPriceLegendModel } from "@/lib/mapPriceLegend";
import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("MapKey", () => {
  const renderedState = {
    priceBands: [
      { meaning: "pint", bucket: 0 },
      { meaning: "pint", bucket: 1 },
      { meaning: "pint", bucket: 2 },
      { meaning: "pint", bucket: 3 },
    ] as const,
    storyColour: null,
  };
  const html = renderToStaticMarkup(
    createElement(MapKey, {
      legend: mapPriceLegend({
        kind: "default",
        renderedState,
      }),
    }),
  );
  const storyHtml = renderToStaticMarkup(
    createElement(MapKey, {
      legend: mapPriceLegend({
        kind: "default",
        renderedState: {
          ...renderedState,
          storyColour: "#d99f45",
        },
      }),
    }),
  );

  it("pairs every colour band with a symbol and visible price text", () => {
    expect(html).toContain("£5.50 or less");
    expect(html).toContain("Over £5.50, up to £7");
    expect(html).toContain("Over £7");
    expect(html).toContain("No pint price on the map");
    expect(html).toContain("mapKeyPriceCode");
    expect(html).toContain("Your approximate location");
    expect(html).toContain("Place in the Events overlay for tonight");
    expect(html).toContain("UK base pub you selected");
  });

  it("keeps decorative colour and shape samples out of the accessibility tree", () => {
    expect(html).toContain('class="mapKeyPriceSwatch');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("A recent pint report");
    expect(html).toContain("This pub has a visible Pint Drop");
  });

  it("uses semantic sections and expandable detail groups", () => {
    expect(html).toContain("<h3");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Pin shapes</summary>");
    expect(html).toContain("<summary>Dots and rings</summary>");
    expect(html).toContain("<summary>Routes</summary>");
    expect(storyHtml).toContain("Broad translucent line");
    expect(storyHtml).toContain("place story you chose");
  });

  it("draws routed, estimated, and story lines as different marks", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/mapKey.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.mapKeyMarker--walking-route::before\s*{[^}]*height:\s*3px/,
    );
    expect(css).toMatch(
      /\.mapKeyMarker--straight-route::before\s*{[^}]*border-top:\s*3px dashed/,
    );
    expect(css).toMatch(
      /\.mapKeyMarker--story-corridor::before\s*{[^}]*height:\s*12px[^}]*filter:\s*blur\(2px\)/,
    );
    expect(storyHtml.match(/--map-key-marker-colour:var\(--route-line\)/g)).toHaveLength(
      2,
    );
    expect(storyHtml).toContain(
      'mapKeyMarker--story-corridor" style="--map-key-marker-colour:#d99f45',
    );
    expect(css).toMatch(
      /\.mapKeyMarker--story-corridor::before\s*{[^}]*background:\s*var\(--map-key-marker-colour\)/,
    );
  });

  it("omits undeclared sections and notes", () => {
    const sparseLegend: MapPriceLegendModel = {
      rows: [],
      ariaLabel: "Sparse key",
      title: "Sparse key",
      hint: "No declared states.",
      clusterNote: null,
      shapes: [],
      marks: [],
      routeMarks: [],
      noAlcoholNote: null,
    };
    const sparseHtml = renderToStaticMarkup(
      createElement(MapKey, { legend: sparseLegend }),
    );

    expect(sparseHtml).not.toContain(">Clusters<");
    // The trust explainer ("Why this colour?") always renders, independent of
    // the legend's declared rows/shapes/marks/routes - only the conditional
    // per-legend detail sections are gated here.
    expect(sparseHtml).not.toContain('class="mapKeyDetails"');
  });
});
