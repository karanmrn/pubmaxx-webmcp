import { describe, expect, it } from "vitest";
import {
  BUILDING_EXTRUSION_FLAT_ZOOM,
  BUILDING_EXTRUSION_OPACITY,
  buildSkyAndBuildings,
  buildingExtrusionHeightExpr,
  tameFillExtrusionLayers,
} from "@/components/map/canvas/buildScene";

describe("building extrusion anti-Lego policy", () => {
  it("caps opacity hard so grey prisms never dominate inspector zoom", () => {
    expect(BUILDING_EXTRUSION_OPACITY).toBeLessThanOrEqual(0.2);
    expect(BUILDING_EXTRUSION_OPACITY).toBeGreaterThan(0);
  });

  it("flattens fully at or before landmark-inspector zoom (15)", () => {
    expect(BUILDING_EXTRUSION_FLAT_ZOOM).toBeLessThanOrEqual(15);
    expect(BUILDING_EXTRUSION_FLAT_ZOOM).toBeGreaterThan(12);
  });

  it("height expression collapses to 0 at the flat zoom stop", () => {
    const expr = buildingExtrusionHeightExpr(40);
    // ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.5, full, flatZoom, 0]
    expect(expr[0]).toBe("interpolate");
    expect(expr[expr.length - 2]).toBe(BUILDING_EXTRUSION_FLAT_ZOOM);
    expect(expr[expr.length - 1]).toBe(0);
  });

  it("tames every fill-extrusion layer with native vertical shading, opacity and height", () => {
    const paint = new Map<string, unknown>();
    const map = {
      getStyle: () => ({
        layers: [
          { id: "building-3d", type: "fill-extrusion" },
          { id: "road", type: "line" },
          { id: "buildings-3d", type: "fill-extrusion" },
        ],
      }),
      setPaintProperty: (id: string, prop: string, value: unknown) => {
        paint.set(`${id}::${prop}`, value);
      },
    };
    tameFillExtrusionLayers(map as never);
    expect(paint.get("building-3d::fill-extrusion-opacity")).toBe(
      BUILDING_EXTRUSION_OPACITY,
    );
    expect(paint.get("buildings-3d::fill-extrusion-opacity")).toBe(
      BUILDING_EXTRUSION_OPACITY,
    );
    expect(paint.get("building-3d::fill-extrusion-vertical-gradient")).toBe(true);
    expect(paint.get("buildings-3d::fill-extrusion-vertical-gradient")).toBe(true);
    expect(paint.has("road::fill-extrusion-opacity")).toBe(false);
    expect(paint.has("road::fill-extrusion-vertical-gradient")).toBe(false);
    const height = paint.get("building-3d::fill-extrusion-height") as unknown[];
    expect(height[0]).toBe("interpolate");
    expect(height[height.length - 1]).toBe(0);
  });

  it("creates the app-owned building layer with the native vertical gradient", () => {
    const added: Array<{ paint?: Record<string, unknown> }> = [];
    buildSkyAndBuildings({
      dark: true,
      tokens: {
        skyZenith: "#000000",
        skyHorizon: "#111111",
        inkDeep: "#000000",
        paper: "#ffffff",
        buildingEmissive: "#333333",
        line: "#dddddd",
      },
      map: {
        setSky: () => undefined,
        setPaintProperty: () => undefined,
        getStyle: () => ({
          layers: [
            {
              id: "building-fill",
              type: "fill",
              source: "basemap",
              "source-layer": "building",
            },
          ],
        }),
      },
      addLayerOnce: (layer: { paint?: Record<string, unknown> }) => {
        added.push(layer);
      },
    } as never);

    expect(added).toHaveLength(1);
    expect(added[0].paint?.["fill-extrusion-vertical-gradient"]).toBe(true);
  });
});
