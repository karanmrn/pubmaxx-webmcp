import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import UkPlaceArrivalBanner from "@/components/map/UkPlaceArrivalBanner";
import { UK_BASE_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";
import { CITIES } from "@/lib/cities";
import {
  parseUkPlaceMapArrival,
  ukPlaceMapView,
} from "@/lib/ukPlaceSearch";

describe("UK place map arrival", () => {
  it("validates an uncovered UK place deep link", () => {
    expect(
      parseUkPlaceMapArrival(
        "?place=Sheffield&lat=53.3800941&lng=-1.4789213",
      ),
    ).toEqual({
      name: "Sheffield",
      lat: 53.3800941,
      lng: -1.4789213,
    });
  });

  it("refuses partial, malformed, or out-of-UK coordinates", () => {
    expect(parseUkPlaceMapArrival("?place=Sheffield&lat=53.38")).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=Sheffield&lat=nope&lng=-1.47"),
    ).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=Paris&lat=48.8566&lng=2.3522"),
    ).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=%00bad&lat=53.38&lng=-1.47"),
    ).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=Hythe%3BWest+Hythe&lat=51.07&lng=1.08"),
    ).toBeNull();
  });

  it("refuses a point inside a curated city, which is that city", () => {
    expect(
      parseUkPlaceMapArrival("?place=Camden&lat=51.5389171&lng=-0.1418712"),
    ).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=Didsbury&lat=53.4181794&lng=-2.23144"),
    ).toBeNull();
    expect(
      parseUkPlaceMapArrival("?place=Headingley&lat=53.8209584&lng=-1.5788089"),
    ).not.toBeNull();
  });

  it("resolves the printed name from our own index, never from the query string", async () => {
    const { resolveUkPlaceMapArrival } = await import(
      "@/lib/ukPlaceIndex.server"
    );

    expect(
      resolveUkPlaceMapArrival(
        "?place=Sheffield&lat=53.3800941&lng=-1.4789213",
      ),
    ).toEqual({ name: "Sheffield", lat: 53.3800941, lng: -1.4789213 });
    expect(
      resolveUkPlaceMapArrival(
        "?place=Free+pints+all+night&lat=53.38&lng=-1.47",
      ),
    ).toBeNull();
    expect(
      resolveUkPlaceMapArrival("?place=Camden&lat=51.5389171&lng=-0.1418712"),
    ).toBeNull();
  });

  it("opens beyond the base-pub streaming gate with city camera attitude", () => {
    const arrival = {
      name: "Sheffield",
      lat: 53.3800941,
      lng: -1.4789213,
    };
    const view = ukPlaceMapView(arrival, CITIES.london.mapView);

    expect(view.center).toEqual([-1.4789213, 53.3800941]);
    expect(view.zoom).toBeGreaterThanOrEqual(UK_BASE_MIN_ZOOM);
    expect(view.pitch).toBe(CITIES.london.mapView.pitch);
    expect(view.bearing).toBe(CITIES.london.mapView.bearing);
  });

  it("states uncovered price status and invites the first report", () => {
    const html = renderToStaticMarkup(
      createElement(UkPlaceArrivalBanner, {
        arrival: { name: "Sheffield", lat: 53.3800941, lng: -1.4789213 },
      }),
    );

    expect(html).toContain("Sheffield pubs are on the map");
    expect(html).toContain("No prices logged here yet");
    expect(html).toContain("you could be first");
    expect(html).not.toContain("0 pubs");
    expect(html).toContain('aria-label="Dismiss Sheffield map note"');
  });

  it("keeps the map note contained with a thumb-sized dismissal", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/ukPlaceArrivalBanner.css"),
      "utf8",
    );
    expect(css).toMatch(/\.ukPlaceArrival\s*{[^}]*min-width:\s*0/);
    expect(css).toMatch(
      /\.ukPlaceArrivalDismiss\s*{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/,
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.ukPlaceArrival\s*{[^}]*right:\s*var\(--mobile-map-corner-lane/,
    );
  });

  it("keeps place coordinates through map URL synchronisation", () => {
    expect(
      mergeCrawlUrlSearch(
        "mode=build",
        "?place=Sheffield&lat=53.3800941&lng=-1.4789213",
      ),
    ).toBe(
      "mode=build&place=Sheffield&lat=53.3800941&lng=-1.4789213",
    );
  });

  it("does not label uncovered-place controls as London price or transport tools", () => {
    const pubMap = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );
    const mobileShell = readFileSync(
      join(process.cwd(), "components/mobile/MobileMapShell.tsx"),
      "utf8",
    );

    expect(pubMap).toContain("limitedCoverage={Boolean(ukPlaceArrival)}");
    // Limited-coverage arrivals keep map search so UK places can fill the gap
    // when venues/localities are emptied.
    expect(pubMap).toContain("includeLocalResults: !limitedCoverageSearch");
    expect(pubMap).toContain("onSelectPlace: selectPlaceFromSearch");
    // The arrival's own place name still wins the bar. What follows it is now
    // the claim the VIEW earned (lib/areaButton.areaClaimedByViewport), which
    // answers null for a view over no single area, so the city name is the
    // fallback rather than the nearest area to the centre.
    expect(pubMap).toContain("const mapChipLabel =");
    expect(pubMap).toContain(
      ": ukPlaceArrival?.name ?? claimedArea?.name ?? mapContextName",
    );
    expect(pubMap).toContain("cityLabel={mapChipLabel}");
    expect(mobileShell).toContain("limitedCoverage: boolean;");
    expect(mobileShell).toContain("if (limitedCoverage)");
    expect(mobileShell).toContain("mobileMapTopbar mobileMapTopbarLimited");
    expect(mobileShell).toContain('aria-label="Search the map"');
  });

  it("keeps route-level loading copy neutral before place query is available", () => {
    const loading = readFileSync(
      join(process.cwd(), "components/map/MapLoadingSkeleton.tsx"),
      "utf8",
    );

    expect(loading).toContain("UK venue map");
    expect(loading).not.toContain("London venue map");
  });
});
