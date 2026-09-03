export const CANONICAL_FIELD_SEPARATOR: string;

export function canonicalObservationRow(observation: {
  venueId: string;
  boroughCode: string;
  pricePence: number;
  observedAt: string;
  sourceId: string;
  pubName: string;
}): string[];

export function canonicalObservationsPayload(
  observations: readonly {
    venueId: string;
    boroughCode: string;
    pricePence: number;
    observedAt: string;
    sourceId: string;
    pubName: string;
  }[],
): string;
