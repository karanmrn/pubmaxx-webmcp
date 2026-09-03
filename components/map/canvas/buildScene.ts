import type * as maplibregl from "maplibre-gl";
import {
  applyBasemapTaste,
  applySelectionMute,
  clusterCircleColorExpr,
} from "@/lib/mapBasemapTaste";
import { isTransitNetworkVisible } from "@/lib/poiToggleGroups";
import { TRANSPORT_CATEGORIES, type PoiCategory } from "@/lib/pois";
import { iconId, UK_BASE_ICON_KEY, type IconTokens } from "@/lib/mapIcons";
import {
  type Tokens,
  withAlpha,
  DASH_SEQ,
  registerMapIcons,
  GLOW_BASE_STROKE_OPACITY,
  GLOW_BASE_STROKE_WIDTH,
  OSM_ATTRIBUTION,
  venuePinEdgeTokens,
} from "./tokens";
import {
  AMBIENT_CATEGORIES,
  poiFilter,
  transportFilter,
  TRANSPORT_ICON_MATCH,
  TUBE_LINE_OFFSET_EXPR,
  selectedPinFilter,
  selectedPinIconSizeExpr,
  pubIconOpacityExpr,
  pinSortKeyExpr,
  pinPriceLabelExpr,
  PIN_ICON_SIZE_EXPR,
  PIN_PRICE_LABEL_MIN_ZOOM,
  SELECTED_PIN_PRICE_LABEL_EXPR,
} from "./filters";

// The two zooms that shape pub density. They are deliberately NOT the same
// number any more:
//
//   PIN_MIN_ZOOM ......... floor for every unclustered per-pub layer. Isolated
//                          pubs sit outside any cluster radius, so without this
//                          floor they paint as individual pins at every zoom
//                          ("pin soup" over the whole city).
//   CLUSTER_MAX_ZOOM ..... last zoom at which the pubs source still aggregates
//                          (MapLibre clusters up to AND INCLUDING this value).
//
// Between the two there is a deliberate mixed band (z12–z13): a dense pocket
// stays one cluster disc while a pub with room around it resolves to its own
// pin. That is the density rule this map now honours at every zoom — an
// individual pin only appears where there is room for it. This keeps the
// curated city sources legible without the street-level pile-up a hard
// "everything unclusters at z12" boundary produces.
//
// CLUSTER_MAX_ZOOM stays strictly below every camera zoom that targets a single
// venue (selection flies to `max(zoom, 14)`), so a selected pub is always a
// real pin and never hidden inside a cluster.
export const PIN_MIN_ZOOM = 12;
export const CLUSTER_MAX_ZOOM = 13;

// The UK-wide unpriced base layer (lib/ukBasePubs.ts) shares PIN_MIN_ZOOM's
// floor and nothing else. It is deliberately NOT part of the `pubs` source:
//
//   • it is never clustered, so no base pub can inflate a curated cluster's
//     count or tint its donut — below the pin floor the curated overview is
//     byte-for-byte the map it was before this layer existed;
//   • it carries no price, so it never enters the price-bucket colour system;
//   • it renders UNDER every curated layer, which is also what makes a curated
//     pin win the collision (MapLibre places the topmost symbol layer first),
//     so a base pub can never displace a priced one.
//
// The zoom floor is what bounds the payload too: shards are only fetched once
// the camera is at/above it (components/map/pubmap/useUkBaseStreaming.ts).
export const UK_BASE_MIN_ZOOM = PIN_MIN_ZOOM;

// Base pins are visibly second-class: roughly half a curated pin's footprint
// and never fully opaque, so a street with both reads as "priced pubs, plus
// some we know nothing about" rather than as two equal pin families.
export const UK_BASE_ICON_SIZE_EXPR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  UK_BASE_MIN_ZOOM,
  0.5,
  15,
  0.72,
  17,
  0.8,
];
export const UK_BASE_ICON_OPACITY = 0.85;

// Supercluster grouping radius in screen pixels. Sized off the widest cluster
// disc this scene draws (radius 20 + stroke, see the `clusters` layer) so two
// discs can never touch on a 390px-wide phone, with margin for the count label.
export const CLUSTER_RADIUS_PX = 56;
export const CLUSTER_MAX_RADIUS_PX = 20;

// `clusters` / `cluster-count` resting paint. Named because the entrance ramp
// (PubMapCanvas) fades from 0 up to exactly these values and must restore them.
export const CLUSTER_FILL_OPACITY = 0.98;
export const CLUSTER_STROKE_OPACITY = 1;

// Collision padding, in pixels, added around the cluster count's text box. A
// circle layer contributes NOTHING to MapLibre's collision index, so without
// this the disc is invisible to placement and neighbouring labels (landmark
// names, basemap POIs) happily land on top of it. Padding the count's box out
// to roughly the disc footprint makes the whole marker reserve its space.
export const CLUSTER_COLLISION_PADDING = 10;

// The provisional-report badge: the small dot that rides at a pin's upper right
// when someone has logged tonight's pint price there and it is still one report
// short of moving the map (components/map/communityPriceSignals.ts).
//
// Why a dot and not a colour: pin FILL is the price-band system (≤£5.50 /
// ≤£7 / >£7 / unpriced) and a ring is already spoken for twice over
// (Pint Drops river, What's-On accent). A badge is the one form
// left that adds a fact without editing any of those - it says "someone was
// here", never "the price is this".
//
// Why it costs the collision index nothing: offset + radius keep the badge
// inside the ≤15px halo envelope `pubs-point`'s `icon-padding: 6` already
// clears, so the badge changes what a pin LOOKS like and not which pins get
// placed. __tests__/mapSymbolCollision.test.ts pins that.
export const PROVISIONAL_BADGE_OFFSET_PX: [number, number] = [6.5, -8.5];
export const PROVISIONAL_BADGE_RADIUS_MIN_PX = 3.2;
export const PROVISIONAL_BADGE_RADIUS_MAX_PX = 4.2;
/** The widest ring any pin wears (what's-on, at z15) — the envelope to stay in. */
export const PIN_HALO_ENVELOPE_PX = 15;

function provisionalBadgePaint(
  tokens: Tokens,
  dark: boolean,
  opacity: number | maplibregl.ExpressionSpecification,
) {
  return {
    "circle-color": tokens.riverBright,
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      PIN_MIN_ZOOM,
      PROVISIONAL_BADGE_RADIUS_MIN_PX,
      15,
      PROVISIONAL_BADGE_RADIUS_MAX_PX,
    ] as maplibregl.ExpressionSpecification,
    "circle-translate": PROVISIONAL_BADGE_OFFSET_PX,
    "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
    "circle-stroke-width": 1.4,
    "circle-opacity": opacity,
    "circle-stroke-opacity": opacity,
  };
}

