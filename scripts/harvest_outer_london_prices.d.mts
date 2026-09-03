export type HarvestDrinkUpdate = {
  venueKey: string;
  drinkName: string;
  category: string;
  priceGbp: number;
  source: {
    label: string;
    url: string;
    licence: string;
  };
  observedAt: string;
};

export function mergeDrinkUpdates<T extends HarvestDrinkUpdate>(
  existing: T[],
  incoming: T[],
): T[];

export function priorPublishedSourceFor(
  row: { website?: string },
  priorEntries: Array<{
    website?: string;
    sourceUrl?: string;
    result?: string;
  }>,
): string | undefined;
