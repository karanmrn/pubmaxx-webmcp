export type PermissiblePriceSource = {
  id: string;
  label: string;
  kind: "first-party-official" | "open-data";
  url: string;
};

export const PERMISSIBLE_PRICE_SOURCE_KINDS: ReadonlySet<string>;

export function isHttpUrl(value: unknown): boolean;

export function filterPermissiblePriceSources(
  sources: unknown,
  options?: { onSkip?: (message: string) => void },
): PermissiblePriceSource[];

export function fetchFromSource(
  source: PermissiblePriceSource,
): Promise<unknown>;