// The price tag: the figure a priced pin prints under its glyph from
// PIN_PRICE_LABEL_MIN_ZOOM (see ./filters, which owns the zoom gate and the
// text expressions). It is the one thing on a pin that is NOT free of the
// density contract - the badge above buys its exemption by hiding inside the
// icon's padding, but a number outside the glyph has to be a real symbol in
// MapLibre's collision index or a dense street turns to smear. So the label
// takes the ordinary deal every other label on this map takes: it collides, it
// is `text-optional`, and where it cannot fit it is dropped and its pin stays.
//
// Sizes/offsets in ems of the label's own text-size, tuned so the tag hangs
// just clear of the glass silhouette's foot (the glyph bottom sits at ~0.32 of
// the icon box below centre) at every zoom the label draws at, on both the
// standard pin and the 1.28× selected one.
export const PIN_PRICE_LABEL_SIZE_EXPR: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  PIN_PRICE_LABEL_MIN_ZOOM,
  9.5,
  16.5,
  11,
];
export const PIN_PRICE_LABEL_OFFSET_EM: [number, number] = [0, 1.2];
export const SELECTED_PIN_PRICE_LABEL_OFFSET_EM: [number, number] = [0, 1.45];
/** Collision padding around the tag's own box, in px. */
export const PIN_PRICE_LABEL_PADDING = 4;

// Zoom at/above which curated landmark pictograms stop yielding to other
// symbols. Below it a landmark icon gives way where a pub cluster or pin
// already occupies the spot; at/above it (the landmark-inspector camera flies
// to 15) the curated icon is the hero and always draws.
export const LANDMARK_ICON_PRIORITY_ZOOM = 14;
export const FIRST_PUB_LAYER_ID = "pubs-drops-halo";

export type SceneCtx = {
  map: maplibregl.Map;
  tokens: Tokens;
  dark: boolean;
  textFont: string[];
  addLayerOnce: (...args: Parameters<maplibregl.Map["addLayer"]>) => void;
  poiHidden: Record<PoiCategory, boolean>;
  transitLinesPath: string | null;
  showLandmarks: boolean;
  landmarksGeoJSON: GeoJSON.FeatureCollection;
  poisData: GeoJSON.FeatureCollection;
  routeLine: GeoJSON.FeatureCollection;
  routeStops: GeoJSON.FeatureCollection;
  bandCorridor: GeoJSON.FeatureCollection;
  bandColor: string;
  bandMemberIds: string[];
  pubsData: GeoJSON.FeatureCollection;
  /** The reader's granted position, empty when there is none — see buildUserLocation. */
  userLocationData: GeoJSON.FeatureCollection;
  /** UK base pubs for the CURRENT viewport only — see buildUkBase. */
  ukBaseData: GeoJSON.FeatureCollection;
  tonightData: GeoJSON.FeatureCollection;
  tonightVisible: boolean;
  selectedId: string;
  /** M2 — caller-owned store of pre-mute paint originals (layerId::prop → value)
   *  for the POI-at-initiation selection mute. Survives across builds via a ref;
   *  cleared + re-applied here on every style.load. */
  selectionMuteStore: Map<string, unknown>;
};

// Wave J1 — warm paper/river/brass washes on the stock basemap before we add
// pub layers, so Liberty/Positron stop reading as generic grey GIS.
export function applySceneTaste(ctx: SceneCtx) {
  const { map, tokens, dark } = ctx;
  applyBasemapTaste(
    map,
    {
      paper: tokens.paper,
      panelRaised: tokens.panelRaised,
      ink: tokens.ink,
      inkDeep: tokens.inkDeep,
      line: tokens.line,
      muted: tokens.muted,
      pint: tokens.pint,
      amber: tokens.amber,
      brass: tokens.brass,
      river: tokens.river,
      riverBright: tokens.riverBright,
      buildingEmissive: tokens.buildingEmissive,
      parkTint: tokens.parkTint,
    },
    dark,
  );
}

/**
 * Hard ceiling on 3-D building massing. Owner iPhone audit (landmark-inspector
 * zoom ~15): untextured grey fill-extrusion prisms dominated the basemap
 * (Shaftesbury Memorial → grey hexagon "Lego"). Cap opacity hard so streets
 * and labels stay the hero — matches the flat overview look, not a toy city.
 */
export const BUILDING_EXTRUSION_OPACITY = 0.15;

/**
 * Zoom at and above which extrusion height is forced to 0. Landmark-inspector
 * camera flies to zoom 15; by 14.5 the massing is fully flattened so POI icons
 * (and streets) are never buried under grey prisms.
 */
export const BUILDING_EXTRUSION_FLAT_ZOOM = 14.5;

/** Height expression: subtle skyline mid-zoom, fully flat by inspector zoom. */
export function buildingExtrusionHeightExpr(
  fullHeight: maplibregl.ExpressionSpecification | number,
): maplibregl.ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    12.5,
    0,
    13.5,
    fullHeight,
    BUILDING_EXTRUSION_FLAT_ZOOM,
    0,
  ];
}

/**
 * Tame every fill-extrusion layer already present in the basemap style
 * (OpenFreeMap dark ships `building-3d`; Positron/CARTO may too). Best-effort:
 * locked paint props are skipped. Called on every style.load so a fallback
 * style swap re-applies the same policy.
 */
export function tameFillExtrusionLayers(map: maplibregl.Map): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type !== "fill-extrusion") continue;
    try {
      map.setPaintProperty(layer.id, "fill-extrusion-opacity", BUILDING_EXTRUSION_OPACITY);
    } catch {
      // Style may lock the prop; continue to height flatten.
    }
    try {
      map.setPaintProperty(layer.id, "fill-extrusion-vertical-gradient", true);
    } catch {
      // MapLibre 6 supports this natively; keep the rest best-effort for unusual styles.
    }
    try {
      // Flatten hard at inspector zoom regardless of the style's original
      // height expression — property reads still work on OpenMapTiles building
      // layers; missing props coalesce to a short stub then collapse to 0.
      map.setPaintProperty(
        layer.id,
        "fill-extrusion-height",
        buildingExtrusionHeightExpr([
          "*",
          ["coalesce", ["get", "render_height"], ["get", "height"], 14],
          1.08,
        ]),
      );
    } catch {
      // Best-effort only.
    }
  }
}

