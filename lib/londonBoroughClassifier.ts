import { boroughCode, LONDON_BOROUGH_NAMES, type LondonBoroughName } from "@/lib/pintIndex";
import { boroughNameForPoint, LONDON_BOROUGH_CLASSIFIER_VERSION } from "@/lib/londonBoroughPoint.mjs";

type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
export type BoroughBoundaryCollection = {
  features: Array<{ properties: { name: string }; geometry: Geometry }>;
};

export { LONDON_BOROUGH_CLASSIFIER_VERSION };

export type BoroughClassification = {
  code: string;
  name: LondonBoroughName;
  method: "point_in_polygon";
  confidence: "high";
};

export function classifyLondonBoroughPoint(
  lat: number,
  lng: number,
  boundaries: BoroughBoundaryCollection,
): BoroughClassification | null {
  const name = boroughNameForPoint(lat, lng, boundaries, new Set<string>(LONDON_BOROUGH_NAMES));
  return name ? {
    code: boroughCode(name),
    name: name as LondonBoroughName,
    method: "point_in_polygon",
    confidence: "high",
  } : null;
}
