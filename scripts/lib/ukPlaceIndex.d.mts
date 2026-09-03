export type UkPlaceIndexRow = [
  name: string,
  lat: number,
  lng: number,
  kind: "city" | "town" | "village" | "place" | "suburb",
  context?: string,
];

export type UkPlaceIndex = {
  source: string;
  license: string;
  attribution: string;
  basis: string;
  generator: string;
  generatedAt: string | null;
  places: UkPlaceIndexRow[];
};

export function buildUkPlaceIndex(
  elements: Iterable<unknown>,
  options?: { generatedAt?: string | null },
): UkPlaceIndex;