export function buildSkyAndBuildings(ctx: SceneCtx) {
  const { map, tokens, dark, addLayerOnce } = ctx;
  // --- Sky + fog: M4 signature dusk/night gradient — deep indigo zenith
  // fading to a warm brass horizon band in dark mode (setSky); light mode
  // keeps its existing quiet pale-sky → paper fade (skyZenith/skyHorizon
  // resolve to riverBright/paper there — see globals.css). Both themes
  // driven purely by tokens, re-applied on every style.load + theme switch
  // (same call site as applyBasemapTaste, before M2's selection-mute
  // snapshot in applySelectionState — see assembleScene ordering).
  map.setSky({
    "sky-color": tokens.skyZenith,
    "horizon-color": dark ? withAlpha(tokens.skyHorizon, 0.55) : tokens.skyHorizon,
    "fog-color": dark ? tokens.inkDeep : tokens.paper,
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 0.2],
  });

  // --- 3-D buildings. Always tame style-native extrusion first (dark Liberty
  // ships its own `building-3d` at full opacity — that was the grey Lego).
  // Only add our own `buildings-3d` when the style has none, still under the
  // same hard opacity + flatten-by-inspector-zoom policy.
  tameFillExtrusionLayers(map);

  const styleLayers = map.getStyle()?.layers ?? [];
  const firstSymbolId = styleLayers.find((layer) => layer.type === "symbol")?.id;
  const hasExtrusion = styleLayers.some((layer) => layer.type === "fill-extrusion");
  const buildingLayer = styleLayers.find(
    (layer) =>
      layer.type === "fill" &&
      "source-layer" in layer &&
      layer["source-layer"] === "building",
  );
  if (!hasExtrusion && buildingLayer && "source" in buildingLayer) {
    addLayerOnce(
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: buildingLayer.source as string,
        "source-layer": "building",
        minzoom: 12.5,
        paint: {
          // Keep each theme's established massing tone. MapLibre 6 owns the
          // height shading through fill-extrusion-vertical-gradient below.
          "fill-extrusion-color": dark ? tokens.buildingEmissive : tokens.line,
          "fill-extrusion-height": buildingExtrusionHeightExpr([
            "*",
            ["coalesce", ["get", "render_height"], ["get", "height"], 14],
            1.08,
          ]),
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          // M6: fake-AO massing — MapLibre shades each extrusion face by height
          // so building bases read subtly darker than their tops, giving the
          // skyline weight without any real light source. Cheap depth cue that
          // makes the City/Canary Wharf clusters feel solid on pitched zoom.
          "fill-extrusion-vertical-gradient": true,
          "fill-extrusion-opacity": BUILDING_EXTRUSION_OPACITY,
        },
      },
      firstSymbolId,
    );
  }
}

export function buildTransitLines(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, transitLinesPath, poiHidden } = ctx;
  // --- Transit lines (London TfL by default). Non-London cities pass
  // transitLinesPath=null so we skip the source entirely (no 404).
  if (!transitLinesPath) return;
  if (!map.getSource("tube-lines")) {
    map.addSource("tube-lines", {
      type: "geojson",
      data: transitLinesPath,
      attribution: "Rail lines © TfL / OpenStreetMap contributors (ODbL)",
    });
  }
  const addTransitLayer = (layer: Parameters<maplibregl.Map["addLayer"]>[0]) => {
    if (map.getLayer(layer.id)) return;
    map.addLayer(layer, map.getLayer("user-location-halo") ? "user-location-halo" : undefined);
  };
  const tubeVisibility: "none" | "visible" = isTransitNetworkVisible(poiHidden)
    ? "visible"
    : "none";
  addTransitLayer({
    id: "tube-lines-casing",
    type: "line",
    source: "tube-lines",
    minzoom: 9.5,
    layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
    paint: {
      "line-color": dark ? "rgba(9,15,12,0.6)" : "rgba(255,255,255,0.8)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 2.4, 13, 5.5, 16, 9],
      "line-opacity": 0.75,
      // Fan the sub-surface lines apart (issue #16); centred for all others.
      "line-offset": TUBE_LINE_OFFSET_EXPR,
    },
  });
  addTransitLayer({
    id: "tube-lines-color",
    type: "line",
    source: "tube-lines",
    minzoom: 9.5,
    layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "color"], "#000000"],
        dark ? "#c9c9c9" : "#000000",
        ["get", "color"],
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 1.1, 13, 3, 16, 5],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0.7, 13, 0.95],
      // Same fan offset as the casing so colour + casing move together.
      "line-offset": TUBE_LINE_OFFSET_EXPR,
    },
  });
  // Line names ride along the route once you zoom in — neutral, high-contrast
  // text (not the line colour, which is unreadable for yellow/pink lines) so
  // the network stays legible over the busy base.
  addTransitLayer({
    id: "tube-lines-label",
    type: "symbol",
    source: "tube-lines",
    minzoom: 13,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 420,
      "text-field": ["get", "line"],
      "text-font": textFont,
      "text-size": 9.5,
      "text-letter-spacing": 0.02,
      visibility: tubeVisibility,
    },
    paint: {
      // Dark night land needs cream `--ink` labels, not dark `--paper`.
      "text-color": dark ? tokens.ink : tokens.inkDeep,
      "text-halo-color": dark ? "rgba(9,8,6,0.92)" : "rgba(255,255,255,0.95)",
      "text-halo-width": 1.7,
    },
  });
}

export function registerSceneIcons(ctx: SceneCtx) {
  const { map, tokens, dark } = ctx;
  // --- Designed marker images: landmark pictograms + TfL symbols, re-tinted
  // from the live theme tokens (a setStyle wipes them, so re-register here).
  const iconTokens: IconTokens = {
    ink: tokens.ink,
    paper: dark ? tokens.inkDeep : tokens.paper,
    brass: tokens.brass,
    brassBright: tokens.brassBright,
    river: tokens.river,
    riverBright: tokens.riverBright,
    pint: tokens.pint,
    amber: tokens.amber,
    brick: tokens.brick,
    muted: tokens.muted,
    // The drink pin's rim + casing. Dark only, and for the reason spelled out on
    // venuePinEdgeTokens: `paper` above resolves to a near-black in dark, so the
    // glasses' "light rim" was a black one against a near-black basemap.
    ...venuePinEdgeTokens(tokens, dark),
  };
  registerMapIcons(map, iconTokens);
}

