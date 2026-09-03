declare module "@/lib/londonBoroughPoint.mjs" {
  export const LONDON_BOROUGH_CLASSIFIER_VERSION: "london-borough-point-v1";

  export function boroughNameForPoint(
    lat: number,
    lng: number,
    boundaries: { features: Array<{ properties: { name: string }; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } }> },
    allowedNames?: Set<string> | null,
  ): string | null;
}
