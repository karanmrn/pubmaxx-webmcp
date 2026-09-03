export type UiUxAxeColorScheme = "light" | "dark";

export function validateUiUxAxeColorScheme(value: string): UiUxAxeColorScheme;
export function buildUiUxAxeAuditDocument<T>(
  origin: string,
  colorScheme: UiUxAxeColorScheme,
  results: T[],
): { origin: string; colorScheme: UiUxAxeColorScheme; results: T[] };