export function buildLandmarks(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, showLandmarks, landmarksGeoJSON } = ctx;
  // --- Landmarks + history layer. Empty cityLandmarks skips the layer so
  // London markers never appear over Manchester (and vice versa).
  if (!showLandmarks) return;
  if (!map.getSource("landmarks")) {
    map.addSource("landmarks", {
      type: "geojson",
      data: landmarksGeoJSON,
    });
  } else {
    (map.getSource("landmarks") as maplibregl.GeoJSONSource).setData(landmarksGeoJSON);
  }
  const beforePubLayer = map.getLayer(FIRST_PUB_LAYER_ID)
    ? FIRST_PUB_LAYER_ID
    : undefined;
  // Names and pictograms are separate collision candidates. A pub cluster can
  // own the landmark's exact coordinate while a compact name still finds room
  // beside it via variable anchors. Both layers stay below pubs in style order,
  // so this gains orientation without taking one pixel of price priority.
  addLayerOnce({
    id: "landmarks-label",
    type: "symbol",
    source: "landmarks",
    layout: {
      "symbol-sort-key": ["coalesce", ["get", "priority"], 999],
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9.5,
        9.75,
        12,
        10.5,
        15,
        12.5,
      ],
      "text-letter-spacing": 0.06,
      "text-variable-anchor": [
        "top",
        "bottom",
        "left",
        "right",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ],
      "text-radial-offset": 1.35,
      "text-justify": "auto",
      "text-max-width": 8,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 2,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.7,
      "text-halo-blur": 0.25,
      "text-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9.5,
        0.76,
        12,
        0.9,
        15,
        1,
      ],
    },
    minzoom: 9.5,
  }, beforePubLayer);

  // Landmark-inspector zoom is 15 (selectLandmark cinematic). No maxzoom -
  // every curated landmark pin must stay rendered and prominent there so
  // Piccadilly Circus reads like London Eye (owner audit: icon vanished under
  // grey extrusion massing; icons also stayed too small at z15).
  addLayerOnce({
    id: "landmarks-icon",
    type: "symbol",
    source: "landmarks",
    layout: {
      "icon-image": ["get", "icon"],
      // Grow hard into inspector zoom so the pin is the hero, not basemap massing.
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9,
        0.55,
        12,
        0.9,
        15,
        1.35,
        17,
        1.5,
      ],
      // Collision policy (owner mobile audit: "the names of the places are so
      // close it looks janky"). Below the inspector band a landmark icon yields
      // where a pub cluster/pin already holds the spot; from
      // LANDMARK_ICON_PRIORITY_ZOOM up it always draws (Piccadilly Circus must
      // read like the London Eye at inspector zoom). Either way the icon is now
      // part of the collision index — `icon-ignore-placement: true` used to let
      // it bulldoze every neighbouring label into a pile-up.
      "icon-allow-overlap": [
        "step",
        ["zoom"],
        false,
        LANDMARK_ICON_PRIORITY_ZOOM,
        true,
      ],
      "icon-ignore-placement": false,
      "icon-padding": 4,
      // Curation order is the collision priority: the catalog's earlier, more
      // famous landmarks win a contested spot, and they win it the SAME way on
      // every render (MapLibre's default is source order, which is not stable
      // across tiles).
      "symbol-sort-key": ["coalesce", ["get", "priority"], 999],
    },
    paint: {
      "icon-opacity": 1,
    },
    minzoom: 9.5,
  }, beforePubLayer);
}

export function buildPois(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, poiHidden, poisData } = ctx;
  // --- Points of interest. Transport (tube/rail/bus/river) render as their
  // real TfL / National Rail symbols on two zoom-gated layers: major
  // interchanges form the skeleton from a wide zoom, minor stops fade in as
  // you go deeper — a transit map revealing detail. Parks/sights stay soft
  // dots. All honour the category toggles (kept across theme rebuilds).
  // Non-London cities keep an empty source (poisPath=null → no fetch).
  if (!map.getSource("pois")) {
    map.addSource("pois", { type: "geojson", data: poisData });
  }
  addLayerOnce({
    id: "pois-transport-major",
    type: "symbol",
    source: "pois",
    minzoom: 9.5,
    filter: transportFilter(poiHidden, true),
    layout: {
      "icon-image": TRANSPORT_ICON_MATCH,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9.5, 0.4, 13, 0.62, 16, 0.78],
      // Major interchanges are the transit skeleton, but they still collide:
      // two roundels stacked on one another read as a smudge, not a network.
      "icon-allow-overlap": false,
      "icon-padding": 2,
    },
  });
  addLayerOnce({
    id: "pois-transport-minor",
    type: "symbol",
    source: "pois",
    minzoom: 12.4,
    filter: transportFilter(poiHidden, false),
    layout: {
      "icon-image": TRANSPORT_ICON_MATCH,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12.4, 0.42, 16, 0.66],
      "icon-allow-overlap": false,
    },
    paint: {
      "icon-opacity": ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.1, 1],
    },
  });
  addLayerOnce({
    id: "pois-transport-label",
    type: "symbol",
    source: "pois",
    minzoom: 13,
    filter: poiFilter(poiHidden, TRANSPORT_CATEGORIES),
    layout: {
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.2,
    },
  });
  addLayerOnce({
    id: "pois-dot",
    type: "circle",
    source: "pois",
    minzoom: 11,
    filter: poiFilter(poiHidden, AMBIENT_CATEGORIES),
    paint: {
      "circle-color": ["coalesce", ["get", "color"], tokens.muted],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
      "circle-opacity": 0.85,
      "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
      "circle-stroke-width": 1.2,
    },
  });
  addLayerOnce({
    id: "pois-label",
    type: "symbol",
    source: "pois",
    minzoom: 12.5,
    filter: poiFilter(poiHidden, AMBIENT_CATEGORIES),
    layout: {
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": 10,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.2,
    },
  });
}

export function buildRoute(ctx: SceneCtx) {
  const { map, tokens, dark, addLayerOnce, routeLine } = ctx;
  // --- Crawl route: a high-contrast walking line that follows real roads.
  // Three layers off the one `route-line` source, whose single LineString
  // feature carries a `source` property ("ors" | "straight", set by
  // lib/walkRoute legsToLineString):
  //   1. casing — an opposite-luminance halo so the line stays legible over both
  //      the pale Positron paper and the OLED-dark basemap (the two-layer
  //      casing/colour idiom copied from tube-lines above).
  //   2. the solid coloured line — full strength for a real routed line ("ors"),
  //      dropped to a faint underlay for the straight fallback so the dash reads.
  //   3. the marching-ants dash — shown ONLY for the "straight" fallback, where
  //      it now MEANS "approximate, not routed"; hidden for a real routed line.
  // Opacity is data-driven off the feature's `source`, so the ors/straight look
  // flips with the data (and survives a theme setStyle rebuild) without any
  // imperative repaint. The dash animation (RAF loop in PubMapCanvas) is already
  // reduced-motion gated, so a static dash holds for reduced-motion users.
  if (!map.getSource("route-line")) {
    map.addSource("route-line", { type: "geojson", data: routeLine });
  }
  addLayerOnce({
    id: "route-line-casing",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": dark ? tokens.inkDeep : tokens.paper,
      "line-width": 6,
      "line-opacity": 0.85,
    },
  });
  addLayerOnce({
    id: "route-line",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tokens.routeLine,
      "line-width": 4,
      // Solid at full strength for a routed line; a faint underlay under the
      // dash for the straight fallback.
      "line-opacity": ["case", ["==", ["get", "source"], "straight"], 0.3, 0.95],
    },
  });
  addLayerOnce({
    id: "route-line-dash",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tokens.routeLine,
      "line-width": 2.5,
      // Only the straight fallback wears the marching-ants dash; a routed line
      // stays solid (the layer paints nothing when source is "ors").
      "line-opacity": ["case", ["==", ["get", "source"], "straight"], 0.9, 0],
      "line-dasharray": DASH_SEQ[0],
    },
  });
}

