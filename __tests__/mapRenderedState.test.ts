import { describe, expect, it } from "vitest";

import {
  deriveMapRenderedState,
  sameMapRenderedState,
} from "@/lib/mapRenderedState";

function feature(bucket: number, kind = "pub"): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { bucket, kind },
    geometry: {
      type: "Point",
      coordinates: [-2.24, 53.48],
    },
  };
}

describe("deriveMapRenderedState", () => {
  it("reports the exact source buckets and resolved story colour", () => {
    const pubsData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(3), feature(1), feature(1)],
    };

    expect(
      deriveMapRenderedState(
        pubsData,
        { brass: "#b0813a", amber: "#d99f45" },
        "amber",
      ),
    ).toEqual({
      priceBands: [
        { meaning: "pint", bucket: 1 },
        { meaning: "pint", bucket: 3 },
      ],
      storyColour: "#d99f45",
    });
  });

  it("derives price pairs from only the features in the scene", () => {
    const pubOnly: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0), feature(2)],
    };
    const mixed: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0), feature(1, "bar")],
    };

    expect(
      deriveMapRenderedState(pubOnly, { brass: "#b0813a" }, null)
        .priceBands,
    ).toEqual([
      { meaning: "pint", bucket: 0 },
      { meaning: "pint", bucket: 2 },
    ]);
    expect(
      deriveMapRenderedState(mixed, { brass: "#b0813a" }, null)
        .priceBands,
    ).toEqual([
      { meaning: "pint", bucket: 0 },
      { meaning: "type-relative", bucket: 1 },
    ]);
  });

  it("preserves the meaning that owns each rendered bucket", () => {
    const pubsData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(3), feature(0, "restaurant")],
    };

    expect(
      deriveMapRenderedState(pubsData, { brass: "#b0813a" }, null)
        .priceBands,
    ).toEqual([
      { meaning: "pint", bucket: 3 },
      { meaning: "type-relative", bucket: 0 },
    ]);
  });

  it("detects a rendered bucket moving between price meanings", () => {
    expect(
      sameMapRenderedState(
        {
          priceBands: [
            { meaning: "pint", bucket: 0 },
            { meaning: "type-relative", bucket: 3 },
          ],
          storyColour: null,
        },
        {
          priceBands: [
            { meaning: "pint", bucket: 3 },
            { meaning: "type-relative", bucket: 0 },
          ],
          storyColour: null,
        },
      ),
    ).toBe(false);
  });

  it("resolves the story token again when scene theme tokens change", () => {
    const pubsData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [feature(0)],
    };

    const light = deriveMapRenderedState(
      pubsData,
      { brass: "#b0813a", amber: "#d99f45" },
      "amber",
    );
    const dark = deriveMapRenderedState(
      pubsData,
      { brass: "#ff6b7a", amber: "#ffc247" },
      "amber",
    );

    expect(light.storyColour).toBe("#d99f45");
    expect(dark.storyColour).toBe("#ffc247");
  });
});