export function buildBandCorridor(ctx: SceneCtx) {
  const { map, dark, addLayerOnce, bandCorridor, bandColor } = ctx;
  // --- Story-band corridor (issue #15): a subtle token-tinted line threading
  // the active band's anchor landmarks. Low opacity + a soft blur so it reads
  // as a hint of the walk, never competing with the price-fill pins above it.
  // Sits under the pubs. The colour is the band's token, resolved on the React
  // side and stashed in a ref so a theme rebuild re-reads it.
  if (!map.getSource("band-corridor")) {
    map.addSource("band-corridor", { type: "geojson", data: bandCorridor });
  }
  addLayerOnce({
    id: "band-corridor",
    type: "line",
    source: "band-corridor",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": bandColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 16, 16, 30],
      "line-opacity": dark ? 0.16 : 0.14,
      "line-blur": 3,
    },
  });
}

/**
 * The current viewport's UK base pubs after render-time curated-owner
 * suppression.
 *
 * One symbol layer on one un-clustered source, added BEFORE buildPubs so it
 * sits underneath the curated pins in both paint order and collision priority.
 * It uses the same "drop it rather than stack it" policy as every other symbol
 * on this map, which is what keeps a dense town legible: where there is no room
 * for a base pin, MapLibre simply does not place it.
 */
export function buildUkBase(ctx: SceneCtx) {
  const { map, tokens, dark, addLayerOnce, ukBaseData, selectedId } = ctx;
  if (!map.getSource("uk-base")) {
    // This layer is wholly OSM-derived, so it carries the credit on the source
    // itself as well as on the map (tokens.ts OSM_ATTRIBUTION) - MapLibre
    // de-duplicates identical attribution strings in the corner control.
    map.addSource("uk-base", {
      type: "geojson",
      data: ukBaseData,
      attribution: OSM_ATTRIBUTION,
    });
  }
  // The tapped base pub. A quieter ring than the curated `pubs-selected` brass
  // (this pin has nothing to be proud of yet), but a tap must always be
  // answered on the map, not only in the sheet.
  addLayerOnce({
    id: "uk-base-selected",
    type: "circle",
    source: "uk-base",
    minzoom: UK_BASE_MIN_ZOOM,
    filter: ["==", ["get", "id"], selectedId],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 7, 17, 12],
      "circle-stroke-color": tokens.brass,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": dark ? 0.85 : 0.8,
    },
  });
  addLayerOnce({
    id: "uk-base-point",
    type: "symbol",
    source: "uk-base",
    minzoom: UK_BASE_MIN_ZOOM,
    layout: {
      "icon-image": iconId("base", UK_BASE_ICON_KEY),
      "icon-size": UK_BASE_ICON_SIZE_EXPR,
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      "icon-padding": 3,
    },
    paint: {
      "icon-opacity": UK_BASE_ICON_OPACITY,
    },
  });
  addLayerOnce({
    id: "uk-base-provisional-badge",
    type: "circle",
    source: "uk-base",
    minzoom: UK_BASE_MIN_ZOOM,
    filter: ["get", "provisional"],
    paint: provisionalBadgePaint(
      tokens,
      dark,
      UK_BASE_ICON_OPACITY,
    ),
  });
}

/**
 * The reader's own position.
 *
 * It lives on the CANVAS, under the pub layers, and that ordering is the whole
 * point. As a DOM marker it floated above every symbol and outside MapLibre's
 * collision index, so standing at a pub — the commonest success of Near me, the
 * "0.0 km" row the sheet leads with — put an opaque disc straight over that
 * pin's price. A pin's figure is a claim, and a half-covered claim reads as a
 * render bug at the moment the reader trusts the map most.
 *
 * Drawn beneath the pins, the price wins the overlap and the halo still rings
 * the pin, so the reader can see both where they are and what it costs. The dot
 * is a circle, not a symbol, so the collision index never hides the reader
 * themselves: it yields the FIGURE, never the position.
 */
export function buildUserLocation(ctx: SceneCtx) {
  const { map, tokens, addLayerOnce, userLocationData } = ctx;
  if (!map.getSource("user-location")) {
    map.addSource("user-location", { type: "geojson", data: userLocationData });
  }
  addLayerOnce({
    id: "user-location-halo",
    type: "circle",
    source: "user-location",
    paint: {
      "circle-color": tokens.userLocation,
      "circle-opacity": 0.18,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 12, 16, 22],
      "circle-stroke-color": tokens.userLocation,
      "circle-stroke-opacity": 0.45,
      "circle-stroke-width": 1.5,
    },
  });
  addLayerOnce({
    id: "user-location-core",
    type: "circle",
    source: "user-location",
    paint: {
      "circle-color": tokens.userLocation,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 7],
      // The paper collar is what separates the dot from a dark basemap and from
      // a pin it may be sitting on.
      "circle-stroke-color": tokens.paper,
      "circle-stroke-width": 2.5,
    },
  });
}

export function buildPubs(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, pubsData, bandMemberIds, bandColor, selectedId } = ctx;
  // --- Pubs: clustered GeoJSON source + designed data-driven layers.
  // clusterRadius / clusterMaxZoom are create-time only (MapLibre does not
  // update them via setData). Theme setStyle clears sources, so rebuilds
  // pick up these values on the next addSource.
  if (!map.getSource("pubs")) {
    map.addSource("pubs", {
      type: "geojson",
      data: pubsData,
      cluster: true,
      // Mobile-first density: aggregate nearby venues into fewer, calmer
      // clusters, wide enough apart that two discs never touch on a phone.
      clusterRadius: CLUSTER_RADIUS_PX,
      // Clustering survives past the pin floor on purpose — see the
      // PIN_MIN_ZOOM / CLUSTER_MAX_ZOOM note at the top of this file. A dense
      // pocket keeps its disc through z13 while roomier pubs already resolve
      // to their own pins, which is what keeps a UK-wide source legible.
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      // M5 — per-cluster price-band mix for the donut markers
      // (components/map/canvas/donutClusters.ts). b0..b3 mirror
      // priceBucket() in geojson.ts (≤£5.50 / >£5.50–≤£7 / >£7 / no price —
      // the same order + colours as the legend/pin fill), accumulated by
      // supercluster itself so no client-side aggregation pass is needed.
      clusterProperties: {
        b0: ["+", ["case", ["==", ["get", "bucket"], 0], 1, 0]],
        b1: ["+", ["case", ["==", ["get", "bucket"], 1], 1, 0]],
        b2: ["+", ["case", ["==", ["get", "bucket"], 2], 1, 0]],
        b3: ["+", ["case", ["==", ["get", "bucket"], 3], 1, 0]],
      },
    });
  }
  // No scraped-provenance halo. It drew a coral ring on every scraped pin,
  // and because a circle layer never joins the symbol collision index, dense
  // streets kept the ring after the glyph was dropped — dozens of empty coral
  // circles that read as render bugs and wore the selection ring's colour
  // (design judgement 2026-08-01, finding 2.9). Scrape provenance still
  // travels on the feature (`scraped`) and on the venue sheet's source rows;
  // it was never a fact a reader needed painted on the street.
  // Pint-Drops ring: a river-toned glow + a crisp outline so community
  // activity reads at a glance without muddying the price fill under it.
  addLayerOnce({
    id: "pubs-drops-halo",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["get", "drops"]],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 15, 12],
      "circle-stroke-color": tokens.riverBright,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 15, 1.6],
      "circle-stroke-opacity": 0.7,
      "circle-blur": 0.15,
    },
  });
  // W1 What's-On tonight badge: a crisp accent ring on pins with a venueId-
  // joined quiz/sport/deal/music row on tonight (feature prop `whatsOn` = hero
  // kind). Colour reads the kind; timed heroes (quiz/deal/music) get a slightly
  // stronger ring than the untimed "screens live sport" attribute badge. Pure
  // property-driven layer on the EXISTING pubs source — no new source, frozen
  // canvas honoured.
  addLayerOnce({
    id: "pubs-whatson-badge",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["has", "whatsOn"]],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 15],
      "circle-stroke-color": [
        "match",
        ["get", "whatsOn"],
        "quiz", tokens.amber,
        "sport", tokens.riverBright,
        "deal", tokens.brassBright,
        "music", tokens.river,
        // An unknown hero kind falls back to the muted neutral, never coral:
        // coral rings are the selection ring's own mark (finding 2.1).
        tokens.muted,
      ] as maplibregl.ExpressionSpecification,
      "circle-stroke-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["case", ["get", "whatsOnTimed"], 1.8, 1.3],
        15,
        ["case", ["get", "whatsOnTimed"], 2.8, 2.1],
      ],
      "circle-stroke-opacity": dark ? 0.9 : 0.85,
      "circle-blur": 0.08,
    },
  });
  // Story-band member halo (issue #15): while a band is active, its member
  // pubs get a token-tinted ring so they read as "part of this walk" — an
  // EMPHASIS only. The price fill under it (pubs-point) is untouched, so the
  // band never fights the price-colour system. Filter is set from a ref so
  // it survives theme rebuilds; empty id list = nothing drawn.
  addLayerOnce({
    id: "band-members-halo",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["in", ["get", "id"], ["literal", bandMemberIds]],
    ],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8.5, 15, 14],
      "circle-stroke-color": bandColor,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 15, 2.4],
      "circle-stroke-opacity": dark ? 0.85 : 0.8,
      "circle-blur": 0.1,
    },
  });
  addLayerOnce({
    id: "pubs-point",
    type: "symbol",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["get", "icon"],
      // M7 — the static baseline size. During the once-only entrance ramp
      // (PubMapCanvas, right after settleSceneReady) this gets temporarily
      // overridden per-frame by pinEntranceIconSizeExpr, then restored here.
      "icon-size": PIN_ICON_SIZE_EXPR,
      // Pins collide like every other symbol on this map: where two drink
      // silhouettes cannot both fit, one is dropped rather than smeared over
      // the other. `icon-allow-overlap: true` (the old value) is what let a
      // dense street render as a solid mass of half-hidden glyphs and would
      // make any large curated city source unreadable at street zoom.
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
      // Padding covers the widest halo ring a pin can wear (drops /
      // what's-on badges, radius ≤ 15px at z15) so those rings stay clear of
      // the neighbouring pin too.
      "icon-padding": 6,
      // Placement priority when pins compete: the selected pin first (it is the
      // one the user is looking at), then story pins, then priced pins, then
      // the rest. Lower sort key = placed first = survives.
      "symbol-sort-key": pinSortKeyExpr(selectedId),
      // THE PRICE TAG. The one thing a price map has to do, and until now this
      // map only did it in the venue sheet: a pin said "somewhere between £5.50
      // and £7" in colour and made you tap to learn which. Empty string below
      // PIN_PRICE_LABEL_MIN_ZOOM and on any pub with no sourced figure, so an
      // unpriced pin (and the whole overview) is unchanged.
      "text-field": pinPriceLabelExpr(selectedId),
      "text-font": textFont,
      "text-size": PIN_PRICE_LABEL_SIZE_EXPR,
      // Hangs off the foot of the glass rather than floating beside it, so a
      // row of pins reads as a row of price tags and never as loose labels
      // whose pin you have to guess at.
      "text-anchor": "top",
      "text-offset": PIN_PRICE_LABEL_OFFSET_EM,
      "text-letter-spacing": 0.01,
      "text-rotate": tokens.priceStampTiltDeg,
      "text-rotation-alignment": "viewport",
      // The label takes the same deal every other label here takes: it collides
      // (no allow-overlap escape hatch - that is what made a dense street a
      // smear before pins started colliding), and `text-optional` is what makes
      // the yielding order right: where the tag will not fit, the TAG goes and
      // the pin stays. A pin without its price is still a pub; a price without
      // its pin is noise.
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-optional": true,
      "text-padding": PIN_PRICE_LABEL_PADDING,
    },
    paint: {
      // M1 selection spotlight: non-selected pins dim to SELECTION_DIM_OPACITY
      // once a venue is selected; the selected pin always reads at full
      // opacity. Eased (not snapped) via icon-opacity-transition.
      "icon-opacity": pubIconOpacityExpr(selectedId),
      "icon-opacity-transition": { duration: 250, delay: 0 },
      // Same brass-plaque ink, surface, and press tilt as PriceBadge. The halo
      // is MapLibre's compact plaque surface, preserving collision behaviour
      // without introducing a second free-floating layer.
      "text-color": tokens.pricePlaqueInk,
      "text-halo-color": tokens.pricePlaqueSurface,
      "text-halo-width": 2.1,
      "text-halo-blur": 0.2,
      // The tag belongs to its pin, so it dims with it - same expression the
      // icon and the provisional badge wear. Without it, a pub the
      // favourite-pint lens filtered out would still shout its price.
      "text-opacity": pubIconOpacityExpr(selectedId),
      "text-opacity-transition": { duration: 250, delay: 0 },
    },
  });
  // The selected pin, drawn again on its own layer with overlap allowed —
  // `icon-allow-overlap` is data-constant in the style spec, so the base layer
  // above cannot exempt one feature. This layer carries exactly one feature
  // (selectedPinFilter) and keeps `icon-ignore-placement: false`, so its box
  // still reserves space in the collision index: neighbouring symbols yield to
  // the selected pin, and every other pin keeps colliding as before.
  addLayerOnce({
    id: "pubs-point-selected",
    type: "symbol",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: selectedPinFilter(selectedId),
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": selectedPinIconSizeExpr(selectedId),
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
      "icon-padding": 6,
      // The selected pub's price tag. `pubs-point` leaves a hole for exactly
      // this feature (pinPriceLabelExpr), so the figure is drawn once - here,
      // pushed a little further down to clear the 1.28× glyph.
      //
      // The ICON's overlap exemption deliberately does not extend to the text:
      // the tag still collides and is still optional, so selecting a pub can
      // never stamp a number over a neighbour's. Selection already answers the
      // price in full in the venue sheet; the tag is a bonus, not the source.
      "text-field": SELECTED_PIN_PRICE_LABEL_EXPR,
      "text-font": textFont,
      "text-size": PIN_PRICE_LABEL_SIZE_EXPR,
      "text-anchor": "top",
      "text-offset": SELECTED_PIN_PRICE_LABEL_OFFSET_EM,
      "text-letter-spacing": 0.01,
      "text-rotate": tokens.priceStampTiltDeg,
      "text-rotation-alignment": "viewport",
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-optional": true,
      "text-padding": PIN_PRICE_LABEL_PADDING,
    },
    paint: {
      "icon-opacity": 1,
      "text-color": tokens.pricePlaqueInk,
      "text-halo-color": tokens.pricePlaqueSurface,
      "text-halo-width": 2.1,
      "text-halo-blur": 0.2,
      "text-opacity": 1,
    },
  });
  // Selected pin: a confident double brass ring — a soft outer wash plus a
  // bright inner edge — that lifts the choice above every other pin. M1 adds
  // a breathing pulse (stroke-opacity + stroke-width), driven every frame by
  // the existing RAF loop in PubMapCanvas — paint transitions are disabled
  // here (duration 0) so the manual per-frame writes aren't smoothed/lagged.
  addLayerOnce({
    id: "pubs-selected-glow",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["==", ["get", "id"], selectedId],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 15],
      "circle-stroke-color": tokens.brass,
      "circle-stroke-width": GLOW_BASE_STROKE_WIDTH,
      "circle-stroke-opacity": GLOW_BASE_STROKE_OPACITY,
      "circle-stroke-width-transition": { duration: 0, delay: 0 },
      "circle-stroke-opacity-transition": { duration: 0, delay: 0 },
      "circle-blur": 0.22,
    },
  });
  addLayerOnce({
    id: "pubs-selected",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["==", ["get", "id"], selectedId],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 15, 11],
      "circle-stroke-color": tokens.brassBright,
      "circle-stroke-width": 2.2,
      "circle-stroke-opacity": 0.98,
    },
  });
  // The provisional-report badge, drawn LAST of the per-pin layers so it reads
  // over the glass silhouette, over the enlarged selected pin and over the
  // brass selection rings — a badge that a ring can hide is not a badge.
  //
  // River-toned, because that is this map's community lane (the Pint Drops halo
  // is the same family): the badge means "a drinker has been here", and it is
  // deliberately NOT any price-band colour, so it can never be misread as this
  // pub's price. The paper/ink rim is what keeps it legible where it lands on
  // the glyph itself.
  addLayerOnce({
    id: "pubs-provisional-badge",
    type: "circle",
    source: "pubs",
    minzoom: PIN_MIN_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["get", "provisional"]],
    paint: provisionalBadgePaint(
      tokens,
      dark,
      // The badge belongs to its pin, so it dims with it — the same expression
      // pubs-point wears. Without this a provisional dot would stay bright on a
      // pub the favourite-pint lens filtered out, or pop out of the M1
      // selection spotlight while its own pin receded.
      pubIconOpacityExpr(selectedId),
    ),
  });
  addLayerOnce({
    id: "clusters",
    type: "circle",
    source: "pubs",
    filter: ["has", "point_count"],
    paint: {
      // Price-aware GL fallback. Desktop normally replaces these circles with
      // segmented donuts; phones and large cluster sets keep this layer, whose
      // fill follows the most common known price band in b0..b2. Grey means no
      // known price. Radius still carries density, and the count stays literal.
      "circle-color": clusterCircleColorExpr(tokens, dark) as maplibregl.ExpressionSpecification,
      "circle-stroke-color": tokens.panelRaised,
      "circle-stroke-width": ["step", ["get", "point_count"], 1.75, 40, 2, 100, 2.25],
      "circle-stroke-opacity": CLUSTER_STROKE_OPACITY,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        11,
        25,
        15,
        100,
        CLUSTER_MAX_RADIUS_PX,
      ],
      "circle-blur": ["step", ["get", "point_count"], 0.02, 40, 0.05, 100, 0.08],
      "circle-opacity": CLUSTER_FILL_OPACITY,
      // The entrance ramp fades these in from 0 (PubMapCanvas); a transition
      // here would fight those per-frame writes exactly like the pin ramp's.
      "circle-opacity-transition": { duration: 0, delay: 0 },
      "circle-stroke-opacity-transition": { duration: 0, delay: 0 },
    },
  });
  addLayerOnce({
    id: "cluster-count",
    type: "symbol",
    source: "pubs",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": textFont,
      "text-size": ["step", ["get", "point_count"], 10, 25, 11, 100, 12],
      "text-letter-spacing": 0.02,
      // A disc without its number is worse than a tight fit, so the count
      // always draws — but it is NOT invisible to placement: its padded box
      // (CLUSTER_COLLISION_PADDING ≈ the disc footprint) is what makes every
      // other label on the map, ours and the basemap's, keep off the disc.
      "text-allow-overlap": true,
      "text-ignore-placement": false,
      "text-padding": CLUSTER_COLLISION_PADDING,
      // Denser clusters win a contested spot.
      "symbol-sort-key": ["-", 0, ["get", "point_count"]],
    },
    paint: {
      "text-color": dark ? tokens.ink : tokens.inkDeep,
      "text-halo-color": withAlpha(tokens.panelRaised, 0.75),
      "text-halo-width": 1,
      "text-opacity": 1,
      "text-opacity-transition": { duration: 0, delay: 0 },
    },
  });
}

export function buildRouteStops(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, routeStops } = ctx;
  // --- Route stops (numbered) above everything.
  if (!map.getSource("route-stops")) {
    map.addSource("route-stops", { type: "geojson", data: routeStops });
  }
  addLayerOnce({
    id: "route-stops",
    type: "circle",
    source: "route-stops",
    paint: {
      "circle-color": tokens.inkDeep,
      "circle-radius": 13,
      "circle-stroke-color": tokens.brassBright,
      "circle-stroke-width": 2.5,
    },
  });
  addLayerOnce({
    id: "route-stops-label",
    type: "symbol",
    source: "route-stops",
    layout: {
      "text-field": ["get", "label"],
      "text-font": textFont,
      "text-size": 13,
      "text-allow-overlap": true,
    },
    // Stops are always dark-filled, so the label is the light-side token.
    paint: { "text-color": dark ? tokens.ink : tokens.paper },
  });
  // Pub-name plaque (owner bug: numbered discs alone don't say WHICH pub stop 2
  // is, while ordinary basemap POIs around them are labelled). Engraved-brass
  // text riding beside each numbered disc — a strong paper/ink halo carries it
  // over the pale Liberty basemap and the night land without a background box.
  // Collision-tolerant: text-variable-anchor lets the plaque flip side to dodge
  // neighbours and the default placement drops the odd label in a dense cluster
  // rather than smearing them all — the numbers (allow-overlap) always stay.
  // Zoom-gated at 13.5: below that the whole route can sit in one thumb-width,
  // so plaques would pile up; the discs carry the route until the user leans in.
  addLayerOnce({
    id: "route-stops-name",
    type: "symbol",
    source: "route-stops",
    minzoom: 13.5,
    layout: {
      "text-field": ["get", "stopName"],
      "text-font": textFont,
      "text-size": ["interpolate", ["linear"], ["zoom"], 13.5, 10, 16, 12],
      // Ride beside the numbered disc (radius 13px), flipping side to dodge the
      // route line and neighbouring stops.
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 1.6,
      "text-justify": "auto",
      "text-max-width": 9,
    },
    paint: {
      "text-color": dark ? tokens.brassBright : tokens.brass,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 2,
      "text-halo-blur": 0.4,
    },
  });
}

export function buildTonight(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, tonightData, tonightVisible } = ctx;
  // --- CityMCP "tonight" opportunities: amber/moon pins above route stops,
  // with visibility controlled by parent overlay state and data reseeded via ref.
  try {
    const tonightVisibility: "visible" | "none" = tonightVisible ? "visible" : "none";
    if (!map.getSource("tonight-opportunities")) {
      map.addSource("tonight-opportunities", {
        type: "geojson",
        data: tonightData,
      });
    }
    addLayerOnce({
      id: "tonight-halo",
      type: "circle",
      source: "tonight-opportunities",
      minzoom: 10.5,
      layout: { visibility: tonightVisibility },
      paint: {
        "circle-color": withAlpha(tokens.amber, dark ? 0.24 : 0.2),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 9, 15, 17],
        "circle-stroke-color": withAlpha(tokens.riverBright, dark ? 0.7 : 0.55),
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10.5, 1.1, 15, 2],
        "circle-stroke-opacity": 0.8,
        "circle-blur": 0.35,
      },
    });
    addLayerOnce({
      id: "tonight-point",
      type: "circle",
      source: "tonight-opportunities",
      minzoom: 10.5,
      layout: { visibility: tonightVisibility },
      paint: {
        "circle-color": tokens.amber,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 4.2, 15, 6.6],
        "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.96,
      },
    });
    addLayerOnce({
      id: "tonight-label",
      type: "symbol",
      source: "tonight-opportunities",
      minzoom: 13,
      layout: {
        "text-field": ["get", "title"],
        "text-font": textFont,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 10.5],
        "text-offset": [0, 0.95],
        "text-anchor": "top",
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        visibility: tonightVisibility,
      },
      paint: {
        "text-color": dark ? tokens.ink : tokens.inkDeep,
        "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
        "text-halo-width": 1.25,
      },
    });
  } catch {
    // CityMCP pins are an additive overlay; a style hiccup must not break the pub map.
  }
}

// Assemble the full scene in the exact original top-to-bottom order. MapLibre
// layer paint order = insertion order, so this order is load-bearing: basemap
// taste → sky/buildings → transit → icons → landmarks → pois → route → band
// corridor → pubs → route stops → tonight. The D2 tile-paint gate and the
// pending-updates flush stay in the component wrapper (they own component refs
// and a construct-scope timer); the gate only toggles visibility on the pub
// layers this function has already added, so running it after assembly is
// behaviour-identical to the original mid-scene position (paint happens after
// the synchronous build returns).
/** Pins-first slice: pub layers in their original stack position; taste/transit defer. */
export function assembleSceneCritical(ctx: SceneCtx) {
  registerSceneIcons(ctx);
  // BEFORE the pub layers on purpose — see buildUserLocation.
  buildUserLocation(ctx);
  buildUkBase(ctx);
  buildLandmarks(ctx);
  buildPois(ctx);
  buildRoute(ctx);
  buildBandCorridor(ctx);
  buildPubs(ctx);
  buildRouteStops(ctx);
  applySelectionState(ctx);
}

/** Visual polish and network-heavy overlays after the first paint frame. */
export function assembleSceneDeferred(ctx: SceneCtx) {
  applySceneTaste(ctx);
  buildSkyAndBuildings(ctx);
  buildTransitLines(ctx);
  buildTonight(ctx);
  applySelectionState(ctx);
}

export function assembleScene(ctx: SceneCtx) {
  assembleSceneCritical(ctx);
  assembleSceneDeferred(ctx);
}

// M2 · POI-at-initiation gating — re-apply the selection mute after a fresh
// style build. A setStyle (theme swap) wipes every layer and its paint, so the
// previous store's snapshots are stale: clear them, then, if a venue is still
// selected, re-mute (recapturing this style's fresh originals). With nothing
// selected this is a pure clear — the initial city overview stays untouched
// (PRD part c: landmark/POI set visible and unchanged at zero selection).
export function applySelectionState(ctx: SceneCtx) {
  const { map, selectionMuteStore, selectedId } = ctx;
  selectionMuteStore.clear();
  if (selectedId) {
    applySelectionMute(map, true, selectionMuteStore);
  }
}
